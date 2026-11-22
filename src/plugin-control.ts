/** 读取 Loader 的真实状态并启停插件；网页 MCP 委托管理器保存，教学 YAML 保持原样。 */
// 控制平面不能依赖可被停止的 agents/llm，否则停止它们后页面也会消失。
import type { Context } from '@deepseek-ai/cordis'
// Loader 的类型扩展提供 entries、resolve 和 await；实际服务由官方启动器提供。
import type { Entry } from '@deepseek-ai/cordis-plugin-loader'
// 依赖视图只观察现有运行时，不影响插件注册或生命周期。
import { PluginDependencies } from './plugin-dependencies.ts'

// 明确列出此学习示例允许切换的条目，避免外部输入操作启动器或任意模块。
const SWITCHABLE = new Set(['llm', 'session', 'session-projection', 'system-prompt', 'tools', 'agent', 'agent-loop', 'deepseek-api-key', 'offline-provider', 'mcp-demo', 'fs-local', 'working-directory', 'skill', 'skill-filesystem', 'tool-skill', 'subprocess-local', 'bash-local', 'shell-env', 'tool-bash'])
// 状态值与 Cordis 的公开 FiberState 顺序一致；不依赖 const enum 的运行时导出。
const PHASES = ['pending', 'loading', 'active', 'failed', 'disposed', 'unloading']
// 用人类可读的职责说明配合真实状态，便于理解停用后哪些能力会受影响。
const DESCRIPTIONS: Record<string, string> = {
  // 七个核心服务的职责和前面教学 README 保持一致。
  llm: '模型运行时', session: '内存会话', 'session-projection': '会话状态投影', 'system-prompt': '系统提示词', tools: '工具运行时', agent: 'Agent 注册表', 'agent-loop': 'Agent 对话循环',
  // 适配器是模型路由提供方，不是另一套 AgentLoop。
  'deepseek-api-key': '真实 DeepSeek 适配器', 'offline-provider': '离线模拟适配器',
  // MCP 连接在停用时释放服务进程并移除远端工具，不影响普通聊天。
  'mcp-demo': 'MCP 工具与仿真后台',
  // 这些是新增激活的官方能力，不计入七个对话核心服务。
  'fs-local': '官方本地文件系统', 'working-directory': '官方会话工作目录',
  skill: '官方技能注册表', 'skill-filesystem': '官方本地技能发现 + demo 启停适配', 'tool-skill': '官方技能加载与显式调用',
  'subprocess-local': '官方本地子进程管理', 'bash-local': '官方 Bash 执行器',
  'shell-env': '官方 Shell 环境注册表', 'tool-bash': '官方 bash 工具',
  'session-persistence-jsonl': '官方会话持久化（JSONL）',
  // 根 include 读取配置并挂载子条目，自身保持只读。
  include: '根配置容器',
  // 基础设施属于控制页面本身，显示状态但不提供使页面失联的开关。
  webserver: 'HTTP 服务', 'minimal-web': 'Web 调试入口', 'minimal-chat': '终端入口（Web 模式禁用）',
// 结束职责表。
}

// 控制操作失败时返回可区分的 HTTP 状态，不把已知冲突伪装为服务崩溃。
export class ControlError extends Error {
  // 状态码只描述控制请求，实际插件状态仍以 Loader 列表为准。
  constructor(readonly status: number, message: string) { super(message) }
// 结束控制错误类型。
}

// 实例由 Web 入口拥有，changing 用于阻止同时修改插件和创建新会话。
export class PluginControl {
  private dependencies: PluginDependencies
  // 网页注册的 MCP 条目由其配置管理器持久化，插件树开关也必须经过同一入口。
  managed = new Map<string, (enabled: boolean) => Promise<void>>()
  // 一次只处理一个启停操作；多个网页共享同一进程的插件树。
  changing = false
  // 版本变化通知其他页面丢弃因插件切换而失效的会话 ID。
  revision = 0
  // beforeChange 由 Web 入口实现，用来取消所有当前会话，避免悬挂在即将卸载的服务上。
  constructor(private ctx: Context, private beforeChange: () => Promise<void>) { this.dependencies = new PluginDependencies(ctx) }

  // 所有插件和 MCP 修改共享一个锁与会话版本，防止跨页面并发修改连接。
  async change<T>(operation: () => Promise<T>): Promise<T> {
    if (this.changing) throw new ControlError(409, '另一项插件、MCP 或 Skill 操作尚未完成，请稍候。')
    this.changing = true
    try {
      // 工具集合变化前先结束会话，原始调试记录仍由独立仓库保存。
      await this.beforeChange()
      this.revision++
      return await operation()
    } finally { this.changing = false }
  }

  // 只有既有允许条目和真实 MCP 客户端可以启停，容器始终只读。
  private switchable(entry: Entry): boolean {
    return !(entry.subtree || entry.subgroup || entry.options.group)
      && (SWITCHABLE.has(entry.options.id) || entry.options.name === '@deepseek-ai/dsh-mcp-client')
  }

