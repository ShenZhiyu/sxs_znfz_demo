/** MCP 服务管理：专属 JSON 保存配置，真实 Loader 子树负责连接和工具生命周期。 */
import type { Context } from '@deepseek-ai/cordis'
import { EntryTree, interpolate, type Entry } from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-tools'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { PluginControl, ControlError } from './plugin-control.ts'

// 固定客户端模块，网页不能指定要加载的插件代码；stdio 的命令和参数由用户显式配置。
const MODULE = '@deepseek-ai/dsh-mcp-client'
const PHASES = ['pending', 'loading', 'active', 'failed', 'disposed', 'unloading']
const common = {
  serverName: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/, '服务名须为 1–32 位字母、数字、下划线或横线'),
  enabled: z.boolean().default(true),
  toolCallTimeoutMs: z.number().int().min(1000).max(300000).default(10000),
}
// 环境变量和请求头属于凭据承载字段：可以保存，但 GET 接口只返回键名。
const strings = z.record(z.string().min(1).max(256).refine(key => !['__jsExpr', '__proto__', 'prototype', 'constructor'].includes(key), '不允许使用此保留键名'), z.string().max(8192))
const configSchema = z.discriminatedUnion('transport', [
  z.object({ ...common, transport: z.literal('stdio'), command: z.string().trim().min(1).max(4096), args: z.array(z.string().max(8192)).max(100).default([]), cwd: z.string().max(4096).default(''), env: strings.optional() }).strict(),
  z.object({ ...common, transport: z.literal('streamable-http'), url: z.string().url().max(8192).refine(value => { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password } catch { return false } }, '使用 http(s) 地址，认证信息请填写在 Headers 中'), headers: strings.optional() }).strict(),
])
type ServerConfig = z.infer<typeof configSchema>
interface SavedService { id: string; config: ServerConfig }
const storeSchema = z.object({ version: z.literal(1), services: z.array(z.object({ id: z.string().uuid(), config: configSchema }).strict()).max(50) }).strict()

// 这棵树挂在 minimal-web 下，写回由专属 JSON 完成，不改教学 YAML 或 profile。
class RuntimeTree extends EntryTree { write(): void {} }

export class McpManagement {
  private tree: RuntimeTree
  private saved = new Map<string, SavedService>()
  private entries = new Map<string, string>()
  private errors = new Map<string, string>()
  private closing = false
  private loadError = ''
  // 测试和独立部署可以在启动前用环境变量指定配置文件；HTTP 参数不能改变路径。
  readonly configPath = resolve(process.env.DSH_DEMO_MCP_CONFIG || fileURLToPath(new URL('../.dsh/mcp-services.json', import.meta.url)))

  constructor(private ctx: Context, private control: PluginControl) {
    this.tree = new RuntimeTree(ctx)
    // Web 入口卸载时，子进程、工具注册和后台重连都随真实插件一起释放。
    ctx.effect(() => () => this.close(), 'web-mcp-management')
  }

  // 先加载数据；远程服务的连接在 Web 就绪后恢复，坏服务不会阻止页面启动。
  async load(): Promise<void> {
    try {
      const data = storeSchema.parse(JSON.parse(await readFile(this.configPath, 'utf8')))
      for (const row of data.services) {
        if (this.saved.has(row.id) || [...this.saved.values()].some(other => other.config.serverName === row.config.serverName)) throw new Error('重复的服务 ID 或名称')
        this.saved.set(row.id, row)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.saved.clear()
        this.loadError = 'MCP 配置文件无法解析，已保留原文件。请修复该 JSON 后重启；当前禁止覆盖保存。'
      }
    }
  }

  // 自动恢复也使用和网页相同的修改锁；不会绕开会话版本管理。
  async restore(): Promise<void> {
    if (!this.saved.size || this.closing) return
    await this.control.change(async () => {
      // 不同服务并行恢复，各自有连接上限，避免坏连接按服务数量累积等待时间。
      await Promise.all([...this.saved.values()].map(async row => {
        if (this.closing) return
        try { this.checkName(row.config.serverName, row.id); await this.mount(row) }
        catch (error) { this.errors.set(row.id, this.message(error, row.config)) }
      }))
    })
  }

