/** MCP 工具只是参数边界与协议适配，流程决策统一交给模板运行器。 */
import { z } from 'zod'
import { SimulationWorkflow } from './workflow.mjs'

// 数字单位直接写进参数说明，真实模型也能按自然语言填写场景。
const parameters = z.object({
  distanceM: z.number().min(10).max(100000).optional().describe('收发距离，米'),
  carrierKhz: z.number().min(0.1).max(100).optional().describe('载频，kHz'),
  bandwidthHz: z.number().min(100).max(50000).optional(),
  sourceLevelDb: z.number().min(60).max(220).optional().describe('简化声源级，dB'),
  noisePsdDb: z.number().min(0).max(120).optional().describe('平坦噪声谱密度，dB/Hz'),
  soundSpeedMps: z.number().min(1400).max(1600).optional(),
  depthM: z.number().min(1).max(10000).optional(),
  relativeSpeedMps: z.number().min(-10).max(10).optional(),
  packetBits: z.number().int().min(16).max(8192).optional(),
  seed: z.number().int().min(1).max(4294967295).optional(),
}).strict()
const planInput = z.object({ templateId: z.literal('underwater-link').default('underwater-link'), scale: z.enum(['small', 'medium', 'large']).default('small'), target: z.enum(['channel', 'communication', 'link']).default('link'), parameters: parameters.default({}) })
const jobInput = z.object({ jobId: z.string().uuid() })

// 创建与当前 MCP 服务实例同生命周期的工作流；服务关闭时取消并回收它的所有计算。
export function registerSimulationTools(server, options = {}) {
  const workflow = new SimulationWorkflow(options)
  const tool = (name, description, inputSchema, operation, readOnly = false) => server.registerTool(name, {
    description, inputSchema, annotations: { readOnlyHint: readOnly, destructiveHint: false },
  }, async (args, extra) => {
    try {
      const value = await operation(args, extra)
      return { content: [{ type: 'text', text: JSON.stringify(value) }] }
    } catch (error) { return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: error.message }) }] } }
  })
  tool('simulation_templates', '查看水下通信仿真模板、节点上下级、依赖、串行组和规模资源策略。', z.object({}), () => workflow.templates(), true)
  tool('cluster_resources', '实时查询本机演示集群配额及本机资源观测，返回 snapshotId。申请前必须先查询；这不是实际集群资源隔离。', z.object({}), () => workflow.pool.inspect(), true)
  tool('simulation_plan', '按场景和规模生成不可变的仿真计划及推荐 CPU/内存配额，不开始计算。', planInput, args => workflow.plan(args))
  tool('request_resources', '根据计划动态申请资源。必须提交先前 cluster_resources 返回的有效 snapshotId；资源不足或快照过期会拒绝。', z.object({ planId: z.string().uuid(), snapshotId: z.string().uuid() }), args => workflow.reserve(args))
  tool('release_resources', '归还尚未提交的闲置租约；运行中任务必须先调用 cancel_simulation。', z.object({ leaseId: z.string().uuid() }), args => workflow.pool.release(args.leaseId))
  tool('submit_simulation', '提交已有计划和专属租约，立即返回 jobId。脚本强制依赖、并行资源限额和串行锁，任务在后台运行。', z.object({ planId: z.string().uuid(), leaseId: z.string().uuid() }), args => workflow.submit(args))
  tool('run_simulation', '启动完整水下通信链路演示。模板脚本自动按规划→查询集群→动态申请资源→提交的顺序执行；立即返回 jobId。需要监控时循环调用 simulation_status(waitMs=1000)，直到 completed/failed/cancelled，再总结结果；不要自己排序或绕过节点依赖。', planInput, args => workflow.launch(args))
  // 三种计算功能各有独立 MCP 入口，但共享同一份流程模板和约束执行器。
  tool('simulate_channel', '执行信道仿真及必需的场景准备，返回异步 jobId。模板自动先查询并申请规模资源；用 simulation_status 查看传播、多径和噪声结果。', planInput.omit({ target: true }), args => workflow.launch({ ...args, target: 'channel' }))
  tool('simulate_communication', '执行通信仿真，自动包含同参数的信道前置任务，QPSK 与 BPSK 可并行；不跳过尚未计算的上游。返回 jobId 后查询状态。', planInput.omit({ target: true }), args => workflow.launch({ ...args, target: 'communication' }))
  tool('simulate_link', '执行完整链路仿真，自动包含信道和通信前置、链路预算、分组蒙特卡洛与报告。模板负责资源申请和串并行约束。', planInput.omit({ target: true }), args => workflow.launch({ ...args, target: 'link' }))
  tool('simulation_status', '查询后台任务和各节点的实时状态、进度、资源租约、结果与事件。afterSeq 用于只取新增事件；waitMs<=2000 可限时等待。终态为 completed/failed/cancelled。', jobInput.extend({ afterSeq: z.number().int().min(-1).default(-1), waitMs: z.number().int().min(0).max(2000).default(0) }), (args, extra) => workflow.watch(args, extra.signal), true)
  tool('list_simulations', '列出本机演示服务的任务；任务独立于聊天轮次，停止生成不会取消后台仿真。', z.object({}), () => ({ jobs: workflow.list() }), true)
  tool('cancel_simulation', '取消指定仿真任务，终止活动计算子进程，等待它们退出后回收资源；返回最终状态。', jobInput, args => workflow.cancel(args.jobId))
  return workflow
}
