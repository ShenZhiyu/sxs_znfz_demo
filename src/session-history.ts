/** 会话历史管理：官方后端负责存储和恢复，demo 补充日志删除适配。 */
import type { Context } from '@deepseek-ai/cordis'
import { SessionId, type SessionEvent, type SessionHeader } from '@deepseek-ai/dsh-session'
import { SessionAlreadyOwnedError, SessionPersistenceNotFoundError } from '@deepseek-ai/dsh-session-persistence'
// 复用官方目录命名和格式识别，不自行拼接用户提供的磁盘路径。
import { sessionDir, parseGenerationLogFilename } from '@deepseek-ai/dsh-session-persistence-jsonl/src/format.ts'
import { lstat, open, readdir, realpath, unlink } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type {} from '@deepseek-ai/dsh-session-persistence'
import { ControlError } from './plugin-control.ts'

/** 列表和详情共用同一份事件摘要；不另存一份容易与实际历史失步的聊天文本。 */
function summary(header: SessionHeader, events: readonly SessionEvent[]) {
  const prompts = events.filter(event => event.type === 'user/message' && (!event.data.source || event.data.source.kind === 'user'))
  const first = prompts[0]
  const title = first?.type === 'user/message' ? first.data.content.filter(block => block.type === 'text').map(block => block.text).join(' ').trim() : ''
  return { id: String(header.id), title: title.slice(0, 80) || (prompts.length ? '附件对话' : '新对话'),
    createdAt: header.createdAt, updatedAt: events.at(-1)?.time ?? header.createdAt, turns: prompts.length,
    cwd: header.cwd, eventCount: events.length }
}

export class SessionHistory {
  readonly root = resolve(process.env.DSH_DEMO_SESSION_DIR || fileURLToPath(new URL('../.dsh/sessions/', import.meta.url)))
  constructor(private ctx: Context) {}

  id(value: string): SessionId {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new ControlError(400, '会话 ID 无效。')
    return SessionId(value)
  }

  private backend() {
    const backend = this.ctx.get('sessionPersistence')
    if (!backend) throw new ControlError(503, '会话存储尚未就绪。')
    return backend
  }

  /** 读取不创建 Agent，也不会执行模型或工具；损坏文件明确报错，绝不用空历史替代。 */
  async read(id: string) {
    const backend = this.backend()
    try {
      const handle = await backend.open(this.id(id), 'read')
      try {
        const { events } = await handle.read()
        return { ...summary(handle.header, events), events }
      } finally { await handle.close() }
    } catch (error) {
      if (error instanceof SessionPersistenceNotFoundError) throw new ControlError(404, '未找到已保存的会话。')
      throw error
    }
  }

  async list() {
    const snapshots = await this.backend().list()
    const sessions = []
    const errors = []
    // 逐个读取避免同时解码大量完整历史；单个损坏记录不遮挡其他正常会话。
    for (const snapshot of snapshots) {
      try {
        const { events: _events, ...item } = await this.read(String(snapshot.header.id))
        sessions.push(item)
      } catch (error) { errors.push({ id: String(snapshot.header.id), error: error instanceof Error ? error.message : String(error) }) }
    }
    sessions.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
    return { sessions, errors }
  }

  /** 调用方先关闭 Agent；官方 write 句柄提供同进程和跨进程排他锁。 */
  async remove(id: string): Promise<void> {
    let handle
    try { handle = await this.backend().open(this.id(id), 'write') }
    catch (error) {
      if (error instanceof SessionPersistenceNotFoundError) throw new ControlError(404, '该会话已不存在。')
      if (error instanceof SessionAlreadyOwnedError) throw new ControlError(409, '该会话仍被其他服务使用，请先关闭对应会话。')
      throw error
    }
    try {
      const directory = sessionDir(this.root, handle.header.cwd, handle.id)
      const root = await realpath(this.root), target = await realpath(directory)
      const part = relative(root, target)
      if (!part || part === '..' || part.startsWith('..' + sep) || isAbsolute(part) || (await lstat(directory)).isSymbolicLink()) throw new ControlError(403, '会话日志必须位于配置的存储目录内。')
      // 删除所有格式代次，防止删除当前版本后旧版本重新出现在列表。
      const generation = (name: string) => parseGenerationLogFilename(name, 'none') ?? parseGenerationLogFilename(name, 'zstd')
      const logs = (await readdir(directory, { withFileTypes: true })).filter(entry => generation(entry.name) !== undefined)
        .sort((a, b) => generation(a.name)! - generation(b.name)!)
      if (logs.some(entry => !entry.isFile())) throw new ControlError(403, '会话日志不是普通文件，已取消删除。')
      for (const log of logs) await unlink(join(directory, log.name))
      // 保留 session.lock 及目录，避免删除锁文件导致其他进程锁住不同的 inode。
      // 上传文件、仿真任务和其他附件不在删除范围内。
      if (process.platform !== 'win32') {
        const folder = await open(directory, 'r')
        try { await folder.sync() } finally { await folder.close() }
      }
    } finally { await handle.close() }
  }
}