  // 公布的是当前 ToolRuntime 的实际 schema，不把静态声明或工具数量当成连接成功证明。
  list() {
    const schemas = this.ctx.get('tools')?.schemas() ?? []
    const runtime = [...this.ctx.loader.entries()]
    const ownIds = new Set(this.entries.values())
    const describe = (id: string, config: Record<string, any>, source: 'web' | 'yaml', entry?: Entry) => {
      const { env, headers, ...visible } = config
      // YAML 中可能带额外客户端设置；管理页只投影必要字段，不回传未知配置。
      const publicConfig = { serverName: visible.serverName, transport: visible.transport, toolCallTimeoutMs: visible.toolCallTimeoutMs ?? 10000,
        ...(visible.transport === 'stdio' ? { command: visible.command, args: visible.args ?? [], cwd: visible.cwd ?? '', envKeys: Object.keys(env ?? {}) } : { url: visible.url, headerKeys: Object.keys(headers ?? {}) }) }
      const phase = entry?.fiber ? (PHASES[entry.fiber.state] ?? 'unknown') : 'stopped'
      // 核心依赖恢复后可能已重新加载成功，不继续显示旧连接的失败记录。
      if (phase === 'active' || (!config.enabled && source === 'web') || (entry?.disabled && source === 'yaml')) this.errors.delete(id)
      return { id, entryId: entry?.id ?? null, source, editable: source === 'web', enabled: source === 'web' ? !!config.enabled : !!entry && !entry.disabled,
        phase: this.errors.has(id) ? 'failed' : phase, error: this.errors.get(id) ?? (phase === 'failed' ? 'MCP 客户端加载失败，请查看终端日志并检查配置。' : null),
        config: publicConfig, tools: schemas.filter(tool => tool.name.startsWith(`mcp__${config.serverName}__`)) }
    }
    const services = [
      ...runtime.filter(entry => entry.options.name === MODULE && !ownIds.has(entry.id)).map(entry => describe(entry.id, entry.fiber?.config ?? interpolate(entry.ctx, entry.options.config ?? {}), 'yaml', entry)),
      ...[...this.saved.values()].map(row => describe(row.id, row.config, 'web', runtime.find(entry => entry.id === this.entries.get(row.id)))),
    ]
    return { services, changing: this.control.changing, revision: this.control.revision, configPath: this.configPath, notice: this.loadError,
      defaults: { command: process.execPath, args: ['simulation/platform-mcp/server.mjs', '--platform', 'P1'], cwd: fileURLToPath(new URL('../', import.meta.url)) } }
  }

  // 同名服务即使已停用也保留其命名空间，避免恢复后发生工具覆盖。
  private checkName(name: string, except?: string): void {
    const peers = [
      ...[...this.saved.values()].filter(row => row.id !== except).map(row => row.config.serverName),
      ...[...this.ctx.loader.entries()].filter(entry => entry.options.name === MODULE && ![...this.entries.values()].includes(entry.id)).map(entry => entry.options.config?.serverName),
    ].filter((value): value is string => typeof value === 'string')
    // 禁止命名空间互为双下划线前缀，使工具列表可以无歧义地归属到服务。
    if (peers.some(peer => peer === name || peer.startsWith(name + '__') || name.startsWith(peer + '__'))) throw new ControlError(409, '服务名称已存在或与已有 MCP 命名空间重叠，请换一个名称。')
  }

  // 单独保存 env/headers 的值，普通列表只显示键名；错误信息也去掉这些已知凭据。
  private message(error: unknown, config: ServerConfig): string {
    let text = error instanceof Error ? error.message : String(error)
    if (error instanceof Error && error.cause instanceof Error) text += '：' + error.cause.message
    const secrets = Object.values(config.transport === 'stdio' ? config.env ?? {} : config.headers ?? {})
    for (const secret of secrets) if (secret) text = text.split(secret).join('[已隐藏]')
    return text.slice(0, 2000)
  }

