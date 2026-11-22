/** 官方文件目录提供方的启停适配；不修改官方源码或技能文件。 */
import type { Context } from '@deepseek-ai/cordis'
import { FileSystemSkillProvider, type Config } from '@deepseek-ai/dsh-skill-filesystem'
import type { SkillCandidate, SkillLookupOptions, SkillProviderControl } from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-fs'

export { Config } from '@deepseek-ai/dsh-skill-filesystem'
export const name = 'managed-skill-filesystem'
export const inject = ['skills']

/** 管理页读取未过滤目录；模型和用户只能经过官方注册表中的过滤提供方。 */
export interface ManagedSkillFiles {
  catalog(options: SkillLookupOptions): Promise<readonly SkillCandidate[]>
  bindPolicy(policy: (name: string) => boolean): () => void
  invalidate(): void
}

declare module '@deepseek-ai/cordis' {
  interface Context { demoSkillFiles: ManagedSkillFiles }
}

export function apply(ctx: Context, config: Config): void {
  let files!: FileSystemSkillProvider
  let registration!: SkillProviderControl
  let lastCatalog = ''
  // 持久化配置尚未加载或管理器已卸载时不暴露目录，避免启动时短暂绕过停用状态。
  let policy: ((name: string) => boolean) | undefined
  ctx.skills.registerProvider(control => {
    registration = control
    files = new FileSystemSkillProvider(ctx, control, config)
    return {
      name: files.name,
      async list(options) {
        const observed = await files.list(options)
        const candidates = Array.isArray(observed) ? observed : observed.candidates
        const enabled = candidates.filter(candidate => policy?.(candidate.name) === true)
        return Array.isArray(observed) ? enabled : { candidates: enabled, complete: observed.complete }
      },
      async get(candidate, options) {
        if (policy?.(candidate.name) !== true) return undefined
        const definition = await files.get(candidate, options)
        // 文件读取期间可能发生停用；返回正文前再次检查当前策略。
        return definition && policy?.(definition.name) === true ? definition : undefined
      },
    }
  })
  ctx.provide('demoSkillFiles', {
    async catalog(options: SkillLookupOptions) {
      const observed = await files.list(options)
      const candidates = Array.isArray(observed) ? observed : observed.candidates
      // 管理页主动扫描可能先于 watcher 观察到新根目录，须将已发现的变化通知官方缓存。
      // 只在摘要实际变化时失效，避免轮询造成持续的目录版本变化。
      const signature = JSON.stringify(candidates.map(({ locator: _locator, ...summary }) => summary))
      if (signature !== lastCatalog) {
        lastCatalog = signature
        registration.invalidate()
      }
      return candidates
    },
    bindPolicy(next: (name: string) => boolean) {
      policy = next
      registration.invalidate()
      return () => {
        if (policy !== next) return
        policy = undefined
        registration.invalidate()
      }
    },
    invalidate() { registration.invalidate() },
  } satisfies ManagedSkillFiles)
  // 与官方 apply 一致地释放 watcher，并转发真正的文件写入观察；读取不触发失效循环。
  ctx.effect(function* () { yield async () => { await files.dispose() } }, 'managed-skill-filesystem watcher')
  ctx.on('fs/observed', (target, _observation, actor) => {
    if (actor && 'name' in actor && (actor.name === 'write' || actor.name === 'edit')) files.observeHostMutation(target.displayPath)
  })
}
