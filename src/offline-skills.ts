/** 离线适配器：观察官方 /技能名 注入；旧 /skill 别名只作为手动工具测试入口。 */
import { ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { randomUUID } from 'node:crypto'

export function* offlineSkills(options: GenerateOptions): Generator<StreamChunk, boolean> {
  const index = options.messages.findLastIndex(message => message.role === 'user' && (message.source === undefined || message.source.kind === 'user'))
  const prompt = options.messages[index]?.content.filter(block => block.type === 'text').map(block => block.text).join('') ?? ''
  // 官方 tool-skill 已在 pre-step 执行显式加载，适配器只报告实际收到的上下文。
  const injected = options.messages.slice(index + 1).filter(message => message.role === 'user' && message.source?.kind === 'skill-invocation')
  if (injected.length) {
    const text = '官方 Skill 插件已加载并注入技能指令。离线适配器仅验证注入，不理解或自动执行这些指令；可在原始请求和调用过程查看 skill-invocation 内容。'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'finish', reason: { kind: 'stop' } }
    return true
  }
  if (!/^\/skill(?:\s|$)/.test(prompt)) return false
  const name = prompt.trim().split(/\s+/)[1]
  const last = options.messages.slice(index + 1).findLast(message => message.role === 'tool')
  let text = ''
  if (!name) text = '用法：/skill 技能名称。请先在 Skill 管理页启用该技能。'
  else if (!options.tools?.some(tool => tool.name === 'skill')) text = '技能加载工具尚未就绪，请启用官方 skill、tool-skill、working-directory 及其依赖。'
  else if (last?.role === 'tool') text = last.isError ? '技能加载失败，请查看上方工具返回结果。' : `已通过官方 skill 工具加载技能 ${name}。完整指令见上方工具返回结果。`
  else {
    const id = ToolCallId(randomUUID()), args = JSON.stringify({ name })
    yield { type: 'block-start', index: 0, blockType: 'tool-call' }
    yield { type: 'tool-call-delta', index: 0, id, name: 'skill', argumentsDelta: args }
    yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'skill', arguments: args } }
    yield { type: 'finish', reason: { kind: 'tool-calls' } }
    return true
  }
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text }
  yield { type: 'block-end', index: 0, block: { type: 'text', text } }
  yield { type: 'finish', reason: { kind: 'stop' } }
  return true
}
