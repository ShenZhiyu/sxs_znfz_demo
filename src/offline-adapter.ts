/** 离线模拟模型，只用于演示与验证；不具备语言模型的理解能力。 */
// 导入适配器基类；LLM 运行时通过统一的 stream 接口使用不同模型实现。
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
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
  constructor(private readonly display: { showPlatformResults?: boolean } = {}) { super() }

  /**
   * 回显当前输入和首轮输入，便于观察历史是否传到了下一次请求。
   * @param options AgentLoop 组装的模型请求，包含完整对话历史。
   * @returns 符合框架协议的文本流。
   */
  // override 表示实现基类方法；async * 定义异步生成器，调用方能逐个取得 yield 的 StreamChunk。
  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    // 若存在取消信号且已经中止，就立即抛错；可选链 ?. 允许调用方不提供 signal。
    options.signal?.throwIfAborted()
    if (yield* offlineSkills(options)) return
    if (yield* offlineMcp(options, this.display.showPlatformResults)) return
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
    const text = `（离线模拟，第 ${inputs.length} 轮）收到：${inputs.at(-1)}；首轮输入：${inputs[0]}；已有回复：${replies} 条。`
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
