/** 最小终端对话入口：创建一个 Agent，逐行提交消息并打印流式回复。 */
// 仅导入 Context 类型，供编辑器检查 ctx 的服务接口；import type 会在执行前被移除，不创建框架实例。
import type { Context } from '@deepseek-ai/cordis'
// 引入 Agent 包对 Cordis 类型的扩展，使 TypeScript 认识 ctx.agents 和相关事件；空花括号不是加载一个 Agent。
import type {} from '@deepseek-ai/dsh-agent'
// 让类型系统认识启动器提供的 appReady、appExit；这是类型补充，不会启动命令行程序。
import type {} from '@deepseek-ai/dsh-cmdline'
// 导入运行时消息工厂；它为用户文本生成消息 ID 和 user 角色，避免手写不完整的消息对象。
import { createUserMessage } from '@deepseek-ai/dsh-llm'
// 导入会话 ID 工厂；SessionId(...) 为字符串赋予框架要求的类型标识，不会自行创建会话。
import { SessionId } from '@deepseek-ai/dsh-session'
// 导入 Node 的逐行输入接口；它把终端或管道中的字节流转换成可异步迭代的文本行。
import { createInterface } from 'node:readline'
// 导入本项目的模拟模型类；它实现流协议但不发网络请求，真实模式不会注册它。
import { OfflineAdapter } from './offline-adapter.ts'
// 仅使用共享配置的类型；类型描述合法字段，运行时校验由下方导出的 Config schema 完成。
import type { Config } from './config.ts'

// 重新导出共享的配置类型和运行时校验器，Cordis 会从插件模块的 Config 导出读取配置规则。
export { Config } from './config.ts'

// 导出终端插件的名称，供框架识别和日志定位；它不是 npm 命令名称。
export const name = 'minimal-chat'
// 声明依赖 Agent 注册表与模型运行时；Cordis 等这些服务就绪后才调用 apply。
export const inject = ['agents', 'llm']

/**
 * 在框架启动成功后开始读取终端；退出由官方启动器负责。
 * @param ctx 已加载核心服务的插件上下文。
 * @param config 模型路由与离线开关。
 */
// Cordis 加载插件时调用 apply；ctx 提供服务，config 已经过 schema 校验，void 表示不返回业务值。
export function apply(ctx: Context, config: Config): void {
  // 从服务存储中读取可选的启动完成信号；ctx.get 在服务缺失时返回 undefined，便于显式检查。
  const ready = ctx.get('appReady')
  // 读取启动器提供的统一退出函数；通过它退出可以先释放插件和 Agent，而不是直接强制终止进程。
  const exit = ctx.get('appExit')
  // 检查运行环境是否为官方启动器；普通 new Context 不一定提供这两个宿主能力。
  if (ready === undefined || exit === undefined) {
    // 缺少宿主能力就立即中止加载，避免出现既不读输入也不正确退出的半启动状态。
    throw new Error('请通过 npm run demo 使用官方 dsh 启动器。')
  // 闭合当前花括号结构；与上方对应的 { 配对，结束该函数、条件块或类型声明。
  }

  // 只有离线配置为 true 才进入模拟适配器注册分支；真实模式的适配器由 YAML 加载。
  if (config.offline) {
    // 直接注册适配器，不需要 testkit 或额外的核心服务。
    // 创建模拟适配器并绑定到指定 provider；注册随插件生命周期撤销，后续模型请求会按此路由调用它。
    ctx.llm.registerAdapter([config.provider], new OfflineAdapter())
  // 闭合当前花括号结构；与上方对应的 { 配对，结束该函数、条件块或类型声明。
  }

  // 注册启动完成回调，并把取消该回调的函数交给插件生命周期；不要在其他插件尚未就绪时开始聊天。
  ctx.effect(() => ready.onReady(() => {
    // 启动异步终端会话并安装成功/失败处理；void 表示此处不等待 Promise，但错误仍由 then 的第二个回调处理。
    void chat(ctx, config).then(
      // 聊天因 EOF 或 /exit 正常结束后，请求启动器先清理资源，再以成功状态码 0 退出。
      () => exit(0),
      // 接收异步聊天失败；unknown 要求先判断实际类型，不能直接假定抛出的值一定是 Error。
      (error: unknown) => {
        // 错误是 Error 时显示 message，否则显示原值；前置换行让报错不与流式回复挤在同一行。
        console.error('\n对话失败：', error instanceof Error ? error.message : error)
        // 请求以失败状态码 1 退出；调用方或 smoke 脚本据此知道对话没有成功完成。
        exit(1)
      // 结束当前对象成员或回调函数，并用逗号分隔后续成员或参数。
      },
    // 结束前面跨行函数调用的参数列表；这个括号属于调用，而不是新的函数定义。
    )
  // 结束启动回调注册，给这项 effect 命名以便诊断；卸载插件时会撤销尚未触发的回调。
  }), 'terminal-chat-start')
// 闭合当前花括号结构；与上方对应的 { 配对，结束该函数、条件块或类型声明。
}

