/** 演示集群的配额账本；不把逻辑 CPU/内存配额说成真实集群调度或操作系统隔离。 */
import { randomUUID } from 'node:crypto'
import { availableParallelism, freemem, totalmem } from 'node:os'

// 资源检查与修改都同步完成，在单个 MCP 服务进程内不会被另一个请求插入抢占。
export class ResourcePool {
  constructor(config) {
    this.config = config
    this.revision = 0
    this.snapshots = new Map()
    this.leases = new Map()
  }
  // 未提交的租约到期后归还资源；绑定运行任务的租约由任务终态回收。
  sweep() {
    for (const lease of this.leases.values()) if (lease.state === 'reserved' && lease.expiresAt <= Date.now()) this.release(lease.id)
    for (const [id, snapshot] of this.snapshots) if (snapshot.expiresAt <= Date.now()) this.snapshots.delete(id)
  }
  // 汇总真正占用账本的资源，已经释放的历史租约不会重复扣除。
  usage() {
    const used = { cpu: 0, memoryGb: 0 }
    for (const lease of this.leases.values()) if (['reserved', 'bound'].includes(lease.state)) {
      used.cpu += lease.resources.cpu
      used.memoryGb += lease.resources.memoryGb
    }
    return used
  }
  // 每次资源查询产生有时效的观察凭证，申请时必须提交这份凭证。
  inspect() {
    this.sweep()
    const used = this.usage(), capacity = this.config.capacity
    const snapshot = { snapshotId: randomUUID(), revision: this.revision, expiresAt: Date.now() + this.config.snapshotTtlMs }
    this.snapshots.set(snapshot.snapshotId, snapshot)
    return { ...snapshot, clusterId: this.config.id, mode: this.config.mode, capacity, used, available: { cpu: capacity.cpu - used.cpu, memoryGb: capacity.memoryGb - used.memoryGb }, host: { availableCpu: availableParallelism(), totalMemoryGb: totalmem() / 2 ** 30, freeMemoryGb: freemem() / 2 ** 30 }, note: 'capacity 是模板演示配额；host 是本机观测，配额不代表物理资源隔离。' }
  }
  // 在真正分配的操作中强制“先查询、后申请”，不能靠模型遵守口头提示。
  reserve(plan, snapshotId) {
    this.sweep()
    const snapshot = this.snapshots.get(snapshotId)
    if (!snapshot) throw new Error('资源快照不存在或已过期，请先调用 cluster_resources。')
    if (snapshot.revision !== this.revision) throw new Error('资源已变化，请重新查询集群后申请。')
    const used = this.usage(), capacity = this.config.capacity
    if (Object.keys(capacity).some(key => plan.resources[key] > capacity[key] - used[key])) throw new Error('集群可用配额不足；请降低规模或等待其他任务释放资源。')
    const lease = { id: randomUUID(), planId: plan.id, snapshotId, state: 'reserved', resources: { ...plan.resources }, createdAt: Date.now(), expiresAt: Date.now() + this.config.leaseTtlMs }
    this.leases.set(lease.id, lease)
    this.revision++
    return structuredClone(lease)
  }
  // 一个租约只能绑定一次，且只能供创建它时对应的计划使用。
  bind(leaseId, planId, jobId) {
    this.sweep()
    const lease = this.leases.get(leaseId)
    if (!lease || lease.planId !== planId || lease.state !== 'reserved') throw new Error('租约不存在、已使用或不属于当前仿真计划。')
    lease.state = 'bound'
    lease.jobId = jobId
    return structuredClone(lease)
  }
  // 公共释放只能归还闲置租约；运行中的租约必须先取消任务，等待子进程退出。
  release(leaseId, ownerJobId) {
    const lease = this.leases.get(leaseId)
    if (!lease) throw new Error('找不到资源租约。')
    if (lease.state === 'bound' && lease.jobId !== ownerJobId) throw new Error('资源正在被任务使用，请先取消任务。')
    if (lease.state === 'released') return structuredClone(lease)
    lease.state = 'released'
    lease.releasedAt = Date.now()
    this.revision++
    return structuredClone(lease)
  }
}
