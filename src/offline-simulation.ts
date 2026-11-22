/** 离线演示的固定工具调用规则；任务调度仍全部由后台模板脚本完成。 */
import { ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { randomUUID } from 'node:crypto'

// 把实际 MCP 文本结果转换成对象；普通对话与其他工具的文字不参与仿真状态推断。
function objectFrom(message: GenerateOptions['messages'][number]): Record<string, any> | undefined {
  if (message.role !== 'tool') return
  try { return JSON.parse(message.content.filter(block => block.type === 'text').map(block => block.text).join('')) } catch { return }
}
// 产出标准文本块，让用户在下一次状态查询之前就能看到已经发生的变化。
function* textChunks(text: string, index = 0): Generator<StreamChunk> {
  yield { type: 'block-start', index, blockType: 'text' }
  yield { type: 'text-delta', index, text }
  yield { type: 'block-end', index, block: { type: 'text', text } }
}
// 所有调用都先检查模型本轮实际可见的工具，不直接访问计算模块或伪造返回值。
function* call(options: GenerateOptions, name: string, args: unknown, text = ''): Generator<StreamChunk> {
  if (!options.tools?.some(tool => tool.name === name)) {
    yield* textChunks('仿真 MCP 工具尚未就绪，请启用 MCP 插件。')
    yield { type: 'finish', reason: { kind: 'stop' } }
    return
  }
  if (text) yield* textChunks(text)
  const id = ToolCallId(randomUUID()), index = text ? 1 : 0, argumentsJson = JSON.stringify(args)
  yield { type: 'block-start', index, blockType: 'tool-call' }
  yield { type: 'tool-call-delta', index, id, name, argumentsDelta: argumentsJson }
  yield { type: 'block-end', index, block: { type: 'tool-call', id, name, arguments: argumentsJson } }
  yield { type: 'finish', reason: { kind: 'tool-calls' } }
}
// 返回 true 表示已处理显式演示命令；普通对话继续由原模拟器回显。
export async function* offlineSimulation(options: GenerateOptions): AsyncGenerator<StreamChunk, boolean> {
  const userIndex = options.messages.findLastIndex(message => message.role === 'user' && (message.source === undefined || message.source.kind === 'user'))
  const prompt = options.messages[userIndex]?.content.filter(block => block.type === 'text').map(block => block.text).join('') ?? ''
  if (!/^\/(simulate|sim-resources|sim-status|sim-cancel)(?:\s|$)/.test(prompt)) return false
  const [command, ...words] = prompt.trim().split(/\s+/)
  const current = options.messages.slice(userIndex + 1).filter(message => message.role === 'tool')
  const last = current.at(-1), result = last ? objectFrom(last) : undefined
  // 显式命令的参数错误也用正常文本反馈，不让 Agent 卡在工具循环。
  const finish = function* (text: string): Generator<StreamChunk> { yield* textChunks(text); yield { type: 'finish', reason: { kind: 'stop' } } }
  if (last?.role === 'tool' && (last.isError || result?.error)) {
    yield* finish(`仿真操作失败：${result?.error ?? 'MCP 工具返回错误'}。\n`)
    return true
  }
  if (command === '/simulate') {
    if (!result) {
      const scale = words.shift() ?? 'small'
      let parameters
      try { parameters = words.length ? JSON.parse(words.join(' ')) : {} } catch { yield* finish('参数 JSON 无效。示例：/simulate small {"distanceM":2000}'); return true }
      if (!['small', 'medium', 'large'].includes(scale)) { yield* finish('用法：/simulate small|medium|large，可在规模后追加场景 JSON。'); return true }
      yield* call(options, 'mcp__demo__run_simulation', { scale, parameters }, '正在按模板规划仿真、查询集群资源并申请配额。\n')
      return true
    }
    const job = result
    const running = job.nodes.filter((node: any) => node.status === 'running').map((node: any) => node.title).join('、')
    const activity = job.events.filter((event: any) => ['node/started', 'node/completed', 'resources/reserved', 'resources/released'].includes(event.type)).map((event: any) => event.type.startsWith('node/') ? `${event.type === 'node/started' ? '开始' : '完成'}：${job.nodes.find((node: any) => node.id === event.data.nodeId)?.title}` : event.type === 'resources/reserved' ? `已申请 ${job.lease.resources.cpu} CPU / ${job.lease.resources.memoryGb} GB 演示配额` : '已释放计算配额').join('；')
    const text = `任务 ${job.id} · ${job.status} · ${job.progress}%${running ? ' · 正在执行：' + running : ''}\n${activity ? activity + '\n' : ''}`
    if (['completed', 'failed', 'cancelled'].includes(job.status)) {
      const report = job.results.report
      yield* finish(text + (report ? `仿真完成：选择 ${report.selectedModulation}，分组投递率 ${(report.link.packetDeliveryRatio * 100).toFixed(2)}%，有效吞吐 ${report.link.goodputBps.toFixed(1)} bit/s。\n结果目录：${job.artifacts.directory}\n` : `任务结束：${job.error ?? job.status}。\n`))
    } else {
      // 每次查询最多等待一秒，后台仍可处理其他 Agent 的查询或取消请求。
      yield* call(options, 'mcp__demo__simulation_status', { jobId: job.id, afterSeq: job.lastSeq, waitMs: 1000 }, text)
    }
    return true
  }
  const names: Record<string, string> = { '/sim-resources': 'cluster_resources', '/sim-status': 'simulation_status', '/sim-cancel': 'cancel_simulation' }
  if (!result) {
    const previous = [...options.messages.slice(0, userIndex)].reverse().map(objectFrom).find(value => value?.id && value?.nodes)
    const jobId = words[0] ?? previous?.id
    if (command !== '/sim-resources' && !jobId) { yield* finish('请提供任务 ID，或先在本对话执行 /simulate small。'); return true }
    yield* call(options, 'mcp__demo__' + names[command], command === '/sim-resources' ? {} : { jobId })
  } else if (command === '/sim-resources') {
    yield* finish(`本机演示集群：可用 ${result.available.cpu}/${result.capacity.cpu} CPU、${result.available.memoryGb}/${result.capacity.memoryGb} GB。\n这是模板配额账本，不代表物理资源隔离。\n`)
  } else {
    yield* finish(`任务 ${result.id}：${result.status}，进度 ${result.progress}%。\n${JSON.stringify(result.nodes.map((node: any) => ({ node: node.title, state: node.status, progress: node.progress })), null, 2)}\n`)
  }
  return true
}
