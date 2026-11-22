/** 真子进程测试：约束、数值结果、资源并发、错误和取消，不用假时钟伪造完成。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, mkdir, writeFile, readFile, copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { SimulationWorkflow } from './workflow.mjs'
import { ResourcePool } from './resources.mjs'
import { absorptionDbKm } from './kernels.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
const terminal = new Set(['completed', 'failed', 'cancelled'])
// 每个测试自己拥有资源目录和调度器，所有分支都等待清理。
async function fixture(fn, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-sim-unit-'))
  const workflow = new SimulationWorkflow({ dataDir: directory, pacingMs: 60, ...options })
  try { return await fn(workflow, directory) } finally { await workflow.close(); await rm(directory, { recursive: true, force: true }) }
}
async function until(read, predicate) {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) { const value = await read(); if (predicate(value)) return value; await delay(20) }
  throw new Error('等待真实执行超时')
}
const finish = (workflow, id) => until(() => workflow.status(id), job => terminal.has(job.status))

test('资源申请必须先查询；过期或陈旧快照、超额申请和重复绑定都被拒绝', async () => fixture(async workflow => {
  const large = workflow.plan({ scale: 'large' })
  assert.throws(() => workflow.submit({ planId: large.id, leaseId: 'unknown' }), /先查询集群/)
  assert.throws(() => workflow.reserve({ planId: large.id, snapshotId: 'unknown' }), /先调用 cluster_resources/)
  const snapshot = workflow.pool.inspect(), lease = workflow.reserve({ planId: large.id, snapshotId: snapshot.snapshotId })
  const second = workflow.plan({ scale: 'large' })
  assert.throws(() => workflow.reserve({ planId: second.id, snapshotId: snapshot.snapshotId }), /资源已变化/)
  assert.throws(() => workflow.reserve({ planId: second.id, snapshotId: workflow.pool.inspect().snapshotId }), /配额不足/)
  workflow.pool.release(lease.id)
  assert.equal(workflow.pool.inspect().used.cpu, 0)
  const pool = new ResourcePool({ ...workflow.cluster, snapshotTtlMs: 2 })
  const expired = pool.inspect(); await delay(5)
  assert.throws(() => pool.reserve(large, expired.snapshotId), /过期/)
}))

test('DAG 父节点先完成、共享求解器串行、独立模块真正重叠；资源峰值不超租约', async () => fixture(async workflow => {
  const initial = workflow.launch({ scale: 'small' })
  assert.deepEqual(initial.events.slice(0, 4).map(event => event.type), ['workflow/planned', 'cluster/inspected', 'resources/reserved', 'job/submitted'])
  assert.equal(workflow.pool.inspect().used.cpu, 4)
  assert.throws(() => workflow.pool.release(initial.lease.id), /正在被任务使用/)
  const job = await finish(workflow, initial.id), byId = new Map(job.nodes.map(node => [node.id, node]))
  assert.equal(job.status, 'completed', job.error)
  for (const node of job.nodes) for (const dep of node.dependsOn) assert.ok(node.startedAt >= byId.get(dep).endedAt, `${node.id} 提前执行`)
  assert.ok(byId.get('multipath').startedAt >= byId.get('propagation').endedAt)
  const overlap = (a, b) => Math.max(a.startedAt, b.startedAt) < Math.min(a.endedAt, b.endedAt)
  assert.ok(overlap(byId.get('propagation'), byId.get('noise')))
  assert.ok(overlap(byId.get('comm-qpsk'), byId.get('comm-bpsk')))
  const active = new Set()
  for (const event of job.events) {
    if (event.type === 'node/started') active.add(event.data.nodeId)
    if (event.type === 'node/completed') active.delete(event.data.nodeId)
    assert.ok(active.size <= job.policy.maxParallel)
    for (const key of ['cpu', 'memoryGb']) assert.ok([...active].reduce((sum, id) => sum + byId.get(id).resources[key], 0) <= job.lease.resources[key])
  }
  assert.equal(job.progress, 100)
  assert.equal(job.lease.state, 'released')
  const generated = await readFile(join(workflow.dataDir, job.id, 'scripts/comm-qpsk.mjs'), 'utf8')
  assert.match(generated, /process.argv\[2\] = "comm-qpsk"/); assert.ok(!generated.includes('{{'))
  assert.equal(workflow.pool.inspect().used.cpu, 0)
  assert.ok(Number.isFinite(job.results.report.link.goodputBps))
  assert.ok(job.results.report.link.packetDeliveryRatio >= 0 && job.results.report.link.packetDeliveryRatio <= 1)
}))

test('规模改变租约与真实样本量；同种子结果可重复，独立阶段不跳过前置', async () => fixture(async workflow => {
  const small = workflow.plan({ scale: 'small' }), large = workflow.plan({ scale: 'large' })
  assert.ok(large.resources.cpu > small.resources.cpu)
  assert.ok(large.policy.sampleBits > small.policy.sampleBits)
  const first = await finish(workflow, workflow.launch({ target: 'communication', parameters: { seed: 123 } }).id)
  const second = await finish(workflow, workflow.launch({ target: 'communication', parameters: { seed: 123 } }).id)
  assert.deepEqual(first.results, second.results)
  assert.ok(first.results['channel-summary'])
  assert.ok(first.results['comm-qpsk'])
  assert.equal(first.results.report, undefined)
  assert.ok(absorptionDbKm(20) > absorptionDbKm(1))
  assert.throws(() => workflow.plan({ parameters: { distanceM: -1 } }), /允许范围/)
}))

test('并发任务共用资源账本，取消后真实子进程退出并回收全部配额', async () => fixture(async workflow => {
  const small = workflow.launch({ scale: 'small' }), large = workflow.launch({ scale: 'large' })
  assert.equal(workflow.pool.inspect().used.cpu, 16)
  assert.throws(() => workflow.launch({ scale: 'small' }), /配额不足/)
  await until(() => workflow.status(small.id), job => job.nodes.some(node => node.pid))
  const pids = workflow.status(small.id).nodes.filter(node => node.pid).map(node => node.pid)
  const cancelled = await workflow.cancel(small.id)
  assert.equal(cancelled.status, 'cancelled')
  assert.equal(cancelled.lease.state, 'released')
  for (const pid of pids) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
  await workflow.cancel(large.id)
  assert.deepEqual(workflow.pool.inspect().used, { cpu: 0, memoryGb: 0 })
}))

test('节点失败会阻断后继、停止同批工作并回收资源；循环模板在提交前被拒绝', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-sim-failure-'))
  try {
    await mkdir(join(directory, 'simulation/templates'), { recursive: true }); await mkdir(join(directory, 'scripts'))
    const templatePath = join(directory, 'simulation/templates/underwater-link.json')
    await copyFile(join(root, 'simulation/templates/underwater-link.json'), templatePath)
    await copyFile(join(root, 'simulation/templates/cluster.json'), join(directory, 'simulation/templates/cluster.json'))
    await copyFile(join(root, 'simulation/templates/run-node.mjs.tpl'), join(directory, 'simulation/templates/run-node.mjs.tpl'))
    const original = pathToFileURL(join(root, 'scripts/simulation-node.mjs')).href
    await writeFile(join(directory, 'scripts/simulation-node.mjs'), `if(process.argv[2]==='propagation'){console.error('injected solver failure');process.exit(2)}else await import(${JSON.stringify(original)})`)
    const workflow = new SimulationWorkflow({ root: directory, pacingMs: 20 })
    try {
      const job = await finish(workflow, workflow.launch({}).id)
      assert.equal(job.status, 'failed'); assert.match(job.error, /injected solver failure/)
      assert.equal(job.nodes.find(node => node.id === 'comm-qpsk').status, 'skipped')
      assert.equal(job.results.report, undefined)
      assert.equal(workflow.pool.inspect().used.cpu, 0)
    } finally { await workflow.close() }
    const template = JSON.parse(await readFile(templatePath, 'utf8'))
    template.nodes[0].dependsOn = ['report']
    await writeFile(templatePath, JSON.stringify(template))
    assert.throws(() => new SimulationWorkflow({ root: directory }), /循环依赖/)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('同一 MCP 服务的多个任务共享求解器串行锁，不能跨任务绕过', async () => fixture(async workflow => {
  const a = workflow.launch({ target: 'channel' }), b = workflow.launch({ target: 'channel' })
  const jobs = await Promise.all([finish(workflow, a.id), finish(workflow, b.id)])
  for (const job of jobs) assert.equal(job.status, 'completed', job.error)
  const serial = jobs.flatMap(job => job.nodes.filter(node => node.serialGroup)).sort((a, b) => a.startedAt - b.startedAt)
  for (let i = 1; i < serial.length; i++) assert.ok(serial[i].startedAt >= serial[i - 1].endedAt)
  assert.equal(workflow.serialLocks.size, 0)
}))

test('服务关闭等待活动任务回收；重启后只恢复结果，不恢复旧租约', async () => fixture(async (workflow, directory) => {
  const job = workflow.launch({})
  await workflow.close()
  assert.equal(workflow.status(job.id).status, 'cancelled')
  assert.equal(workflow.pool.inspect().used.cpu, 0)
  const restored = new SimulationWorkflow({ dataDir: directory, pacingMs: 0 })
  try { assert.equal(restored.status(job.id).status, 'cancelled'); assert.equal(restored.status(job.id).restored, true); assert.equal(restored.pool.inspect().used.cpu, 0) } finally { await restored.close() }
}))