  // 每次都读取 Loader，不能把按钮文字当成插件已经运行的事实。
  list() {
    // 空缺依赖会使 enabled=true 的插件处于 pending，页面同时展示两个状态。
    const runtimeEntries = [...this.ctx.loader.entries()]
    const entries = runtimeEntries.map(entry => ({
      // ID 用于精确定位；module 只用于展示，不接受浏览器传任意模块路径。
      id: entry.id, key: entry.options.id, module: entry.options.name, description: DESCRIPTIONS[entry.options.id] ?? (entry.options.name === '@deepseek-ai/dsh-mcp-client' ? `MCP 服务：${entry.options.config?.serverName ?? entry.options.id}` : entry.options.id),
      // 使用真实拥有者确定父节点；Group 子条目的完整 ID 不一定包含组名，不能按冒号猜层级。
      parentId: entry.parent.ctx.fiber.entry?.id ?? null,
      // Include 子树和 Group 分组都属于容器；即使暂时没有子条目也保留其身份。
      container: !!(entry.subtree || entry.subgroup || entry.options.group),
      // desired enabled 与实际 fiber state 分开，尤其是依赖未满足的情况。
      enabled: !entry.disabled, phase: entry.fiber === undefined ? 'stopped' : (PHASES[entry.fiber.state] ?? 'unknown'),
      // 网页 MCP 的启停由管理器保存，其余已有 YAML 开关仍只在当前进程生效。
      persisted: this.managed.has(entry.id),
      // Web 和 HTTP 入口需要一直存在，否则用户无法再从页面启用其他插件。
      switchable: this.switchable(entry), reason: entry.subtree || entry.subgroup || entry.options.group ? '配置容器保持运行，以便查看和恢复其子插件。' : this.switchable(entry) ? null : '此条目维持 Web 控制页面，或与当前 Web 模式不兼容。',
    // 结束单项状态对象。
    }))
    // ready 只按七个核心插件的实际 active 状态判断；适配器另由模型路由检查。
    const core = ['llm', 'session', 'session-projection', 'system-prompt', 'tools', 'agent', 'agent-loop']
    // 返回完整条目及全局锁状态；各条目的 persisted 区分网页配置和临时 YAML 开关。
    return { entries, dependencies: this.dependencies.snapshot(runtimeEntries), ready: core.every(id => entries.some(entry => entry.key === id && !entry.container && entry.phase === 'active')), changing: this.changing, revision: this.revision, runtimeOnly: this.managed.size === 0 }
  // 结束快照读取。
  }

  // 切换已有插件；不修改磁盘上的教学配置，重启会恢复 YAML 设定。
  async setEnabled(id: string, enabled: boolean): Promise<void> {
    // 未列入允许清单的基础设施保持只读，避免页面自我卸载。
    // Loader ID 可能带 include: 前缀，先按完整 ID 查找，再按配置条目 ID 判断权限。
    // 同时操作可能导致依赖状态互相覆盖，因此明确拒绝并发操作。
    if (this.changing) throw new ControlError(409, '另一项插件操作尚未完成，请稍候。')
    // 先在真实条目列表查找，不直接把未知 ID 交给底层解析器。
    const entry = [...this.ctx.loader.entries()].find(row => row.id === id)
    // 未知条目使用 404，不创建新插件。
    if (!entry) throw new ControlError(404, '找不到这个插件。')
    // 仅允许本示例的可切换条目，不能因 ID 带前缀而误锁所有核心插件。
    if (!this.switchable(entry)) throw new ControlError(403, '这个条目不能从调试页面启停。')
    // 容器即使恰好使用可切换插件的短 ID，也不能绕过树界面的只读限制。
    if (entry.subtree || entry.subgroup || entry.options.group) throw new ControlError(403, '配置容器不能从调试页面启停。')
    // 网页服务的开关同时写入专属 JSON；不能绕过管理器只改变 Loader。
    const manage = this.managed.get(id)
    if (manage) return manage(enabled)
    // 重复设置相同状态不应清空用户当前对话。
    if ((!entry.disabled) === enabled) return
    // 先占用全局修改锁，后续每次 await 时新请求都能观察到它。
    await this.change(async () => {
      // 保存旧 fiber，停用后 Loader 可能立即清空 entry.fiber 引用。
      const previous = entry.fiber
      // 直接更新当前条目，不调用 tree.write，因此不会覆盖源码或持久化临时实验状态。
      await entry.update({ disabled: !enabled })
      // update 的停用分支会开始卸载；显式等待它结束再报告结果。
      if (!enabled) await previous?.dispose()
      // 等依赖链稳定，包括服务恢复后自动激活的下游插件。
      await this.ctx.loader.await()
    // 异常也解除锁，页面能继续查看真实状态或执行恢复操作。
    })
  // 结束状态切换。
  }
// 结束插件控制器。
}