/** 复用同一个 Agent 处理所有输入；会话历史仅存于内存。 */
// 定义内部异步会话函数；async 允许使用 await，其完成或失败最终体现在返回的 Promise 中。
async function chat(ctx: Context, config: Config): Promise<void> {
  // 保存当前轮次通过事件报告的错误；let 允许每轮重置，unknown 保留非 Error 抛出值的可能性。
  let turnError: unknown

  // setup 中先安装监听器，创建完成后再提交用户消息。
  // 通过已注册的 Agent 工厂创建实际 Agent，并取得负责释放它的 handle；await 等初始化完成。
  const handle = await ctx.agents.create({
    // 终端进程只维护一段对话，因此使用固定会话标识；本例没有持久化恢复功能。
    sessionId: SessionId('minimal-chat'),
    // 指定该 Agent 的初始模型路由；这里只设置配置，不会立刻发送模型请求。
    agentOptions: { provider: config.provider, model: config.model },
    // 在 Agent 对外发布、接受输入之前安装作用域监听器，保证首个回复分片也不会漏掉。
    setup(agentCtx) {
      // 监听该 Agent 的流事件；解构出 frame，回调会在每个流状态或内容分片到来时执行。
      agentCtx.on('agent/assistant-stream', ({ frame }) => {
        // 先判断是内容帧，再判断是文本增量；类型检查同时帮助 TypeScript 缩小联合类型范围。
        if (frame.type === 'chunk' && frame.chunk.type === 'text-delta') {
          // 把新文本直接写到标准输出且不自动换行，因此多个分片会连成完整回复。
          process.stdout.write(frame.chunk.text)
        // 闭合当前花括号结构；与上方对应的 { 配对，结束该函数、条件块或类型声明。
        }
      // 闭合回调函数或对象参数，再闭合外层调用；读到这里才完成这次注册或构造表达式。
      })
      // whenIdle 只表示停止工作；模型调用失败通过事件报告。
      // 把 Agent 内部错误保存下来；仅等待 whenIdle 可能正常完成，所以需要显式观察失败事件。
      agentCtx.on('agent/error', ({ error }) => { turnError = error })
    // 结束当前对象成员或回调函数，并用逗号分隔后续成员或参数。
    },
  // 闭合回调函数或对象参数，再闭合外层调用；读到这里才完成这次注册或构造表达式。
  })

  // 把标准输入封装为逐行接口；crlfDelay 让 Windows 的 CRLF 按一个换行处理，即使两字节到达时间不同。
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity })
  // 注册输入流的清理动作并取得 disposer；外层函数在注册时执行，内层函数在清理时才关闭接口。
  const closeInput = ctx.effect(() => () => input.close(), 'terminal-chat-input')
  // 定义提示函数；仅在交互终端打印“你：”，让管道输入和自动验证输出保持干净。
  const prompt = (): void => { if (process.stdin.isTTY) process.stdout.write('你：') }

  // 开始根据 offline 选择提示文字；三元表达式分布在后续两行，最终只打印其中一个字符串。
  console.log(config.offline
    // offline 为 true 时显示模拟说明，避免把回显当成真实语言模型回复。
    ? '[离线模拟] 未连接真实模型；回复用于观察多轮历史传递。'
    // 否则用模板字符串显示提供方和模型；${...} 会在运行时替换为变量值。
    : `[真实模型] ${config.provider} / ${config.model}`)
  // 打印终端交互约定；Ctrl+D 表示输入结束，/exit 是本例自己识别的退出文字。
  console.log('每行是一轮对话；输入 /exit 或按 Ctrl+D 退出。')
  // 在进入下一次等待输入之前输出交互提示；管道模式下这个函数不会输出文字。
  prompt()

  // 开始受保护的执行区；其中抛出的错误会交给后面的 catch，清理操作则由 finally 保证执行。
  try {
    // 异步逐行消费输入；每次循环先处理完一轮，再读取下一行，因而同一终端不会并发发送多轮。
    for await (const line of input) {
      // 去掉输入两端空白；中间空格不受影响，清理后的字符串才用于退出判断和模型消息。
      const text = line.trim()
      // 识别退出命令并离开循环；break 仍会经过外层 finally 释放资源。
      if (text === '/exit') break
      // 空字符串不触发模型调用；打印提示后 continue 跳到下一次读取。
      if (!text) { prompt(); continue }

      // 清除上一轮错误，避免把历史失败错误地归因到当前消息。
      turnError = undefined
      // 先打印回复的说话者标识，后续流式文本会紧接着写在它后面。
      process.stdout.write('Agent：')
      // 把完整用户消息放入 Agent 收件箱并唤醒循环；createUserMessage 负责补齐 ID 和 user 角色。
      handle.agent.followup(createUserMessage({
        // 正文是内容块数组；text 是对象属性简写，等同于 text: text。
        content: [{ type: 'text', text }],
        // 记录消息来自用户；来源信息进入会话历史，和消息正文一起传给框架管理。
        source: { kind: 'user' },
      // 先结束对象或回调，再闭合内外两层调用；括号顺序与打开时相反。
      }))
      // 等待当前 Agent 完全停稳；这个 Promise 不返回回复文本，也不保证本轮没有发生模型错误。
      await handle.agent.whenIdle()
      // 等待结束后再检查事件记录的错误；抛出它可让外层失败处理以非零状态退出。
      if (turnError !== undefined) throw turnError
      // 完整轮次结束后补一个换行；不能在每个文本分片后换行，否则回复会被拆散。
      process.stdout.write('\n')
      // 在进入下一次等待输入之前输出交互提示；管道模式下这个函数不会输出文字。
      prompt()
    // 闭合当前花括号结构；与上方对应的 { 配对，结束该函数、条件块或类型声明。
    }
  // 无论正常返回、提前退出还是抛错，都进入清理区；这能防止连接或 Agent 遗留。
  } finally {
    // 调用注册时取得的 disposer，关闭 readline 并撤销清理注册；重复清理由生命周期机制协调。
    closeInput()
    // 释放自己创建的 Agent，等待生成停止和作用域监听器清理；仅关闭输入流并不会自动完成这些工作。
    await handle.dispose()
  // 闭合当前花括号结构；与上方对应的 { 配对，结束该函数、条件块或类型声明。
  }
// 闭合当前花括号结构；与上方对应的 { 配对，结束该函数、条件块或类型声明。
}
