/** 模板驱动的任务管理器：强制 DAG、串行锁、任务内资源上限和终态回收。 */
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync, readdirSync } from 'node:fs'
import { resolve, dirname, isAbsolute, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { randomUUID, createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { ResourcePool } from './resources.mjs'
import { TASKS } from './kernels.mjs'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const TERMINAL = new Set(['completed', 'failed', 'cancelled'])
// MCP 与无 Agent 的脚本入口共用同一个运行器，不让模型自由决定节点执行顺序。
export class SimulationWorkflow {
  constructor({ root = ROOT, dataDir = resolve(root, '.dsh/simulations'), pacingMs } = {}) {
    this.root = root
    this.dataDir = dataDir
    this.pacingMs = pacingMs
    this.cluster = JSON.parse(readFileSync(resolve(root, 'simulation/templates/cluster.json'), 'utf8'))
    this.template = JSON.parse(readFileSync(resolve(root, 'simulation/templates/underwater-link.json'), 'utf8'))
    this.validateTemplate()
    this.nodeTemplate = readFileSync(resolve(root, this.template.workerTemplate), 'utf8')
    this.pool = new ResourcePool(this.cluster)
    this.plans = new Map()
    this.jobs = new Map()
    this.running = new Map()
    // 串行求解器属于当前 MCP 服务，多个任务也不能同时占用同一把锁。
    this.serialLocks = new Map()
    this.closed = false
    mkdirSync(dataDir, { recursive: true })
    // 只恢复展示快照；不把上次进程的逻辑租约或正在运行状态伪装成仍然有效。
    for (const id of readdirSync(dataDir)) {
      if (!/^[a-f0-9-]{36}$/.test(id)) continue
      const file = resolve(dataDir, id, 'job.json')
      if (!existsSync(file)) continue
      const job = JSON.parse(readFileSync(file, 'utf8'))
      if (!TERMINAL.has(job.status)) {
        job.status = 'failed'; job.error = '服务重启，原执行已中断；不会自动重跑。'; job.endedAt = Date.now()
        job.lease.state = 'released'
        for (const node of job.nodes) if (!TERMINAL.has(node.status)) { node.status = 'cancelled'; node.endedAt = Date.now() }
      }
      job.restored = true
      this.jobs.set(id, job)
    }
  }
  // 模板错误在接受任务之前暴露；同名节点、环或不可满足资源都不能进入运行队列。
  validateTemplate() {
    const t = this.template, nodes = new Map(t.nodes.map(node => [node.id, node]))
    if (nodes.size !== t.nodes.length || !nodes.size) throw new Error('模板节点 ID 必须唯一且非空。')
    if (JSON.stringify(t.procedure) !== JSON.stringify(['plan', 'inspect', 'reserve', 'submit'])) throw new Error('流程模板必须先规划、查资源、申请资源，再提交。')
    for (const file of [t.worker, t.workerTemplate]) {
      if (!file || isAbsolute(file) || relative(this.root, resolve(this.root, file)).startsWith('..') || !existsSync(resolve(this.root, file))) throw new Error('worker 和脚本模板必须是项目内存在的文件。')
    }
    const groups = new Set(t.groups.map(group => group.id))
    if (groups.size !== t.groups.length || t.groups.some(group => !group.id || group.parentId !== null)) throw new Error('当前模板需要唯一的顶层阶段分组。')
    const done = new Set()
    if (!t.targets || Object.values(t.targets).some(ids => !ids.length || ids.some(id => !nodes.has(id)))) throw new Error('模板目标节点无效。')
    for (const node of t.nodes) {
      if (!/^[a-z][a-z0-9-]*$/.test(node.id) || !groups.has(node.group) || !TASKS.has(node.task)) throw new Error('节点名称、父分组或计算任务无效。')
      if (!node.dependsOn.every(id => nodes.has(id)) || ['cpu', 'memoryGb'].some(key => !Number.isInteger(node.resources[key]) || node.resources[key] < 1)) throw new Error('节点依赖或资源配置无效。')
    }
    while (done.size < nodes.size) {
      const ready = t.nodes.filter(node => !done.has(node.id) && node.dependsOn.every(id => done.has(id)))
      if (!ready.length) throw new Error('仿真模板包含循环依赖。')
      for (const node of ready) done.add(node.id)
    }
    for (const policy of Object.values(this.cluster.scales)) {
      if (policy.resources.cpu > this.cluster.capacity.cpu || policy.resources.memoryGb > this.cluster.capacity.memoryGb) throw new Error('规模资源超过整个演示集群。')
      const factor = policy.resources.cpu / this.cluster.scales.small.resources.cpu
      if (t.nodes.some(node => node.resources.cpu * factor > policy.resources.cpu || node.resources.memoryGb * factor > policy.resources.memoryGb)) throw new Error('规模租约不足以执行单个节点。')
    }
  }
  // 参数在 MCP schema 之外再次校验，直接脚本调用也不能绕过边界。
  parameters(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('仿真参数必须是 JSON 对象。')
    const p = { ...this.template.defaults, ...input }
    const bounds = { distanceM: [10, 100000], carrierKhz: [0.1, 100], bandwidthHz: [100, 50000], sourceLevelDb: [60, 220], noisePsdDb: [0, 120], soundSpeedMps: [1400, 1600], depthM: [1, 10000], relativeSpeedMps: [-10, 10], packetBits: [16, 8192], seed: [1, 4294967295] }
    for (const key of Object.keys(p)) if (!bounds[key] || !Number.isFinite(p[key]) || p[key] < bounds[key][0] || p[key] > bounds[key][1]) throw new Error(`仿真参数 ${key} 超出允许范围。`)
    if (!Number.isInteger(p.packetBits) || !Number.isInteger(p.seed)) throw new Error('packetBits 和 seed 必须是整数。')
    return p
  }
  templates() { return { templateId: this.template.id, title: this.template.title, version: this.template.version, procedure: this.template.procedure, scales: this.cluster.scales, groups: this.template.groups, nodes: this.template.nodes, targets: this.template.targets, defaults: this.template.defaults } }
  // 计划固定模板、参数和资源策略；后续修改磁盘模板不改变已经接受的计划。
  plan({ scale = 'small', parameters = {}, templateId = 'underwater-link', target = 'link' } = {}) {
    if (this.closed) throw new Error('仿真服务正在关闭。')
    if (templateId !== this.template.id || !Object.hasOwn(this.cluster.scales, scale) || !Object.hasOwn(this.template.targets, target)) throw new Error('未知仿真模板或规模。')
    const policy = structuredClone(this.cluster.scales[scale]), factor = policy.resources.cpu / this.cluster.scales.small.resources.cpu
    // 单模块工具也自动包含同一模板中所需的全部上游，不接受跨任务混用的未验证中间结果。
    const selected = new Set(), byId = new Map(this.template.nodes.map(node => [node.id, node]))
    const visit = id => { if (selected.has(id)) return; selected.add(id); for (const parent of byId.get(id).dependsOn) visit(parent) }
    for (const id of this.template.targets[target]) visit(id)
    const plan = { id: randomUUID(), templateId, target, templateVersion: this.template.version, templateHash: createHash('sha256').update(JSON.stringify(this.template) + this.nodeTemplate).digest('hex'), scale, parameters: this.parameters(parameters), resources: policy.resources, policy, groups: structuredClone(this.template.groups.filter(group => this.template.nodes.some(node => selected.has(node.id) && node.group === group.id))), nodes: this.template.nodes.filter(node => selected.has(node.id)).map(node => ({ ...structuredClone(node), resources: { cpu: Math.ceil(node.resources.cpu * factor), memoryGb: Math.ceil(node.resources.memoryGb * factor) } })), state: 'planned', createdAt: Date.now() }
    this.plans.set(plan.id, plan)
    return structuredClone(plan)
  }
  requirePlan(id) { const plan = this.plans.get(id); if (!plan) throw new Error('找不到仿真计划，请先调用 simulation_plan。'); return plan }
  reserve({ planId, snapshotId }) {
    const plan = this.requirePlan(planId)
    if (plan.state !== 'planned') throw new Error('计划已经申请过资源；请新建计划。')
    const lease = this.pool.reserve(plan, snapshotId)
    plan.state = 'reserved'; plan.leaseId = lease.id
    return lease
  }
  // 真正提交时检查租约，不能只把资源需求写进任务描述就开始计算。
  submit({ planId, leaseId }, preparation = []) {
    if (this.closed) throw new Error('仿真服务正在关闭。')
    const plan = this.requirePlan(planId), id = randomUUID()
    if (plan.state !== 'reserved') throw new Error('请先查询集群并申请当前计划所需的资源。')
    const lease = this.pool.bind(leaseId, planId, id)
    const job = { id, templateId: plan.templateId, target: plan.target, templateHash: plan.templateHash, templateVersion: plan.templateVersion, scale: plan.scale, parameters: plan.parameters, policy: plan.policy, lease, groups: plan.groups, status: 'queued', createdAt: Date.now(), updatedAt: Date.now(), progress: 0, events: [], nodes: plan.nodes.map(node => ({ ...node, status: 'pending', progress: 0 })), results: {} }
    try { this.persist(job) } catch (error) { this.pool.release(lease.id, id); throw error }
    this.jobs.set(id, job); plan.state = 'submitted'
    for (const step of preparation) this.event(job, step.type, step.data)
    this.event(job, 'job/submitted', { leaseId, resources: lease.resources })
    const run = { controller: new AbortController(), children: new Map() }
    this.running.set(id, run)
    // 返回 jobId 后由脚本运行后台流程，MCP 线程仍可接收状态查询和取消请求。
    run.done = Promise.resolve().then(() => this.execute(job, run))
    return this.status(id)
  }
  // 高层 MCP 工具只执行模板 procedure，不把资源和节点排序决策交给语言模型。
  launch(options) {
    let plan, snapshot, lease, job
    const history = []
    try {
      for (const step of this.template.procedure) {
        if (step === 'plan') { plan = this.plan(options); history.push({ type: 'workflow/planned', data: { planId: plan.id, scale: plan.scale, resources: plan.resources } }) }
        if (step === 'inspect') { snapshot = this.pool.inspect(); history.push({ type: 'cluster/inspected', data: snapshot }) }
        if (step === 'reserve') { lease = this.reserve({ planId: plan.id, snapshotId: snapshot.snapshotId }); history.push({ type: 'resources/reserved', data: lease }) }
        if (step === 'submit') job = this.submit({ planId: plan.id, leaseId: lease.id }, history)
      }
      return job
    } catch (error) { if (lease && !job) this.pool.release(lease.id); throw error }
  }
  // 快照与节点结果位于项目数据目录；不接受由工具调用者指定任意文件路径。
  persist(job) {
    const directory = resolve(this.dataDir, job.id)
    mkdirSync(directory, { recursive: true })
    const path = resolve(directory, 'job.json'), temp = path + '.tmp'
    writeFileSync(temp, JSON.stringify(job, null, 2)); renameSync(temp, path)
  }
  event(job, type, data = {}) {
    job.updatedAt = Date.now()
    job.progress = Math.floor(job.nodes.reduce((sum, node) => sum + node.progress, 0) / job.nodes.length)
    job.events.push({ seq: job.events.length, time: job.updatedAt, type, data })
    this.persist(job)
  }
  status(id, afterSeq = -1) {
    const job = this.jobs.get(id)
    if (!job) throw new Error('找不到仿真任务。')
    return structuredClone({ ...job, events: job.events.filter(event => event.seq > afterSeq), lastSeq: job.events.length - 1, artifacts: { directory: relative(this.root, resolve(this.dataDir, job.id)), snapshot: 'job.json', scripts: 'scripts/', report: job.results.report ? 'report.json' : null } })
  }
  list() { return [...this.jobs.values()].sort((a, b) => b.createdAt - a.createdAt).map(job => ({ id: job.id, status: job.status, progress: job.progress, scale: job.scale, target: job.target, createdAt: job.createdAt, updatedAt: job.updatedAt, parameters: job.parameters, lease: job.lease })) }
  // 等待时间有界；MCP 单次调用及时返回，Agent 可逐次查看执行状态。
  async watch({ jobId, afterSeq = -1, waitMs = 0 }, signal) {
    const first = this.status(jobId, afterSeq)
    if (waitMs && !TERMINAL.has(first.status)) await delay(Math.min(2000, Math.max(0, waitMs)), undefined, { signal })
    return this.status(jobId, afterSeq)
  }
  async cancel(id) {
    const job = this.jobs.get(id)
    if (!job) throw new Error('找不到仿真任务。')
    const run = this.running.get(id)
    if (run && !TERMINAL.has(job.status)) {
      job.status = 'cancelling'; this.event(job, 'job/cancelling'); run.controller.abort()
      await run.done
    }
    return this.status(id)
  }
  // 同时检查父依赖、任务资源和串行锁，任何一个不满足都不能启动节点。
  async execute(job, run) {
    job.status = 'running'; job.startedAt = Date.now(); this.event(job, 'job/running')
    const active = new Map(), signal = run.controller.signal
    try {
      while (!signal.aborted && job.nodes.some(node => node.status === 'pending' || node.status === 'running')) {
        for (const node of job.nodes) {
          if (signal.aborted || active.size >= job.policy.maxParallel) break
          if (node.status !== 'pending' || !node.dependsOn.every(id => job.nodes.find(parent => parent.id === id).status === 'completed')) continue
          const running = job.nodes.filter(other => other.status === 'running')
          if (node.serialGroup && this.serialLocks.has(node.serialGroup)) continue
          if (['cpu', 'memoryGb'].some(key => node.resources[key] + running.reduce((sum, other) => sum + other.resources[key], 0) > job.lease.resources[key])) continue
          if (node.serialGroup) this.serialLocks.set(node.serialGroup, `${job.id}/${node.id}`)
          node.status = 'running'; node.startedAt = Date.now()
          this.event(job, 'node/started', { nodeId: node.id, group: node.group, resources: node.resources, serialGroup: node.serialGroup ?? null })
          const work = this.worker(job, node, run).then(result => {
            if (signal.aborted) { node.status = 'cancelled'; return }
            node.status = 'completed'; node.progress = 100; job.results[node.id] = result
            writeFileSync(resolve(this.dataDir, job.id, node.id + '.json'), JSON.stringify(result, null, 2))
            this.event(job, 'node/completed', { nodeId: node.id, result })
          }).catch(error => {
            node.status = signal.aborted ? 'cancelled' : 'failed'; node.error = error.message
            if (!signal.aborted) { job.error = `${node.title}：${error.message}`; run.controller.abort() }
            this.event(job, 'node/' + node.status, { nodeId: node.id, error: node.error })
          }).finally(() => {
            node.endedAt = Date.now(); active.delete(node.id)
            if (node.serialGroup && this.serialLocks.get(node.serialGroup) === `${job.id}/${node.id}`) this.serialLocks.delete(node.serialGroup)
          })
          active.set(node.id, work)
        }
        if (!active.size) {
          // 另一个任务可能占着全局求解器；只等待锁，不把合法等待误判为 DAG 死锁。
          const waitingForLock = job.nodes.some(node => node.status === 'pending' && node.dependsOn.every(id => job.nodes.find(parent => parent.id === id).status === 'completed') && node.serialGroup && this.serialLocks.has(node.serialGroup))
          if (waitingForLock && !signal.aborted) { await delay(20, undefined, { signal }).catch(() => {}); continue }
          if (job.nodes.some(node => node.status === 'pending') && !signal.aborted) throw new Error('模板约束无法继续推进，任务已停止而不是越过依赖执行。')
          break
        }
        await Promise.race(active.values())
      }
    } catch (error) { job.error = error.message; run.controller.abort() }
    finally {
      // 等待所有子进程 close 后才归还租约，取消不会提前释放仍在使用的配额。
      await Promise.all(active.values())
      for (const node of job.nodes) if (['pending', 'running'].includes(node.status)) { node.status = job.error ? 'skipped' : 'cancelled'; node.endedAt = Date.now() }
      job.lease = this.pool.release(job.lease.id, job.id)
      this.event(job, 'resources/released', { leaseId: job.lease.id })
      job.status = job.error ? 'failed' : signal.aborted ? 'cancelled' : 'completed'
      job.endedAt = Date.now()
      this.event(job, 'job/' + job.status, { error: job.error ?? null })
      this.running.delete(job.id)
    }
  }
  // 子进程只接收当前节点的父结果，不能靠共享全局变量读取未完成的计算。
  worker(job, node, run) {
    return new Promise((resolveResult, reject) => {
      // 每个节点都有可审查的实例化脚本，流程参数不拼进 shell 命令。
      const directory = resolve(this.dataDir, job.id, 'scripts')
      mkdirSync(directory, { recursive: true })
      const script = resolve(directory, node.id + '.mjs')
      const source = this.nodeTemplate.replaceAll('{{TASK_JSON}}', JSON.stringify(node.task)).replaceAll('{{WORKER_URL_JSON}}', JSON.stringify(pathToFileURL(resolve(this.root, this.template.worker)).href))
      writeFileSync(script, source)
      const child = spawn(process.execPath, [script], { cwd: this.root, stdio: ['pipe', 'pipe', 'pipe'] })
      run.children.set(node.id, child); node.pid = child.pid
      let text = '', errorText = '', result, forced, timedOut = false
      const stop = () => { child.kill('SIGTERM'); forced ??= setTimeout(() => child.kill('SIGKILL'), 500) }
      const timeout = setTimeout(() => { timedOut = true; stop() }, 30000)
      run.controller.signal.addEventListener('abort', stop, { once: true })
      if (run.controller.signal.aborted) stop()
      child.stdout.setEncoding('utf8').on('data', chunk => {
        text += chunk
        let end
        while ((end = text.indexOf('\n')) !== -1) {
          const line = text.slice(0, end); text = text.slice(end + 1)
          try {
            const message = JSON.parse(line)
            if (message.type === 'result') result = message.result
            if (message.type === 'progress' && node.status === 'running') {
              node.progress = Math.min(99, Math.max(node.progress, message.progress))
              this.event(job, 'node/progress', { nodeId: node.id, progress: node.progress, message: message.message })
            }
          } catch (error) { errorText = `节点输出协议错误：${error.message}`; stop() }
        }
      })
      child.stderr.setEncoding('utf8').on('data', chunk => { errorText = (errorText + chunk).slice(-8000) })
      child.on('error', reject)
      child.stdin.on('error', () => {})
      child.on('close', code => {
        clearTimeout(timeout); clearTimeout(forced); run.controller.signal.removeEventListener('abort', stop); run.children.delete(node.id)
        if (timedOut || code !== 0 || result === undefined) reject(new Error(timedOut ? '节点运行超时。' : errorText || `节点退出 ${code}`))
        else resolveResult(result)
      })
      child.stdin.end(JSON.stringify({ parameters: job.parameters, policy: job.policy, inputs: Object.fromEntries(node.dependsOn.map(id => [id, job.results[id]])), demoPacingMs: this.pacingMs ?? this.template.demoPacingMs }))
    })
  }
  // 传输关闭、插件停用和进程信号都通过相同的任务取消路径收尾。
  async close() {
    this.closed = true
    await Promise.all([...this.running.keys()].map(id => this.cancel(id)))
    for (const lease of this.pool.leases.values()) if (lease.state === 'reserved') this.pool.release(lease.id)
  }
}
