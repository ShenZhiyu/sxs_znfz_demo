/** 离线模拟模型，只用于演示与验证；不具备语言模型的理解能力。 */
// 导入适配器基类；LLM 运行时通过统一的 stream 接口使用不同模型实现。
import { LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm'
// 为工具调用生成唯一 ID，让结果能准确关联到这次请求。
import { randomUUID } from 'node:crypto'
// 额外的固定演示命令仍通过真实 MCP 工具执行，不在模型里运行仿真。
import { offlineSimulation } from './offline-simulation.ts'
// 观察官方技能注入，离线测试别名也调用官方 skill 工具。
import { offlineSkills } from './offline-skills.ts'
// 仅离线演示的手动 /mcp 命令使用完整公开工具名；不属于补全目录。
import { offlineMcp } from './offline-mcp.ts'
// 离线手动验证官方 Bash 工具，不向通用命令补全添加 demo 快捷命令。
import { offlineBash } from './offline-bash.ts'
// 导入请求和分片的类型，约束模拟器输入输出；这些类型本身不会发送请求。
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'

/** 从真实请求中读取历史，再按模型流协议产生可预测的回复。 */
// 声明并导出模拟适配器；extends 继承框架默认行为，本类只实现生成文本流的部分。
export class OfflineAdapter extends LlmAdapter {
  /**
   * 回显当前输入和首轮输入，便于观察历史是否传到了下一次请求。
   * @param options AgentLoop 组装的模型请求，包含完整对话历史。
   * @returns 符合框架协议的文本流。
   */
  // override 表示实现基类方法；async * 定义异步生成器，调用方能逐个取得 yield 的 StreamChunk。
  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    // 若存在取消信号且已经中止，就立即抛错；可选链 ?. 允许调用方不提供 signal。
    options.signal?.throwIfAborted()
    // 仿真命令由独立演示规则处理；每次工具结果回到这里后继续查询真实任务状态。
    if (yield* offlineSimulation(options)) return
    if (yield* offlineSkills(options)) return
    if (yield* offlineMcp(options)) return
    if (yield* offlineBash(options)) return
    // 从真实 AgentLoop 请求携带的 messages 开始处理；不是从模拟器私有变量伪造对话历史。
    const inputs = options.messages
      // 筛选 user 角色消息；本例关闭了运行时上下文，因此这些 user 消息对应用户逐轮输入。
      .filter(message => message.role === 'user' && (message.source === undefined || message.source.kind === 'user'))
      // 对每条用户消息取出内容块数组；map 为每条消息生成一个对应的字符串。
      .map(message => message.content
        // 只保留文字块，跳过图片等非文本内容；类型判断让下行可以安全读取 block.text。
        .filter(block => block.type === 'text')
        // 取出各文字块文本并无分隔拼接；最外层 map 最终得到按历史顺序排列的用户文本数组。
        .map(block => block.text).join(''))
    // 数一数请求中已有多少条 assistant 消息，用于验证上一轮回复确实进入了下一轮历史。
    const replies = options.messages.filter(message => message.role === 'assistant').length
    // 用当前请求里的历史生成可预测的回显；at(-1) 取最后一条输入，[0] 取第一条，模拟器不理解问题语义。
    let text = `（离线模拟，第 ${inputs.length} 轮）收到：${inputs.at(-1)}；首轮输入：${inputs[0]}；已有回复：${replies} 条。`
    // 离线模型只为这一条显式命令演示工具调用，不模拟自然语言理解。
    if (/^\/mcp-add(?:\s|$)/.test(inputs.at(-1) ?? '')) {
      // 只查看当前用户输入之后的工具结果，避免把上一轮的计算结果混入新一轮。
      const tail = options.messages.slice(options.messages.findLastIndex(message => message.role === 'user' && (message.source === undefined || message.source.kind === 'user')) + 1)
      // 工具执行后 AgentLoop 再次调用模型；第二次请求才会包含这个 tool 消息。
      const result = tail.findLast(message => message.role === 'tool')
      // 拆出两个数字；Number 支持负数、小数和科学记数法。
      const parts = inputs.at(-1)!.trim().split(/\s+/)
      // 先区分已经完成工具执行的第二次请求，不重复发出同一个调用。
      if (result?.role === 'tool') {
        // 文本来自 MCP 服务真实返回值；这里没有重新计算 a+b。
        text = `（离线 MCP 演示）${result.isError ? '工具失败' : '结果'}：${result.content.filter(block => block.type === 'text').map(block => block.text).join('')}`
      // 缺参数或非有限数字只返回用法提示，不发送不合规工具请求。
      } else if (parts.length !== 3 || !parts.slice(1).every(value => Number.isFinite(Number(value)))) {
        // 命令只是离线教学入口，真实模型可以按自然语言自行选择工具。
        text = '用法：/mcp-add 2 3（两个参数都需要是有限数字）。'
      // 工具必须实际出现在本轮模型请求中；停用插件后不伪造成功。
      } else if (!options.tools?.some(tool => tool.name === 'mcp__demo__add')) {
        // 网页停用 MCP 后普通聊天仍可用，只有工具演示报告不可用。
        text = 'MCP 加法工具尚未就绪，请在插件面板启用 MCP 本机示例工具。'
      // 第一轮模型请求只产生工具调用，由真正的 AgentLoop 执行 MCP 请求。
      } else {
        // 品牌类型用于避免把普通消息 ID 当作工具调用 ID。
        const id = ToolCallId(randomUUID())
        // 工具参数是 JSON 字符串，遵守框架与真实模型相同的流协议。
        const argumentsJson = JSON.stringify({ a: Number(parts[1]), b: Number(parts[2]) })
        // 先声明工具内容块，调试页能逐项看到实际模型分片。
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        // 增量分片携带工具 ID、公开工具名和完整参数；这里一次输出整个 JSON。
        yield { type: 'tool-call-delta', index: 0, id, name: 'mcp__demo__add', argumentsDelta: argumentsJson }
        // 最终工具块进入会话历史，后续结果通过 id 对应回来。
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'mcp__demo__add', arguments: argumentsJson } }
        // tool-calls 结束原因要求 AgentLoop 执行工具并继续请求模型。
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
        // 这一次响应已结束；结果将在下一次 stream 调用中读取。
        return
      // 结束 MCP 命令的分支判断。
      }
    // 结束显式工具演示；普通消息仍按原有多轮回显输出。
    }

    // 产出“文本块开始”协议事件；index 0 标识本次回复的第一个内容块。
    yield { type: 'block-start', index: 0, blockType: 'text' }
    // 按 Unicode 码点迭代回显文本；这里只展示协议如何逐段传输，并不模拟真实模型的思考速度。
    for (const char of text) {
      // 若存在取消信号且已经中止，就立即抛错；可选链 ?. 允许调用方不提供 signal。
      options.signal?.throwIfAborted()
      // 产出一个增量文本分片；终端和 Web 都监听此类分片来显示回复。
      yield { type: 'text-delta', index: 0, text: char }
    // 闭合当前花括号结构；与上方对应的 { 配对，结束该函数、条件块或类型声明。
    }
    // 声明内容块结束并携带完整文本；框架用它组装和记录最终消息。
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    // 产出正常结束事件，告诉 AgentLoop 本次模型请求没有后续工具调用或文本。
    yield { type: 'finish', reason: { kind: 'stop' } }
  // 闭合当前花括号结构；与上方对应的 { 配对，结束该函数、条件块或类型声明。
  }
// 闭合当前花括号结构；与上方对应的 { 配对，结束该函数、条件块或类型声明。
}
