/** 集成验证：官方 MCP 客户端与真实 Agent/Web，外部模型由离线适配器替代。 */
import assert from 'node:assert/strict'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
const root = fileURLToPath(new URL('../', import.meta.url))
// 用真实 stdio MCP 协议验证低层接口的前置约束与取消，数据目录独立于用户历史。
const directory = await mkdtemp(join(tmpdir(), 'dsh-sim-mcp-'))
const client = new Client({ name: 'simulation-smoke', version: '1.0.0' })
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(root, 'scripts/mcp-server.mjs'), '--simulation-data', directory], cwd: root }))
  const tools = (await client.listTools()).tools.map(tool => tool.name)
  for (const name of ['simulate_channel', 'simulate_communication', 'simulate_link', 'cluster_resources', 'simulation_plan', 'request_resources', 'submit_simulation', 'run_simulation', 'simulation_status', 'cancel_simulation']) assert.ok(tools.includes(name), name)
  const call = async (name, args = {}, expectedError = false) => {
    const response = await client.callTool({ name, arguments: args })
    assert.equal(!!response.isError, expectedError, JSON.stringify(response))
    return JSON.parse(response.content.filter(block => block.type === 'text').map(block => block.text).join(''))
  }
  const plan = await call('simulation_plan', { scale: 'small' })
  assert.match((await call('submit_simulation', { planId: plan.id, leaseId: '00000000-0000-4000-8000-000000000000' }, true)).error, /先查询集群/)
  const snapshot = await call('cluster_resources'), lease = await call('request_resources', { planId: plan.id, snapshotId: snapshot.snapshotId })
  const submitted = await call('submit_simulation', { planId: plan.id, leaseId: lease.id })
  const live = await call('simulation_status', { jobId: submitted.id, waitMs: 200 })
  assert.equal(live.status, 'running')
  assert.ok(live.nodes.some(node => node.status === 'running'))
  const cancelled = await call('cancel_simulation', { jobId: submitted.id })
  assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.lease.state, 'released')
  assert.equal((await call('cluster_resources')).used.cpu, 0)
  console.log('真实 MCP 工具发现、查询→申请→提交约束、动态状态、取消与资源回收通过。')
} finally { await client.close(); await rm(directory, { recursive: true, force: true }) }

