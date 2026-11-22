import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, realpath, rename, stat, unlink } from 'node:fs/promises'
import { basename, isAbsolute, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const maxUploadBytes = 4 * 1024 * 1024
const outputDirectory = 'platform-artifacts'

export async function readWorkspaceFile(workDir, filePath) {
  const parts = filePath.split('/')
  if (isAbsolute(filePath) || /^[a-z]:/i.test(filePath) || /[\\\u0000-\u001f\u007f]/.test(filePath) ||
      parts.some(part => !part || part.startsWith('.'))) {
    throw new Error('filePath 必须是工作目录内的普通相对路径。')
  }
  const root = await realpath(workDir)
  const target = join(root, ...parts)
  if (await realpath(target) !== target || !(await lstat(target)).isFile()) {
    throw new Error('filePath 必须指向工作目录内的普通文件，不可使用符号链接。')
  }
  const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    if (await realpath(target) !== target) throw new Error('文件路径已经变更。')
    const info = await file.stat()
    if (!info.isFile() || info.size > maxUploadBytes) throw new Error('请选择 4 MiB 以内的普通文件。')
    const bytes = Buffer.alloc(info.size + 1)
    let offset = 0
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset)
      if (!bytesRead) break
      offset += bytesRead
    }
    if (offset !== info.size) throw new Error('文件大小在读取期间发生变化。')
    return { name: basename(target), bytes: bytes.subarray(0, offset) }
  } finally {
    await file.close()
  }
}

export async function saveWorkspaceFile(workDir, body, extension, signal) {
  await mkdir(workDir, { recursive: true })
  const root = await realpath(workDir)
  const directory = join(root, outputDirectory)
  await mkdir(directory, { recursive: true })
  if (await realpath(directory) !== directory) throw new Error('产物目录不可使用符号链接。')

  const name = randomUUID() + extension
  const staging = join(directory, '.' + name + '.partial')
  const target = join(directory, name)
  const file = await open(staging, 'wx')
  try {
    try {
      await pipeline(Readable.fromWeb(body), file.createWriteStream(), { signal })
    } finally {
      await file.close()
    }
    const { size } = await stat(staging)
    signal.throwIfAborted()
    await rename(staging, target)
    return { path: outputDirectory + '/' + name, bytes: size }
  } finally {
    await unlink(staging).catch(error => { if (error.code !== 'ENOENT') throw error })
  }
}