  // 先写临时文件再改名，避免服务中途退出留下半份 JSON；凭据文件仅当前用户可读写。
  private async persist(next: Map<string, SavedService>): Promise<void> {
    if (this.loadError) throw new ControlError(409, this.loadError)
    await mkdir(dirname(this.configPath), { recursive: true, mode: 0o700 })
    const temporary = this.configPath + '.' + randomUUID() + '.tmp'
    try {
      await writeFile(temporary, JSON.stringify({ version: 1, services: [...next.values()] }, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
      await rename(temporary, this.configPath)
    } finally { await rm(temporary, { force: true }) }
  }

  private entry(id: string): Entry | undefined { return [...this.tree.entries()].find(entry => entry.id === this.entries.get(id)) }

  // 等到连接和首次 tools/list 结束再返回；超时会真正卸载插件，避免残留启动进程。
  private async settle(entry: Entry, row: SavedService): Promise<void> {
    if (!row.config.enabled || !this.ctx.get('tools')) return
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      if (!entry.fiber) throw new Error('MCP 客户端未能加载，请检查终端日志。')
      await Promise.race([entry.fiber?.await(), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('连接超过 10 秒，已停止本次连接；请检查配置后重连。')), 10000) })])
    } catch (error) {
      this.errors.set(row.id, this.message(error, row.config))
      await entry.fiber?.dispose()
    } finally { clearTimeout(timer) }
  }

  private async mount(row: SavedService): Promise<void> {
    if (this.closing) throw new ControlError(503, '服务正在关闭。')
    this.errors.delete(row.id)
    let entry = this.entry(row.id)
    // 更新连接必须先结束旧客户端，不能让同一命名空间同时存在两个子进程。
    if (entry) { const fiber = entry.fiber; await entry.update({ disabled: true }); await fiber?.dispose() }
    const { enabled, ...config } = row.config
    const options = { id: 'mcp-' + row.id, name: MODULE, disabled: !enabled, config: { ...config, cwd: config.transport === 'stdio' ? (config.cwd || process.cwd()) : undefined, failOnStartupError: true } }
    if (entry) await entry.update(options)
    else {
      // create 会同步建立 Entry，再异步导入模块；先记录它的真实 ID，查询不会误标成 YAML。
      const creation = this.tree.create(options)
      this.entries.set(row.id, this.tree.store[options.id].id)
      const entryId = await creation
      entry = this.entry(row.id)!
      // 树中的开关和管理页共享持久化逻辑。
      this.control.managed.set(entryId, enabled => this.setEnabled(row.id, enabled))
    }
    await this.settle(entry, row)
  }

  async save(id: string | undefined, input: unknown): Promise<void> {
    // 输入错误在会话清理之前拒绝，填写错误配置不会中断当前聊天。
    const previous = id ? this.saved.get(id) : undefined
    if (id !== undefined && !previous) throw new ControlError(404, '只能编辑网页注册的服务；YAML 服务请修改对应配置文件。')
    // 编辑时不提交 env/headers 表示保留原值；显式传 {} 才表示清空。
    const result = configSchema.safeParse(input)
    if (!result.success) throw new ControlError(400, result.error.issues.map(issue => `${issue.path.join('.')}：${issue.message}`).join('\n'))
    const config = result.data
    if (previous?.config.transport === 'stdio' && config.transport === 'stdio' && config.env === undefined) config.env = previous.config.env
    if (previous?.config.transport === 'streamable-http' && config.transport === 'streamable-http' && config.headers === undefined) config.headers = previous.config.headers
    this.checkName(config.serverName, id)
    if (!id && this.saved.size >= 50) throw new ControlError(409, '最多保存 50 个网页 MCP 服务。')
    await this.control.change(async () => {
      const row = { id: id ?? randomUUID(), config }
      const next = new Map(this.saved).set(row.id, row)
      await this.persist(next)
      this.saved = next
      try { await this.mount(row) } catch (error) { this.errors.set(row.id, this.message(error, config)) }
    })
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const row = this.saved.get(id)
    if (!row) { await this.control.setEnabled(this.yamlEntry(id).id, enabled); return }
    await this.save(id, { ...row.config, enabled })
  }

  private yamlEntry(id: string): Entry {
    const entry = [...this.ctx.loader.entries()].find(entry => entry.id === id && entry.options.name === MODULE && ![...this.entries.values()].includes(entry.id))
    if (!entry) throw new ControlError(404, '找不到这个 MCP 服务。')
    return entry
  }

  async reconnect(id: string): Promise<void> {
    const row = this.saved.get(id)
    if (row) { await this.save(id, { ...row.config, enabled: true }); return }
    const entry = this.yamlEntry(id)
    await this.control.change(async () => {
      this.errors.delete(id)
      const fiber = entry.fiber
      await entry.update({ disabled: true })
      await fiber?.dispose()
      await entry.update({ disabled: false })
      // 不伪造连接成功，失败以真实 Fiber 状态显示。
      await this.settle(entry, { id, config: { ...entry.options.config, enabled: true } })
    })
  }

  async remove(id: string): Promise<void> {
    // 先检查来源，误点只读 YAML 服务不会清空正在进行的聊天。
    if (!this.saved.has(id)) throw new ControlError(403, 'YAML 服务不能从网页删除，请修改对应 YAML。')
    await this.control.change(async () => {
      const next = new Map(this.saved)
      next.delete(id)
      await this.persist(next)
      const entry = this.entry(id)
      if (entry) {
        const fiber = entry.fiber
        await entry.update({ disabled: true })
        await fiber?.dispose()
        entry.parent.remove(entry.options.id)
        this.control.managed.delete(entry.id)
      }
      this.saved = next
      this.entries.delete(id)
      this.errors.delete(id)
    })
  }

  private async close(): Promise<void> {
    this.closing = true
    await Promise.all([...this.tree.entries()].map(async entry => {
      this.control.managed.delete(entry.id)
      await entry.fiber?.dispose()
    }))
  }
}
