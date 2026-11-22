/** Web 文件传输适配：实现官方附件存储接口，原始文件与下载范围均限定在 work/。 */
import type { Context } from '@deepseek-ai/cordis'
import { AttachmentId, AttachmentStore, type FileAttachmentRef, type SaveFileAttachment, type SaveFileStreamAttachment } from '@deepseek-ai/dsh-attachment'
import { createHash, randomUUID } from 'node:crypto'
import { constants, createReadStream, existsSync } from 'node:fs'
import { mkdir, open, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { pipeline } from 'node:stream/promises'
import { z } from 'zod'
import { ControlError } from './plugin-control.ts'

const MAX_FILE_BYTES = 20 * 1024 * 1024
const MAX_MESSAGE_BYTES = 100 * 1024 * 1024
const MAX_ATTACHMENTS = 10
const receiptSchema = z.object({ version: z.literal(1), id: z.string().uuid(), name: z.string().min(1),
  bytes: z.number().int().min(0), digest: z.string().regex(/^sha256:[a-f0-9]{64}$/), createdAt: z.number() }).strict()
type Receipt = z.infer<typeof receiptSchema>
export interface WorkFile { name: string; path: string; bytes: number; modifiedAt: number; downloadUrl: string }

/** 保留中文名称，但从不将浏览器文件名当作目录。 */
function safeName(value: string): string {
  const name = basename(value.replaceAll('\\', '/')).replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_').replace(/^\.+/, '').trim()
  if (!name || Buffer.byteLength(name) > 200) throw new ControlError(400, '文件名为空或过长，请重命名后上传。')
  return name
}

export class WebFiles extends AttachmentStore {
  // 此入口将所有上传内容作为原样文件；图片也可上传，但不冒充已完成图片解码或 OCR。
  readonly imageLimits = { maxImageBytes: 0, maxImagesPerMessage: 0, maxMessageImageBytes: 0, maxImagePixels: 0, maxImageDimension: 0, mediaTypes: [] }
  readonly root = resolve(process.env.DSH_DEMO_WORK_DIR || fileURLToPath(new URL('../work/', import.meta.url)))
  private receipts = new Map<string, Receipt>()

  constructor(ctx: Context) { super(ctx) }
  async validateImage(): Promise<never> { throw new Error('当前 Web 入口将图片作为原始文件上传，请通过文件工具读取。') }
  async saveImage(): Promise<never> { throw new Error('当前 Web 入口不提供图片归一化。') }
  async readImage(): Promise<never> { throw new Error('当前 Web 入口不提供图片归一化读取。') }

  async init(): Promise<void> {
    await mkdir(this.root, { recursive: true })
    const uploads = join(this.root, 'uploads')
    await mkdir(uploads, { recursive: true, mode: 0o700 })
    await this.checkContained(uploads)
    for (const entry of await readdir(uploads, { withFileTypes: true })) {
      if (!entry.isDirectory() || !z.string().uuid().safeParse(entry.name).success) continue
      try {
        const folder = join(uploads, entry.name)
        await this.checkContained(folder)
        const receipt = receiptSchema.parse(JSON.parse(await readFile(join(folder, '.upload.json'), 'utf8')))
        if (receipt.id !== entry.name || safeName(receipt.name) !== receipt.name) continue
        await this.checkContained(this.hostPath(receipt))
        this.receipts.set(receipt.id, receipt)
      } catch { /* 不接纳不完整或损坏的上传记录；不删除用户文件。 */ }
    }
  }

  private hostPath(receipt: Receipt): string { return join(this.root, 'uploads', receipt.id, receipt.name) }
  private pathOf(receipt: Receipt): string { return ['uploads', receipt.id, receipt.name].join('/') }
  private ref(receipt: Receipt): FileAttachmentRef {
    return { attachmentId: AttachmentId(receipt.digest), name: receipt.name, bytes: receipt.bytes }
  }
  private entry(receipt: Receipt) {
    const path = this.pathOf(receipt)
    return { id: receipt.id, name: receipt.name, bytes: receipt.bytes, path, modifiedAt: receipt.createdAt,
      downloadUrl: '/api/files/download?path=' + encodeURIComponent(path) }
  }

  /** realpath 校验同时覆盖路径穿越和指向工作区外的符号链接。 */
  private async checkContained(path: string): Promise<string> {
    const root = await realpath(this.root)
    const target = await realpath(path)
    const part = relative(root, target)
    if (!part || part === '..' || part.startsWith('..' + sep) || isAbsolute(part)) throw new ControlError(403, '文件必须位于工作目录内。')
    return target
  }

  async upload(data: AsyncIterable<Uint8Array>, name: string, signal?: AbortSignal, maxBytes = MAX_FILE_BYTES) {
    const id = randomUUID(), filename = safeName(name)
    await this.checkContained(join(this.root, 'uploads'))
    const directory = join(this.root, 'uploads', id)
    await mkdir(directory, { mode: 0o700 })
    const destination = join(directory, filename)
    const hash = createHash('sha256')
    let bytes = 0
    try {
      const handle = await open(destination, 'wx', 0o600)
      try {
        for await (const chunk of data) {
          signal?.throwIfAborted()
          bytes += chunk.byteLength
          if (bytes > maxBytes) throw new ControlError(413, '单个文件不能超过 20 MiB。')
          hash.update(chunk)
          // FileHandle.write 允许部分写入，循环直至当前分片完整落盘。
          let offset = 0
          while (offset < chunk.byteLength) {
            const written = await handle.write(chunk, offset, chunk.byteLength - offset)
            if (!written.bytesWritten) throw new Error('上传文件写入失败。')
            offset += written.bytesWritten
          }
        }
        signal?.throwIfAborted()
        await handle.chmod(0o400)
      } finally { await handle.close() }
      const receipt: Receipt = { version: 1, id, name: filename, bytes, digest: 'sha256:' + hash.digest('hex'), createdAt: Date.now() }
      await writeFile(join(directory, '.upload.json'), JSON.stringify(receipt) + '\n', { mode: 0o600, flag: 'wx' })
      this.receipts.set(id, receipt)
      return this.entry(receipt)
    } catch (error) {
      await rm(directory, { recursive: true, force: true })
      throw error
    }
  }

  async saveFile(input: SaveFileAttachment): Promise<FileAttachmentRef> {
    return this.saveFileStream({ data: (async function* () { yield input.data })(), name: input.name })
  }
  async saveFileStream(input: SaveFileStreamAttachment): Promise<FileAttachmentRef> {
    // Web 传输限额仅用于浏览器接入，官方存储接口仍可供受信任调用方流式保存任意大小文件。
    const uploaded = await this.upload(input.data, input.name ?? 'file', input.signal, Infinity)
    return this.ref(this.receipts.get(uploaded.id)!)
  }
  fileHostPath(ref: FileAttachmentRef): string | undefined {
    // 同内容、同名称的回执引用相同哈希；重新上传后优先使用最新可读副本。
    const receipt = [...this.receipts.values()].reverse().sort((a, b) => b.createdAt - a.createdAt)
      .find(row => row.digest === ref.attachmentId && row.name === ref.name && row.bytes === ref.bytes && existsSync(this.hostPath(row)))
    return receipt ? this.hostPath(receipt) : undefined
  }
  /** 历史消息只展示已知上传回执的下载链接，不把模型文本当作文件路径。 */
  describe(ref: FileAttachmentRef) {
    const path = this.fileHostPath(ref)
    const receipt = [...this.receipts.values()].find(item => this.hostPath(item) === path)
    return receipt ? this.entry(receipt) : { name: ref.name, bytes: ref.bytes }
  }
  async *readFileStream(ref: FileAttachmentRef, signal?: AbortSignal): AsyncIterable<Uint8Array> {
    const path = this.fileHostPath(ref)
    if (!path) throw new ControlError(404, '找不到上传附件。')
    await this.checkContained(path)
    const hash = createHash('sha256')
    let bytes = 0
    for await (const chunk of createReadStream(path, { signal })) {
      bytes += chunk.length
      hash.update(chunk)
      yield chunk
    }
    if (bytes !== ref.bytes || 'sha256:' + hash.digest('hex') !== ref.attachmentId) throw new ControlError(409, '上传文件已变化，请重新上传。')
  }

  /** 消息只能引用服务器已签收的上传 ID，不能伪造路径或附件引用。 */
  async admit(ids: unknown): Promise<FileAttachmentRef[]> {
    if (ids === undefined) return []
    if (!Array.isArray(ids) || ids.length > MAX_ATTACHMENTS || ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length) {
      throw new ControlError(400, '附件必须是最多 10 个不重复的上传 ID。')
    }
    const receipts = ids.map(id => {
      const receipt = this.receipts.get(id)
      if (!receipt) throw new ControlError(404, '找不到上传附件，请重新上传或从文件面板选择。')
      return receipt
    })
    if (receipts.reduce((sum, receipt) => sum + receipt.bytes, 0) > MAX_MESSAGE_BYTES) throw new ControlError(413, '单条消息附件合计不能超过 100 MiB。')
    const refs = receipts.map(receipt => this.ref(receipt))
    for (const ref of refs) for await (const _chunk of this.readFileStream(ref)) { /* 流式校验原始文件完整性。 */ }
    return refs
  }

  async list() {
    const files: WorkFile[] = []
    let scanned = 0, truncated = false
    const walk = async (directory: string, prefix = '', depth = 0): Promise<void> => {
      if (depth > 12 || scanned > 5000 || files.length >= 1000) { truncated = true; return }
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue
        if (++scanned > 5000 || files.length >= 1000) { truncated = true; break }
        const path = prefix ? prefix + '/' + entry.name : entry.name
        const hostPath = join(directory, entry.name)
        try {
          await this.checkContained(hostPath)
          if (entry.isDirectory()) await walk(hostPath, path, depth + 1)
          else if (entry.isFile()) {
            const info = await stat(hostPath)
            files.push({ name: entry.name, path, bytes: info.size, modifiedAt: info.mtimeMs,
              downloadUrl: '/api/files/download?path=' + encodeURIComponent(path) })
          }
        } catch { /* 正在被后台任务替换/删除的文件下次刷新再显示。 */ }
      }
    }
    await walk(this.root)
    return { root: this.root, maxFileBytes: MAX_FILE_BYTES, maxMessageBytes: MAX_MESSAGE_BYTES, maxAttachments: MAX_ATTACHMENTS,
      files: files.sort((a, b) => b.modifiedAt - a.modifiedAt), uploads: [...this.receipts.values()].map(row => this.entry(row)), truncated }
  }

  async download(path: string, res: ServerResponse): Promise<void> {
    if (!path || isAbsolute(path) || path.includes('\\') || path.split('/').some(part => !part || part.startsWith('.') || /[\u0000-\u001f]/.test(part))) {
      throw new ControlError(403, '只允许下载工作目录内的普通文件。')
    }
    let target: string
    try { target = await this.checkContained(join(this.root, path)) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new ControlError(404, '文件不存在。'); throw error }
    const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const info = await handle.stat()
      if (!info.isFile()) throw new ControlError(403, '不能下载目录。')
      const name = basename(path)
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': info.size,
        'Content-Disposition': `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, char => '%' + char.charCodeAt(0).toString(16).toUpperCase())}`,
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
      await pipeline(handle.createReadStream({ autoClose: false }), res)
    } finally { await handle.close() }
  }

  async receive(req: IncomingMessage) {
    if (Number(req.headers['content-length']) > MAX_FILE_BYTES) { req.resume(); throw new ControlError(413, '单个文件不能超过 20 MiB。') }
    const encoded = req.headers['x-file-name']
    if (typeof encoded !== 'string') { req.resume(); throw new ControlError(400, '缺少上传文件名。') }
    let name: string
    try { name = decodeURIComponent(encoded) } catch { req.resume(); throw new ControlError(400, '文件名编码无效。') }
    try {
      // 提前拒绝过大请求时仍保留连接，以便浏览器收到可读的 413 错误。
      return await this.upload(req.iterator({ destroyOnReturn: false }), name)
    } finally { if (!req.readableEnded) req.resume() }
  }
}
