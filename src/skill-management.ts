/** 网页技能 CRUD 与目录技能启停；发现、解析和加载继续交给官方 Skill 实现。 */
import type { Context } from '@deepseek-ai/cordis'
import { isModelInvocable, isSkillName, isUserInvocable, type SkillCandidate, type SkillSummary } from '@deepseek-ai/dsh-skill'
import type {} from './skill-filesystem.ts'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-working-directory'
import { load, JSON_SCHEMA } from 'js-yaml'
import { z } from 'zod'
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { ControlError, PluginControl } from './plugin-control.ts'

const MAX_BYTES = 48000
const metadata = z.object({ name: z.string().max(64).refine(isSkillName), description: z.string().trim().min(1).max(1024) }).passthrough()
const savedRow = z.object({ id: z.string().uuid(), enabled: z.boolean(), markdown: z.string(), updatedAt: z.number().finite() }).strict()
const legacySchema = z.object({ version: z.literal(1), skills: z.array(savedRow).max(50), builtinEnabled: z.boolean() }).strict()
const documentSchema = z.object({ version: z.literal(2), skills: z.array(savedRow).max(50),
  directoryEnabled: z.record(z.string().refine(isSkillName), z.boolean()) }).strict()
type SavedSkill = z.infer<typeof savedRow>
type ParsedSkill = ReturnType<typeof parseSkill>

/** 网页导入的 frontmatter 转成官方注册 API 的布尔策略；运行时权限由官方插件执行。 */
function invocationFlag(value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback
  if (typeof value === 'boolean') return value
  if ([1, '1', 'true', 'yes', 'on'].includes(typeof value === 'string' ? value.toLowerCase() : value as number)) return true
  if ([0, '0', 'false', 'no', 'off'].includes(typeof value === 'string' ? value.toLowerCase() : value as number)) return false
  throw new ControlError(400, '调用策略必须是布尔值：disable-model-invocation / user-invocable。')
}

/** YAML 只用安全的 JSON 类型解析，不支持 !!js、路径读取或代码执行。 */
export function parseSkill(markdown: unknown) {
  if (typeof markdown !== 'string' || Buffer.byteLength(markdown, 'utf8') > MAX_BYTES) throw new ControlError(400, `SKILL.md 必须是文本，最多 ${MAX_BYTES} 字节。`)
  const normalized = markdown.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)([\s\S]*)$/.exec(normalized)
  if (!match || match[1].length > 8192) throw new ControlError(400, '文件开头需要 --- 包围的 YAML 元信息，包含 name 和 description。')
  let value: unknown
  try { value = load(match[1], { schema: JSON_SCHEMA }) } catch { throw new ControlError(400, 'YAML 元信息格式无效；不支持自定义标签。') }
  const result = metadata.safeParse(value)
  if (!result.success) throw new ControlError(400, 'name 须为最多 64 位小写字母、数字和单横线组合，description 须为 1–1024 个字符。')
  const body = match[2].trim()
  if (!body) throw new ControlError(400, '技能正文不能为空，请填写实际操作指令。')
  const data = result.data
  if (['disableModelInvocation', 'modelInvocable', 'userInvocable'].some(key => Object.hasOwn(data, key))) throw new ControlError(400, '请使用官方字段 disable-model-invocation 和 user-invocable。')
  const invocation = { modelInvocable: !invocationFlag(data['disable-model-invocation'], false), userInvocable: invocationFlag(data['user-invocable'], true) }
  const extraFields = Object.keys(data).filter(key => !['name', 'description', 'disable-model-invocation', 'user-invocable', 'whenToUse', 'metadata'].includes(key))
  return { name: data.name, description: data.description, body, markdown: normalized, extraFields, invocation,
    ...(typeof data.whenToUse === 'string' ? { whenToUse: data.whenToUse } : {}) }
}

export class SkillManagement {
  private skills = new Map<string, SavedSkill & ParsedSkill>()
  private directoryEnabled = new Map<string, boolean>()
  // 即使提供方暂时停用，管理页仍可展示上次发现的目录项及其持久化状态。
  private directoryCatalog = new Map<string, SkillCandidate>()
  private loadError = ''
  // 每个依赖作用域只保存自己注册项的释放函数；框架重启时会重新贡献数据。
  private bindings = new Map<Context, (() => void)[]>()
  // 只有启动环境能指定保存位置，网页请求不能选择任意磁盘文件。
  readonly configPath = resolve(process.env.DSH_DEMO_SKILL_CONFIG || fileURLToPath(new URL('../.dsh/skills.json', import.meta.url)))

