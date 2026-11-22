/** 无 Agent 的模板脚本入口，复用与 MCP 完全相同的规划、资源和 DAG 调度流程。 */
import { SimulationWorkflow } from '../simulation/workflow.mjs'
// 仅接受规模，场景参数扩展优先放进模板 defaults，保持命令可复现。
const workflow = new SimulationWorkflow()
const scale = process.argv[2] ?? 'small'
let jobId, cursor = -1
// 每行一份 JSON，便于后台脚本或日志系统读取增量状态。
const output = value => process.stdout.write(JSON.stringify(value) + '\n')
const stop = () => { void workflow.close() }
process.once('SIGINT', stop)
process.once('SIGTERM', stop)
try {
  const job = workflow.launch({ scale, target: process.argv[3] ?? 'link' })
  jobId = job.id
  output({ type: 'submitted', jobId, resources: job.lease.resources, template: job.templateId })
  while (true) {
    const state = await workflow.watch({ jobId, afterSeq: cursor, waitMs: 500 })
    for (const event of state.events) output(event)
    cursor = state.lastSeq
    if (['completed', 'failed', 'cancelled'].includes(state.status)) {
      output({ type: 'final', status: state.status, result: state.results.report, artifacts: state.artifacts })
      if (state.status !== 'completed') process.exitCode = 1
      break
    }
  }
} catch (error) { console.error(error.message); process.exitCode = 1 }
finally { await workflow.close() }
