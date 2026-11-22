/** 只读依赖快照：把 Cordis 的服务注册和 Fiber inject 映射回 Loader 配置条目。 */
import { Inject, symbols, type Context, type Fiber } from '@deepseek-ai/cordis'
import type { Entry } from '@deepseek-ai/cordis-plugin-loader'

const phases = ['pending', 'loading', 'active', 'failed', 'disposed', 'unloading']
const phase = (fiber?: Fiber) => fiber ? phases[fiber.state] ?? 'unknown' : 'stopped'

interface Node {
  id: string
  entryId: string | null
  name: string
  module: string | null
  kind: 'entry' | 'runtime'
  phase: string
  enabled: boolean
  declarationsKnown: boolean
  provides: string[]
  previouslyProvided: string[]
}

interface Edge {
  id: string
  consumerId: string
  providerId: string | null
  lastProviderId: string | null
  service: string
  status: 'provided' | 'unavailable' | 'missing'
  origin: 'plugin' | 'dynamic' | 'declaration'
  scope: string
  scopePhase: string
  bound: boolean
}

export class PluginDependencies {
  // 只保存服务名称和拥有者，不保存服务值、凭据、配置或已释放的 Fiber。
  private previousServices = new Map<string, Set<string>>()
  private previousProviders = new Map<symbol, string>()

  constructor(private ctx: Context) {}

  snapshot(entries: Entry[]) {
    const nodes = new Map<string, Node>()
    // 隔离/追踪上下文可能包装 Fiber 对象，uid 才是同一次实例的稳定身份。
    const owners = new Map(entries.filter(entry => entry.fiber?.uid != null).map(entry => [entry.fiber!.uid!, entry]))
    const fibers = [...this.ctx.registry.values()].flatMap(runtime => [...runtime.fibers]).filter(fiber => fiber.uid !== null)

    for (const entry of entries) nodes.set('entry:' + entry.id, {
      id: 'entry:' + entry.id, entryId: entry.id, name: entry.options.id, module: entry.options.name,
      kind: 'entry', phase: phase(entry.fiber), enabled: !entry.disabled, declarationsKnown: !!entry.fiber,
      provides: [], previouslyProvided: [],
    })

    // 匿名 ctx.inject 子 Fiber 归属最近的配置插件；启动器直接挂载的服务单独列为运行时节点。
    const owner = (fiber: Fiber): Entry | undefined => {
      for (let current = fiber; current.runtime; current = current.parent.fiber) {
        const found = current.uid === null ? undefined : owners.get(current.uid)
        if (found) return found
      }
    }
    const nodeOf = (fiber: Fiber): Node => {
      const entry = owner(fiber)
      const id = entry ? 'entry:' + entry.id : 'runtime:' + (fiber.uid ?? 'disposed')
      let node = nodes.get(id)
      if (!node) {
        node = { id, entryId: null, name: fiber.runtime?.name || (fiber.runtime ? '匿名运行时插件' : '框架根上下文'), module: null,
          kind: 'runtime', phase: phase(fiber), enabled: fiber.uid !== null, declarationsKnown: true, provides: [], previouslyProvided: [] }
        nodes.set(id, node)
      }
      return node
    }
    for (const fiber of fibers) nodeOf(fiber)

    // store 的键为隔离作用域 Symbol；同名服务在不同作用域中可以由不同插件提供。
    const implementations = this.ctx.reflect.store
    for (const key of Object.getOwnPropertySymbols(implementations)) {
      const impl = implementations[key]!
      const node = nodeOf(impl.fiber)
      if (!node.provides.includes(impl.name)) node.provides.push(impl.name)
      const previous = this.previousServices.get(node.id) ?? new Set<string>()
      previous.add(impl.name)
      this.previousServices.set(node.id, previous)
      this.previousProviders.set(key, node.id)
    }

    const edges: Edge[] = []
    const visibleScopes = new Set<symbol>()
    const append = (consumer: Node, context: Context, names: string[], origin: Edge['origin'], scope: string, fiber?: Fiber) => {
      for (const service of names.sort()) {
        // 按消费方的隔离标签解析实现，不能用控制页的 ctx.get() 代替消费方查找。
        const key = context[symbols.isolate][service]
        if (key) visibleScopes.add(key)
        const impl = key ? implementations[key] : undefined
        const providerId = impl ? nodeOf(impl.fiber).id : null
        const last = key ? this.previousProviders.get(key) : undefined
        edges.push({ id: `${consumer.id}/${scope}/${service}`, consumerId: consumer.id, providerId,
          lastProviderId: !impl && last && nodes.has(last) ? last : null, service,
          status: !impl ? 'missing' : impl.fiber.state === 2 ? 'provided' : 'unavailable', origin, scope,
          scopePhase: phase(fiber),
          // bound 表示该作用域实际保留了这个实现；不主动调用 availability check 或执行插件代码。
          bound: !!impl && fiber?.store?.[service] === impl,
        })
      }
    }
    for (const fiber of fibers) {
      const entry = owner(fiber)
      const origin = entry && entry.fiber?.uid !== fiber.uid ? 'dynamic' : 'plugin'
      append(nodeOf(fiber), fiber.ctx, Object.keys(fiber.inject), origin,
        origin === 'dynamic' ? `子作用域 #${fiber.uid}（${fiber.runtime?.name || 'ctx.inject'}）` : `主作用域 #${fiber.uid}`, fiber)
    }
    for (const entry of entries) {
      // Loader 可能保留 uid=null 的已释放 Fiber 引用，这种条目同样需要退回声明视图。
      if (entry.fiber?.uid != null || entry.moduleNamespace === undefined) continue
      // 已停用的模块只读取之前导入过的声明，绝不为了展示而 import 或启动它。
      const plugin = this.ctx.loader.unwrapExports(entry.moduleNamespace)
      const node = nodes.get('entry:' + entry.id)!
      if (plugin) {
        node.declarationsKnown = true
        append(node, entry.ctx, Object.keys(Inject.resolve(entry.options.inject, Inject.resolve(plugin.inject))), 'declaration', '已加载模块声明（当前未运行）')
      }
    }

    for (const node of nodes.values()) {
      node.provides.sort()
      node.previouslyProvided = [...(this.previousServices.get(node.id) ?? [])].filter(name => !node.provides.includes(name)).sort()
    }
    // 清理已移除条目和已经消失的隔离作用域，避免轮询持有过期上下文的标识。
    for (const id of this.previousServices.keys()) if (!nodes.has(id)) this.previousServices.delete(id)
    for (const key of this.previousProviders.keys()) if (!visibleScopes.has(key) && !implementations[key]) this.previousProviders.delete(key)
    return { nodes: [...nodes.values()], edges,
      coverage: '展示主插件和子作用域的 inject 及实际服务提供者。子作用域等待不等于主插件故障；状态分别显示。不追踪 ctx.get() 可选读取、npm 包依赖或尚未创建的条件分支。未加载模块声明为未知。',
    }
  }
}
