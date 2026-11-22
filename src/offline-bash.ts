/** 手动离线测试入口 /bash；只产生官方 bash 工具调用，不自行 spawn 进程。 */
import { ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { randomUUID } from 'node:crypto'

export function* offlineBash(options: GenerateOptions): Generator<StreamChunk, boolean> {
  const index = options.messages.findLastIndex(message => message.role === 'user' && (message.source === undefined || message.source.kind === 'user'))
  const prompt = options.messages[index]?.content.filter(block => block.type === 'text').map(block => block.text).join('') ?? ''
  if (!/^\/bash(?:\s|$)/.test(prompt)) return false
  const command = prompt.replace(/^\/bash\s*/, '')
  const result = options.messages.slice(index + 1).findLast(message => message.role === 'tool')
  let text = ''
  if (!command.trim()) text = '离线测试用法：/bash printf "hello\\n"。这不是通用斜杠命令，不参与补全。'
  else if (result?.role === 'tool') text = `（离线 Bash 验证，以下为官方工具原始返回）\n${result.content.filter(block => block.type === 'text').map(block => block.text).join('')}`
  else if (!options.tools?.some(tool => tool.name === 'bash')) text = '官方 bash 工具尚未就绪，请检查 tool-bash、bash-local、subprocess-local、shell-env 和工作目录依赖。'
  else {
    const id = ToolCallId(randomUUID())
    const args = JSON.stringify({ description: '执行用户指定的本机 Bash 命令', command })
    yield { type: 'block-start', index: 0, blockType: 'tool-call' }
    yield { type: 'tool-call-delta', index: 0, id, name: 'bash', argumentsDelta: args }
    yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'bash', arguments: args } }
    yield { type: 'finish', reason: { kind: 'tool-calls' } }
    return true
  }
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text }
  yield { type: 'block-end', index: 0, block: { type: 'text', text } }
  yield { type: 'finish', reason: { kind: 'stop' } }
  return true
}