  constructor(private ctx: Context, private control: PluginControl) {}

  async load(): Promise<void> {
    try {
      const value = JSON.parse(await readFile(this.configPath, 'utf8'))
      const legacy = value.version === 1 ? legacySchema.parse(value) : undefined
      // v1 的 builtinEnabled 只用于已移除的内置技能。
      const saved = legacy ? { skills: legacy.skills, directoryEnabled: {} }
        : documentSchema.parse(value)
      for (const row of saved.skills) {
        const parsed = parseSkill(row.markdown)
        if (this.skills.has(row.id) || [...this.skills.values()].some(skill => skill.name === parsed.name)) throw new Error('重复的技能 ID 或名称')
        this.skills.set(row.id, { ...row, ...parsed })
      }
      this.directoryEnabled = new Map(Object.entries(saved.directoryEnabled))
      if (legacy) {
        // 迁移只改管理配置，不改 SKILL.md；原配置保留一次性备份，已有备份不覆盖。
        try { await copyFile(this.configPath, this.configPath + '.v1.bak', constants.COPYFILE_EXCL) }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
        await this.persist(this.skills)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.skills.clear()
        this.loadError = '技能配置文件无法解析，已保留原文件。请修复 JSON 后重启；当前禁止覆盖保存。'
      }
    }
    // 网页存储是一个技能来源；目录生成、权限检查和正文加载使用官方插件。
    this.ctx.inject(['skills'], inner => {
      this.bindings.set(inner, [])
      inner.effect(() => () => { this.bindings.delete(inner) }, 'web-skill-contributions')
      this.syncBindings()
    })
    this.ctx.inject(['demoSkillFiles'], inner => {
      inner.effect(() => inner.demoSkillFiles.bindPolicy(name => !this.loadError && this.isDirectoryEnabled(name)), 'directory-skill-policy')
    })
  }

  private rows() {
    return [...this.skills.values()].map(skill => ({ ...skill, source: 'web' as const, editable: true }))
  }

  private isDirectoryEnabled(name: string): boolean { return this.directoryEnabled.get(name) ?? true }

  private async directories(): Promise<SkillCandidate[]> {
    const files = this.ctx.get('demoSkillFiles')
    if (files) {
      const observed = await files.catalog({ cwd: this.ctx.get('workingDirectory')?.defaultDirectory ?? process.cwd() })
      const next = new Map<string, SkillCandidate>()
      // 同名目录项使用官方相同的优先级与先到先得规则；完整 locator/resourceBase 原样保留。
      for (const candidate of observed) {
        const previous = next.get(candidate.name)
        if (!previous || candidate.rank < previous.rank) next.set(candidate.name, candidate)
      }
      this.directoryCatalog = next
    }
    return [...this.directoryCatalog.values()].sort((a, b) => a.name.localeCompare(b.name))
  }

  private syncBindings(): void {
    for (const [inner, disposers] of this.bindings) {
      for (const dispose of disposers) dispose()
      // register() 自带作用域、同名合并、缓存失效及释放行为。
      this.bindings.set(inner, this.rows().filter(row => row.enabled).map(row => inner.skills.register({
        name: row.name, description: row.description, content: row.body, source: 'runtime', invocation: row.invocation,
        ...(row.whenToUse ? { whenToUse: row.whenToUse } : {}),
        resourceBase: { kind: 'opaque', description: '网页导入的单文件技能；未附带脚本和资源目录。' },
      })))
    }
  }

  private async catalog(): Promise<SkillSummary[]> {
    return await this.ctx.get('skills')?.list({ cwd: this.ctx.get('workingDirectory')?.defaultDirectory ?? process.cwd() }) ?? []
  }

