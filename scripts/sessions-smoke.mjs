/** 真实官方 JSONL 与 AgentLoop：落盘、关闭、重启、并发恢复、完整上下文与工具结果。 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const directory = await mkdtemp(join(tmpdir(), 'dsh-sessions-smoke-'))
let app
async function start() {
  const child = spawn(process.execPath, ['scripts/run.mjs', 'web', '--offline', '--port', '0'], {
    cwd: root, detached: process.platform !== 'win32', env: { ...process.env,
      DSH_DEMO_SESSION_DIR: join(directory, 'sessions'), DSH_DEMO_WORK_DIR: join(directory, 'work'),
      DSH_DEMO_SKILL_CONFIG: join(directory, 'skills.json'), DSH_DEMO_SKILL_DIR: join(directory, 'skills'),
      DSH_DEMO_MCP_CONFIG: join(directory, 'mcp.json') },
  })
  child.stdin.end()
  const closed = new Promise(resolve => child.once('close', resolve))
  let output = '', errors = ''
  const origin = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('启动超时：' + errors)) }, 20000)
    child.stdout.setEncoding('utf8').on('data', data => { output += data; const hit = output.match(/dsh demo web: (http:\/\/127\.0\.0\.1:\d+)/); if (hit) { clearTimeout(timer); resolve(hit[1]) } })
    child.stderr.setEncoding('utf8').on('data', data => { errors += data })
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('close', code => { clearTimeout(timer); reject(new Error(`提前退出 ${code}：${errors}`)) })
  })
  return { origin, async stop(crash = false) {
    if (crash) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGTERM')
    const timer = setTimeout(() => child.kill('SIGKILL'), 8000)
    try { const code = await closed; if (!crash) assert.equal(code, 0, errors) } finally { clearTimeout(timer) }
  } }
}
async function request(path, body, method = body === undefined ? 'GET' : 'POST', headers = {}) {
  return fetch(app.origin + path, { method, signal: AbortSignal.timeout(20000), headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
}
async function api(path, body, method) {
  const response = await request(path, body, method)
  if (response.status === 204) return
  const value = await response.json()
  assert.ok(response.ok, JSON.stringify(value))
  return value
}
const create = async () => (await api('/api/sessions', {})).sessionId
async function chat(id, message, attachments = []) {
  const response = await request('/api/chat', { sessionId: id, message, attachments })
  assert.equal(response.status, 200)
  const events = (await response.text()).trim().split('\n\n').map(frame => { const lines = frame.split('\n'); return { type: lines[0].slice(7), data: JSON.parse(lines[1].slice(6)) } })
  assert.equal(events.at(-1).type, 'done', JSON.stringify(events.at(-1)))
  return events.filter(event => event.type === 'delta').map(event => event.data.text).join('')
}
try {
  app = await start()
  assert.equal((await api('/api/sessions')).sessions.length, 0)
  const id = await create()
  assert.ok((await api('/api/sessions')).sessions.some(row => row.id === id), '空会话也必须落盘')
  await chat(id, '我的项目编号是 SESSION_HISTORY_87')
  await chat(id, '/bash printf TOOL_HISTORY_42')
  const upload = await fetch(app.origin + '/api/files/upload', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent('历史附件.md') }, body: '附件原文' })
  const attachment = await upload.json()
  assert.equal(upload.status, 201)
  await chat(id, '', [attachment.id])
  const saved = await api('/api/sessions/' + id)
  assert.equal(saved.turns, 3)
  assert.ok(saved.events.some(event => event.type === 'tool/result' && JSON.stringify(event.data).includes('TOOL_HISTORY_42')))
  assert.ok(Object.values(saved.attachments).some(file => file.name === '历史附件.md' && file.downloadUrl))
  await api('/api/sessions/' + id, undefined, 'DELETE')
  assert.equal((await request('/api/chat', { sessionId: id, message: '未恢复时不应默默新建' })).status, 404)
  assert.equal((await api('/api/sessions/' + id)).events.length, saved.events.length)
  const other = await create()
  await chat(other, '另一个项目 PRIVATE_OTHER')
  await app.stop()
  app = await start()
  const list = await api('/api/sessions')
  assert.equal(list.sessions.length, 2)
  assert.equal(list.sessions.find(row => row.id === id).title, '我的项目编号是 SESSION_HISTORY_87')
  assert.equal((await api('/api/sessions/' + id)).events.length, saved.events.length)
  // 并发点击恢复应复用同一个 Agent，不能取得两个写入者或重复执行旧消息。
  await Promise.all([api('/api/sessions/' + id + '/resume', {}), api('/api/sessions/' + id + '/resume', {})])
  assert.equal((await api('/api/sessions/' + id)).turns, 3)
  const continued = await chat(id, '继续前面的项目')
  assert.match(continued, /第 4 轮/)
  assert.match(continued, /SESSION_HISTORY_87/)
  assert.doesNotMatch(continued, /PRIVATE_OTHER/)
  const after = await api('/api/sessions/' + id)
  assert.equal(after.turns, 4)
  for (let index = 0; index < saved.events.length; index++) assert.deepEqual(after.events[index], saved.events[index], '历史不能被改写')
  assert.equal((await request('/api/sessions/invalid')).status, 400)
  assert.equal((await request('/api/sessions/00000000-0000-0000-0000-000000000000/resume', {})).status, 404)
  assert.equal((await request('/api/sessions', undefined, 'GET', { Origin: 'https://example.invalid' })).status, 403)
  assert.equal((await request('/api/sessions/' + id + '/resume', {}, 'POST', { Origin: 'https://example.invalid' })).status, 403)
  const paths = await readdir(join(directory, 'sessions'), { recursive: true })
  assert.ok(paths.some(path => path.endsWith('.jsonl')), '必须是官方后端真实日志')
  const log = paths.find(path => path.includes(id) && path.endsWith('.jsonl'))
  assert.ok(log)
  assert.match(await readFile(join(directory, 'sessions', log), 'utf8'), /SESSION_HISTORY_87/)
  if (process.platform !== 'win32') {
    // 崩溃释放官方内核写锁；已确认完成的消息仍可从新进程恢复。
    await app.stop(true)
    app = await start()
    await api('/api/sessions/' + id + '/resume', {})
    assert.match(await chat(id, '崩溃后继续'), /第 5 轮/)
  }
  // 其他服务持有官方写锁时拒绝删除，不与正在写入的进程抢日志。
  const peer = await start()
  try {
    const opened = await fetch(peer.origin + '/api/sessions/' + other + '/resume', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    assert.equal(opened.status, 200, await opened.text())
    assert.equal((await request('/api/sessions/' + other + '/history', undefined, 'DELETE')).status, 409)
    assert.ok((await api('/api/sessions')).sessions.some(row => row.id === other))
  } finally { await peer.stop() }
  assert.equal((await request('/api/sessions/' + id + '/history', undefined, 'DELETE', { Origin: 'https://example.invalid' })).status, 403)
  assert.equal((await request('/api/sessions/invalid/history', undefined, 'DELETE')).status, 400)
  await api('/api/sessions/' + other + '/history', undefined, 'DELETE')
  // 最高版本之外的旧日志也必须删除，防止重启时恢复成过期会话。
  const logFile = join(directory, 'sessions', log)
  await writeFile(logFile.replace('session.v4.jsonl', 'session.v1.jsonl'), await readFile(logFile))
  await api('/api/sessions/' + id + '/history', undefined, 'DELETE')
  assert.equal((await request('/api/sessions/' + id)).status, 404)
  assert.equal((await request('/api/sessions/' + id + '/resume', {})).status, 404)
  assert.equal((await request('/api/chat', { sessionId: id, message: '不可复活' })).status, 404)
  assert.equal((await api('/api/sessions')).sessions.length, 0)
  assert.equal((await api('/api/runs')).filter(run => run.sessionId === id).length, 0)
  const remaining = await readdir(join(directory, 'sessions'), { recursive: true })
  assert.ok(!remaining.some(path => path.endsWith('.jsonl')), '删除所有日志代次，但保留官方锁文件')
  assert.ok(remaining.some(path => path.endsWith('session.lock')))
  assert.equal((await request(attachment.downloadUrl)).status, 200, '删除对话不能删除上传原件')
  await app.stop()
  app = await start()
  assert.equal((await api('/api/sessions')).sessions.length, 0, '重启后不能恢复已删除的记录')

  // 删除正在执行的会话，必须先停止它的真实 Bash 子进程。
  const running = await create(), pidFile = join(directory, 'running.pid')
  const quote = value => "'" + value.replaceAll("'", "'\\''") + "'"
  const response = await request('/api/chat', { sessionId: running, message: '/bash printf "%s" "$$" > ' + quote(pidFile) + '; sleep 30' })
  const body = response.text().catch(() => '')
  let pid
  for (let attempt = 0; attempt < 100; attempt++) {
    pid = Number(await readFile(pidFile, 'utf8').catch(() => ''))
    if (pid > 1) break
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  assert.ok(pid > 1)
  await api('/api/sessions/' + running + '/history', undefined, 'DELETE')
  await body
  assert.throws(() => process.kill(pid, 0), error => error.code === 'ESRCH', '活动 Bash 应已退出')
  assert.equal((await request('/api/sessions/' + running)).status, 404)
  assert.equal((await api('/api/sessions')).sessions.length, 0)
  console.log('会话历史通过：官方落盘与恢复、跨进程写锁、永久删除全部日志代次、重启不复活、活动命令清理、原件保留和来源校验。')
} finally {
  try { if (app) await app.stop() } finally { await rm(directory, { recursive: true, force: true }) }
}