async function start() {
  const sessionDirectory = await mkdtemp(join(tmpdir(), 'dsh-simulation-sessions-'))
  const child = spawn(process.execPath, ['scripts/run.mjs', 'web', '--offline', '--port', '0'], { cwd: root, env: { ...process.env, DSH_DEMO_SESSION_DIR: sessionDirectory } })
  child.stdin.end()
  let output = '', errors = ''
  const closed = new Promise(resolve => child.on('close', code => resolve(code)))
  const origin = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('仿真 Web 启动超时：' + errors)) }, 15000)
    child.stdout.setEncoding('utf8').on('data', text => { output += text; const match = output.match(/dsh demo web: (http:\/\/127\.0\.0\.1:\d+)/); if (match) { clearTimeout(timer); resolve(match[1]) } })
    child.stderr.setEncoding('utf8').on('data', text => { errors += text })
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('close', code => { clearTimeout(timer); reject(new Error(`仿真 Web 提前退出 ${code}：${errors}`)) })
  })
  return { origin, async stop() { child.kill('SIGTERM'); try { assert.equal(await closed, 0, errors) } finally { await rm(sessionDirectory, { recursive: true, force: true }) } } }
}
async function until(read, predicate) {
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) { const value = await read(); if (predicate(value)) return value; await delay(100) }
  throw new Error('等待仿真状态超时')
}
const app = await start()
try {
  const api = async (path, body) => {
    const response = await fetch(app.origin + path, { signal: AbortSignal.timeout(20000), ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) })
    const value = await response.json(); assert.equal(response.ok, true, JSON.stringify(value)); return value
  }
  const create = async () => (await api('/api/sessions', {})).sessionId
  const send = async (sessionId, message) => fetch(app.origin + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId, message }), signal: AbortSignal.timeout(30000) })
  const started = Date.now(), response = await send(await create(), '/simulate small {"distanceM":1200,"seed":87}')
  // 持续消费 SSE，后台状态查询与同一个 Agent 的工具调用并行发生。
  const body = response.text()
  const list = await until(() => api('/api/simulations'), value => value.jobs.some(job => job.createdAt >= started))
  const jobId = list.jobs.find(job => job.createdAt >= started).id
  const live = await api('/api/simulations/' + jobId)
  assert.ok(['queued', 'running'].includes(live.status))
  assert.equal(live.lease.state, 'bound')
  assert.ok((await api('/api/simulation-resources')).used.cpu >= 4)
  const text = await body
  const frames = text.trim().split('\n\n').map(frame => { const lines = frame.split('\n'); return { type: lines[0].slice(7), data: JSON.parse(lines[1].slice(6)) } })
  assert.equal(frames.at(-1).type, 'done', text.slice(-2000))
  const visible = frames.filter(frame => frame.type === 'delta').map(frame => frame.data.text).join('')
  assert.match(visible, /已申请 4 CPU/); assert.match(visible, /正在执行/); assert.match(visible, /仿真完成/)
  const completed = await api('/api/simulations/' + jobId)
  assert.equal(completed.status, 'completed'); assert.equal(completed.results.report.parameters.distanceM, 1200)
  const runId = frames.find(frame => frame.type === 'run').data.id, run = await api('/api/runs/' + runId)
  assert.ok(run.events.some(event => event.kind === 'session/tool/call' && JSON.stringify(event.data).includes('mcp__demo__run_simulation')))
  assert.ok(run.events.some(event => event.kind === 'session/tool/call' && JSON.stringify(event.data).includes('mcp__demo__simulation_status')))
  assert.equal(completed.lease.state, 'released')
  // 再创建一项真实后台任务，从监控接口取消，验证它与 Agent 查询的是同一调度器。
  const secondStarted = Date.now(), secondResponse = await send(await create(), '/simulate large')
  const secondBody = secondResponse.text()
  const secondList = await until(() => api('/api/simulations'), value => value.jobs.some(job => job.createdAt >= secondStarted))
  const secondId = secondList.jobs.find(job => job.createdAt >= secondStarted).id
  const cancelled = await api('/api/simulation-cancel/' + secondId, {})
  assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.lease.state, 'released')
  assert.match(await secondBody, /cancelled/)
  assert.equal((await api('/api/simulation-resources')).used.cpu, 0)
  // 插件卸载也必须关闭活动计算，重新启用后从磁盘看到真实取消快照。
  const unloadStarted = Date.now(), unloadResponse = await send(await create(), '/simulate medium')
  const unloadBody = unloadResponse.text()
  const unloadList = await until(() => api('/api/simulations'), value => value.jobs.some(job => job.createdAt >= unloadStarted))
  const unloadId = unloadList.jobs.find(job => job.createdAt >= unloadStarted).id
  const entry = (await api('/api/plugins')).entries.find(entry => entry.key === 'mcp-demo')
  await api('/api/plugins/toggle', { id: entry.id, enabled: false })
  await unloadBody
  assert.equal((await fetch(app.origin + '/api/simulations')).status, 503)
  await api('/api/plugins/toggle', { id: entry.id, enabled: true })
  const restored = await api('/api/simulations/' + unloadId)
  assert.equal(restored.status, 'cancelled'); assert.equal(restored.lease.state, 'released')
  assert.equal((await api('/api/simulation-resources')).used.cpu, 0)
  console.log('真实 Agent→MCP→后台模板执行、运行中 HTTP 监控、结果报告、任务取消与资源回收通过。')
} finally { await app.stop() }
