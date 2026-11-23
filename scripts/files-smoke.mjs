/** 真实 Web 文件传输：原始字节、官方附件消息、Bash 读取、产物下载及重启恢复。 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const temporary = await mkdtemp(join(tmpdir(), 'dsh-files-smoke-'))
const work = join(temporary, 'work')
let app
async function start() {
  const child = spawn(process.execPath, ['scripts/run.mjs', 'web', '--offline', '--port', '0'], { cwd: root,
    env: { ...process.env, DSH_DEMO_SESSION_DIR: join(temporary, 'sessions'), DSH_DEMO_WORK_DIR: work, DSH_DEMO_SKILL_CONFIG: join(temporary, 'skills.json'), DSH_DEMO_MCP_CONFIG: join(temporary, 'mcp.json'), DSH_DEMO_SKILL_DIR: join(temporary, 'skills') } })
  child.stdin.end()
  const closed = new Promise(resolve => child.once('close', resolve))
  let output = '', errors = ''
  const origin = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('启动超时：' + errors)) }, 20000)
    child.stdout.setEncoding('utf8').on('data', chunk => { output += chunk; const hit = output.match(/dsh demo web: (http:\/\/127\.0\.0\.1:\d+)/); if (hit) { clearTimeout(timer); resolve(hit[1]) } })
    child.stderr.setEncoding('utf8').on('data', chunk => { errors += chunk })
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('close', code => { clearTimeout(timer); reject(new Error(`启动失败 ${code}: ${output} ${errors}`)) })
  })
  return { origin, async stop() { child.kill('SIGTERM'); const timer = setTimeout(() => child.kill('SIGKILL'), 8000); try { assert.equal(await closed, 0, errors) } finally { clearTimeout(timer) } } }
}
async function api(path, body) {
  return fetch(app.origin + path, { signal: AbortSignal.timeout(20000), ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) })
}
async function upload(name, bytes, extra = {}) {
  return fetch(app.origin + '/api/files/upload', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(name), ...extra }, body: bytes, signal: AbortSignal.timeout(20000) })
}
const session = async () => (await (await api('/api/sessions', {})).json()).sessionId
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'"
async function chat(id, message, attachments = []) {
  const response = await api('/api/chat', { sessionId: id, message, attachments })
  assert.equal(response.status, 200)
  const frames = (await response.text()).trim().split('\n\n').map(frame => { const lines = frame.split('\n'); return { type: lines[0].slice(7), data: JSON.parse(lines[1].slice(6)) } })
  assert.equal(frames.at(-1).type, 'done', JSON.stringify(frames.at(-1)))
  return (await api('/api/runs/' + frames.find(frame => frame.type === 'run').data.id)).json()
}
async function until(read, condition) {
  const deadline = Date.now() + 10000
  while (true) { const value = await read(); if (condition(value)) return value; assert.ok(Date.now() < deadline, '等待状态超时'); await new Promise(resolve => setTimeout(resolve, 50)) }
}
try {
  app = await start()
  assert.equal((await (await api('/api/files')).json()).root, work)
  const bytes = Buffer.from('项目名称：附件演示\nFILE_UPLOAD_MARKER\n', 'utf8')
  const response = await upload('样例资料.md', bytes)
  assert.equal(response.status, 201)
  const receipt = await response.json()
  assert.equal(receipt.name, '样例资料.md')
  assert.equal(receipt.bytes, bytes.length)
  assert.deepEqual(await readFile(join(work, receipt.path)), bytes)
  const binary = Buffer.from([0, 255, 128, 0, 1])
  const other = await (await upload('样例资料.md', binary)).json()
  assert.notEqual(other.path, receipt.path)
  assert.deepEqual(await readFile(join(work, receipt.path)), bytes)
  const empty = await (await upload('empty.txt', Buffer.alloc(0))).json()
  assert.equal(empty.bytes, 0)
  const download = await api(receipt.downloadUrl)
  assert.equal(download.status, 200)
  assert.match(download.headers.get('content-disposition'), /attachment;.*filename\*=UTF-8''/)
  assert.match(download.headers.get('content-disposition'), /%E6%A0%B7/)
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes)
  const id = await session()
  // 环境覆盖后，实际 Bash 执行与附件面板必须使用同一个工作根目录。
  const pwd = await chat(id, '/bash pwd')
  const pwdResult = pwd.events.find(event => event.kind === 'session/tool/result')?.data.data.message
  assert.equal(pwdResult?.content.filter(block => block.type === 'text').map(block => block.text).join('').trim(), work)
  const run = await chat(id, '请读取上传资料', [receipt.id])
  const admitted = run.events.find(event => event.kind === 'session/user/message' && event.data.data?.content?.some(block => block.type === 'file'))
  const fileBlock = admitted?.data.data.content.find(block => block.type === 'file')
  assert.ok(fileBlock, '会话中必须保存真正的官方 file 内容块')
  assert.equal(fileBlock.attachment.attachmentId, 'sha256:' + createHash('sha256').update(bytes).digest('hex'))
  // 观察器保留原始 file 块，适配器实际收到的路径投影可通过离线模型回显核对。
  const echoed = run.events.filter(event => event.kind === 'llm/chunk' && event.data.chunk.type === 'text-delta').map(event => event.data.chunk.text).join('')
  assert.ok(echoed.includes(join(work, receipt.path)), '模型端必须收到真实附件读取路径')
  const read = await chat(id, '/bash cat ' + quote(join(work, receipt.path)))
  assert.match(JSON.stringify(read.events.filter(event => event.kind === 'session/tool/result')), /FILE_UPLOAD_MARKER/)
  await chat(await session(), '', [other.id])
  const output = join(work, 'tenders/demo/output')
  const generated = join(output, '标书_20261021_演示.md')
  await mkdir(output, { recursive: true })
  await chat(id, '/bash printf DOCUMENT_OUTPUT_MARKER > ' + quote(generated))
  const listed = await (await api('/api/files')).json()
  const artifact = listed.files.find(file => file.name === '标书_20261021_演示.md')
  assert.ok(artifact)
  assert.equal(await (await api(artifact.downloadUrl)).text(), 'DOCUMENT_OUTPUT_MARKER')
  const attach = await api('/api/files/attach', { path: artifact.path })
  assert.equal(attach.status, 201)
  const artifactReceipt = await attach.json()
  assert.equal(artifactReceipt.name, artifact.name)
  assert.notEqual(artifactReceipt.path, artifact.path)
  const attachmentRun = await chat(id, '请参考工作区产物', [artifactReceipt.id])
  const attachedMessage = attachmentRun.events.find(event => event.kind === 'session/user/message'
    && event.data.data?.content?.some(block => block.type === 'file'))
  assert.equal(attachedMessage.data.data.content.find(block => block.type === 'file').attachment.name, artifact.name)
  await writeFile(generated, 'UPDATED_OUTPUT')
  assert.equal(await (await api(artifactReceipt.downloadUrl)).text(), 'DOCUMENT_OUTPUT_MARKER')
  await writeFile(generated, 'DOCUMENT_OUTPUT_MARKER')
  assert.ok(!listed.files.some(file => file.name.startsWith('.')))
  for (const attachments of [[randomUUID()], [receipt.id, receipt.id], [{ path: receipt.path }], Array.from({ length: 11 }, () => randomUUID())]) {
    const response = await api('/api/chat', { sessionId: id, message: '拒绝伪造引用', attachments })
    assert.ok([400, 404].includes(response.status))
  }
  assert.equal((await api('/api/chat', { sessionId: id, message: '', attachments: [] })).status, 400)
  assert.equal((await upload('cross.txt', bytes, { Origin: 'https://example.invalid' })).status, 403)
  assert.equal((await upload('too-large.bin', Buffer.alloc(20 * 1024 * 1024 + 1))).status, 413)
  // 无 Content-Length 的流式上传也必须正确返回 413，而不是把连接意外断开。
  async function* oversized() { for (let i = 0; i < 21; i++) yield Buffer.alloc(1024 * 1024) }
  const streamed = await fetch(app.origin + '/api/files/upload', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': 'streamed.bin' }, body: oversized(), duplex: 'half', signal: AbortSignal.timeout(20000) })
  assert.equal(streamed.status, 413)
  // 取消正在写入的上传后，不应留下半个文件或签收记录。
  const folder = join(work, 'uploads')
  const before = (await readdir(folder)).length
  const interrupted = request(app.origin + '/api/files/upload', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': 'cancel.bin' } })
  interrupted.on('error', () => {})
  interrupted.write(Buffer.alloc(4096))
  await until(() => readdir(folder), rows => rows.length > before)
  interrupted.destroy()
  await until(() => readdir(folder), rows => rows.length === before)
  const outside = join(temporary, 'private.txt')
  await writeFile(outside, 'OUTSIDE_WORK_ROOT')
  await symlink(outside, join(work, 'escape.txt'))
  await symlink(generated, join(work, 'internal-link.md'))
  for (const path of ['../private.txt', '/etc/passwd', 'escape.txt', 'uploads/' + receipt.id + '/.upload.json', 'tenders']) {
    assert.equal((await api('/api/files/download?path=' + encodeURIComponent(path))).status, 403, path)
    assert.equal((await api('/api/files/attach', { path })).status, 403, path)
  }
  assert.equal((await api('/api/files/attach', { path: 'internal-link.md' })).status, 403)
  assert.equal((await api('/api/files/attach', { path: 'missing.docx' })).status, 404)
  assert.equal((await api('/api/files/attach', {})).status, 400)
  assert.equal((await api('/api/files/download?path=missing.docx')).status, 404)
  assert.ok(!(await (await api('/api/files')).json()).files.some(file => file.path === 'escape.txt'))
  await chmod(join(work, other.path), 0o600)
  await writeFile(join(work, other.path), 'changed')
  assert.equal((await api('/api/chat', { sessionId: id, message: '损坏附件', attachments: [other.id] })).status, 409)
  // 重新上传相同原始内容应能修复可读副本，不能永远定位到已被修改的旧文件。
  const repaired = await (await upload('样例资料.md', binary)).json()
  await chat(await session(), '重新上传后的资料', [repaired.id])
  await app.stop(); app = undefined
  app = await start()
  assert.deepEqual(Buffer.from(await (await api(receipt.downloadUrl)).arrayBuffer()), bytes)
  await chat(await session(), '恢复后的文件', [receipt.id])
  await chat(await session(), '恢复后的工作区附件', [artifactReceipt.id])
  assert.equal(await (await api(artifact.downloadUrl)).text(), 'DOCUMENT_OUTPUT_MARKER')
  console.log('文件 smoke 通过：流式上传、原样存储、重名隔离、官方附件消息、Bash 实读、产物下载、重启恢复、超限/取消清理和下载范围校验。')
} finally {
  if (app) await app.stop()
  await rm(temporary, { recursive: true, force: true })
}
