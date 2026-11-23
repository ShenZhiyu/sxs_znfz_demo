/** demo 自定义的离线 MCP 命令：产生标准工具调用，执行和状态事件仍由真实 AgentLoop 负责。 */
import { ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { randomUUID } from 'node:crypto'

export function* offlineMcp(options: GenerateOptions, showPlatformResults = false): Generator<StreamChunk, boolean> {
  // 只处理当前用户的 MCP 命令，避免把前一轮工具结果当作本轮结果。
  const index = options.messages.findLastIndex(message => message.role === 'user' && (message.source === undefined || message.source.kind === 'user'))
  const prompt = options.messages[index]?.content.filter(block => block.type === 'text').map(block => block.text).join('') ?? ''
  const command = prompt.trim()
  if (!/^\/mcp(?:__|\s|$)/.test(command)) return false
  const match = command.match(/^\/(?:mcp\s+(\S+)|(mcp__\S+))(?:\s+([\s\S]+))?$/)
  const name = match?.[1] ?? match?.[2], raw = match?.[3] ?? '{}'
  const result = options.messages.slice(index + 1).findLast(message => message.role === 'tool')
  let text = ''
  let args: unknown
  if (!name) text = '用法：/mcp__服务名__工具名 JSON参数，例如 /mcp__environment__get_environment_config。无参数时可省略 JSON。'
  else if (result?.role === 'tool') {
    text = `MCP ${result.isError ? '调用失败' : '调用完成'}。完整原始内容请查看工具返回结果。`
    if (/^mcp__(environment|acoustic_field|signal_processing|replay|evaluation)__/.test(name)) {
      const rawResult = result.content.find(block => block.type === 'text')
      if (rawResult?.type === 'text') {
        if (showPlatformResults) {
          text = `MCP ${result.isError ? '调用失败' : '调用完成'}。\n${rawResult.text}`
        } else {
          try {
            const value = JSON.parse(rawResult.text)
            if (result.isError && typeof value.error?.message === 'string') text += '\n' + value.error.message
            else if (typeof value.data?.path === 'string') text += '\n已保存：' + value.data.path
          } catch { /* 协议错误仍保留工具状态。 */ }
        }
      }
    }
  }
  else if (!name.startsWith('mcp__') || !options.tools?.some(tool => tool.name === name)) text = '该 MCP 工具当前不可用，请检查服务连接和启用状态，在 MCP 管理页查看当前可用工具名称。'
  else {
    // JSON 必须为对象；更具体的字段类型交给实际工具的 schema 校验。
    try { args = JSON.parse(raw) } catch { text = 'MCP 参数必须是有效 JSON 对象，例如 {"a":2,"b":3}。' }
    if (!text && (!args || typeof args !== 'object' || Array.isArray(args))) text = 'MCP 参数必须是 JSON 对象，不能是数组、字符串或 null。'
    if (!text) {
      const id = ToolCallId(randomUUID()), argumentsJson = JSON.stringify(args)
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: argumentsJson }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: argumentsJson } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return true
    }
  }
  // 第二次模型请求只说明完成状态，完整返回值由已有的工具结果卡片展示。
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text }
  yield { type: 'block-end', index: 0, block: { type: 'text', text } }
  yield { type: 'finish', reason: { kind: 'stop' } }
  return true
}