  async list() {
    const runtimeReady = !!this.ctx.get('tools')?.get('skill')
    const directories = await this.directories()
    const catalog = await this.catalog()
    const managed = this.rows().map(({ markdown, body, ...skill }) => {
      const actual = catalog.find(row => row.name === skill.name)
      const available = skill.enabled && runtimeReady && actual?.provider === 'runtime'
      return { ...skill, managed: true, bytes: Buffer.byteLength(markdown, 'utf8'), available,
        userAvailable: !!available && isUserInvocable(actual!), modelAvailable: !!available && isModelInvocable(actual!) }
    })
    const external = directories.map(({ locator: _locator, rank: _rank, ...row }) => {
      const enabled = this.isDirectoryEnabled(row.name) && !this.loadError
      const actual = catalog.find(skill => skill.name === row.name)
      const available = enabled && runtimeReady && actual?.provider === row.provider && actual.path === row.path
      return { ...row, id: 'directory:' + row.name, source: 'filesystem', managed: true, editable: false, enabled,
        updatedAt: null, extraFields: [], bytes: null, available,
        userAvailable: available && isUserInvocable(row), modelAvailable: available && isModelInvocable(row) }
    })
    return { skills: [...managed, ...external], commands: runtimeReady ? catalog.filter(isUserInvocable).map(({ name, description }) => ({ name, description })) : [],
      runtimeReady, changing: this.control.changing, revision: this.control.revision, configPath: this.configPath, notice: this.loadError, maxBytes: MAX_BYTES }
  }

  async detail(id: string) {
    const row = this.rows().find(skill => skill.id === id)
    if (row) return row
    const external = (await this.directories()).find(skill => id === 'directory:' + skill.name
      || id === 'external:' + skill.name)
    if (!external?.path) throw new ControlError(404, '找不到这个技能。')
    // 路径只能来自官方提供方实际发现的条目，浏览器不能指定任意文件路径。
    const markdown = await readFile(external.path, 'utf8')
    return { ...parseSkill(markdown), id: 'directory:' + external.name, enabled: !this.loadError && this.isDirectoryEnabled(external.name),
      resourceBase: external.resourceBase, path: external.path, source: 'filesystem', editable: false, updatedAt: null }
  }

  private async persist(skills: Map<string, SavedSkill & ParsedSkill>, directoryEnabled = this.directoryEnabled): Promise<void> {
    if (this.loadError) throw new ControlError(409, this.loadError)
    await mkdir(dirname(this.configPath), { recursive: true, mode: 0o700 })
    const temporary = this.configPath + '.' + randomUUID() + '.tmp'
    try {
      const rows = [...skills.values()].map(({ id, enabled, markdown, updatedAt }) => ({ id, enabled, markdown, updatedAt }))
      await writeFile(temporary, JSON.stringify({ version: 2, skills: rows, directoryEnabled: Object.fromEntries(directoryEnabled) }, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
      await rename(temporary, this.configPath)
    } finally { await rm(temporary, { force: true }) }
  }

  async save(id: string | undefined, markdown: unknown, enabled: unknown): Promise<void> {
    if (this.loadError) throw new ControlError(409, this.loadError)
    if (id !== undefined && !this.skills.has(id)) throw new ControlError(403, '只能编辑网页技能；目录技能请在源文件中修改。')
    const parsed = parseSkill(markdown)
    if (typeof enabled !== 'boolean') throw new ControlError(400, 'enabled 必须是布尔值。')
    if (this.rows().some(skill => skill.id !== id && skill.name === parsed.name)
      || (await this.directories()).some(skill => skill.name === parsed.name)) throw new ControlError(409, '技能名称已存在，请修改 name 或编辑已有技能。')
    if (!id && this.skills.size >= 50) throw new ControlError(409, '最多保存 50 个网页技能。')
    await this.control.change(async () => {
      const row = { id: id ?? randomUUID(), enabled, ...parsed, updatedAt: Date.now() }
      const next = new Map(this.skills).set(row.id, row)
      await this.persist(next)
      this.skills = next
      this.syncBindings()
    })
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const row = await this.detail(id)
    if (row.enabled === enabled) return
    if (this.loadError) throw new ControlError(409, this.loadError)
    await this.control.change(async () => {
      if (row.source === 'filesystem') {
        const next = new Map(this.directoryEnabled).set(row.name, enabled)
        await this.persist(this.skills, next)
        this.directoryEnabled = next
        // 同时清空官方目录缓存；list 和 get 都经过提供方策略，不能只更新前端候选项。
        this.ctx.get('demoSkillFiles')?.invalidate()
      } else {
        const next = new Map(this.skills)
        next.set(id, { ...next.get(id)!, enabled, updatedAt: Date.now() })
        await this.persist(next)
        this.skills = next
        this.syncBindings()
      }
    })
  }

  async remove(id: string): Promise<void> {
    await this.detail(id)
    if (!this.skills.has(id)) throw new ControlError(403, '目录技能不能从网页删除，可以停用或复制。')
    if (this.loadError) throw new ControlError(409, this.loadError)
    await this.control.change(async () => {
      const next = new Map(this.skills)
      next.delete(id)
      await this.persist(next)
      this.skills = next
      this.syncBindings()
    })
  }
}
