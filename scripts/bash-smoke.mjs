/** 通过真实 CLI、AgentLoop 和官方 Bash 插件验证前台执行与进程清理。 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
const directory = await mkdtemp(join(tmpdir(), 'dsh-bash-smoke-'))
const child = spawn(process.execPath, ['scripts/run.mjs', 'web', '--offline', '--port', '0'], { cwd: root,
  env: { ...process.env, DSH_DEMO_SESSION_DIR: join(directory, 'sessions'), DSH_DEMO_BASH_TIMEOUT_MS: '1500', DSH_DEMO_MCP_CONFIG: join(directory, 'mcp.json'), DSH_DEMO_SKILL_CONFIG: join(directory, 'skills.json'), DSH_DEMO_SKILL_DIR: join(directory, 'local-skills') } })
child.stdin.end()
let output = '', errors = ''
const closed = new Promise(resolve => child.once('close', resolve))
let origin
async function api(path, body) {
  const response = await fetch(origin + path, { signal: AbortSignal.timeout(15000), ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) })
  const value = await response.json()
  assert.ok(response.ok, JSON.stringify(value))
  return value
}
const session = async () => (await api('/api/sessions', {})).sessionId
const send = (sessionId, message) => fetch(origin + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId, message }), signal: AbortSignal.timeout(15000) })
async function chat(sessionId, message) {
  const response = await send(sessionId, message)
  const events = (await response.text()).trim().split('\n\n').map(frame => { const lines = frame.split('\n'); return { type: lines[0].slice(7), data: JSON.parse(lines[1].slice(6)) } })
  assert.equal(events.at(-1).type, 'done', JSON.stringify(events.at(-1)))
  const run = await api('/api/runs/' + events.find(event => event.type === 'run').data.id)
  const result = run.events.find(event => event.kind === 'session/tool/result')?.data.data.message
  return { run, result, text: result?.content.filter(block => block.type === 'text').map(block => block.text).join('') ?? '', reply: events.filter(event => event.type === 'delta').map(event => event.data.text).join('') }
}
async function until(read, predicate) {
  for (let index = 0; index < 100; index++) { const value = await read(); if (predicate(value)) return value; await new Promise(resolve => setTimeout(resolve, 50)) }
  throw new Error('等待执行状态超时')
}
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'"
try {
  origin = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('启动超时：' + errors)), 20000)
    child.stdout.setEncoding('utf8').on('data', data => { output += data; const match = output.match(/dsh demo web: (http:\/\/127\.0\.0\.1:\d+)/); if (match) { clearTimeout(timer); resolve(match[1]) } })
    child.stderr.setEncoding('utf8').on('data', data => { errors += data })
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('close', code => { clearTimeout(timer); reject(new Error(`提前退出 ${code}: ${errors}`)) })
  })
  const state = await api('/api/plugins')
  for (const key of ['subprocess-local', 'bash-local', 'shell-env', 'tool-bash']) {
    const row = state.entries.find(entry => entry.key === key)
    assert.equal(row.module, '@deepseek-ai/dsh-' + key)
    assert.equal(row.phase, 'active')
  }
  const id = await session()
  const first = await chat(id, '/bash printf "BASH_REAL_EXECUTION\\n"; pwd')
  assert.equal(first.result.isError, false)
  assert.match(first.text, /BASH_REAL_EXECUTION/)
  const work = join(root, 'work')
  assert.equal(first.text.trim(), 'BASH_REAL_EXECUTION\n' + work)
  const requests = first.run.events.filter(event => event.kind === 'llm/request')
  assert.equal(requests.length, 2)
  // 官方将动态工作目录放在 user 角色的运行上下文快照中。
  assert.ok(requests[0].data.request.messages.some(message => message.role === 'user' && message.content.some(block => block.type === 'text' && block.text.includes('Current working directory: ' + JSON.stringify(work)))), '模型应收到与 Bash 一致的工作目录')
  const schema = requests[0].data.request.tools.find(tool => tool.name === 'bash')
  assert.ok(schema)
  assert.equal(schema.parameters.properties.run_in_background, undefined)
  assert.ok(first.run.events.some(event => event.kind === 'session/tool/call' && event.data.data.name === 'bash'))
  assert.match((await chat(id, '/bash printf "%s" "$DSH_SESSION_ID"')).text, new RegExp(id))
  await chat(id, '/bash export BASH_DEMO_STATE=old; printf done')
  assert.equal((await chat(id, '/bash printf "%s" "${BASH_DEMO_STATE-unset}"')).text, 'unset')
  const failedCommand = await chat(id, '/bash printf "out\\n"; printf "err\\n" >&2; exit 7')
  assert.equal(failedCommand.result.isError, false)
  assert.match(failedCommand.text, /out\n\[stderr\]\nerr\n\[exit code: 7\]/)
  const timed = await chat(id, '/bash sleep 5')
  assert.match(timed.text, /timed out after 1500ms/)
  assert.match((await chat(id, '/bash printf AFTER_TIMEOUT')).text, /AFTER_TIMEOUT/)
  const large = await chat(id, '/bash node -e \'process.stdout.write("x".repeat(70000))\'')
  assert.match(large.text, /output truncated; full output:/)
  assert.ok(!large.text.includes('(unavailable)'), '完整输出应由官方子进程管理器保存')
  const toolsId = state.entries.find(entry => entry.key === 'tool-bash').id
  await api('/api/plugins/toggle', { id: toolsId, enabled: false })
  assert.match((await chat(await session(), '/bash printf SHOULD_NOT_RUN')).reply, /尚未就绪/)
  await api('/api/plugins/toggle', { id: toolsId, enabled: true })
  assert.match((await chat(await session(), '/bash printf RESTORED')).text, /RESTORED/)

  // 插件切换取消真实长命令，确认进程已经退出，而非只关闭网页响应。
  const pidFile = join(directory, 'bash.pid')
  const pending = send(await session(), '/bash printf "%s" "$$" > ' + quote(pidFile) + '; sleep 30').then(response => response.text()).catch(() => '')
  const pid = Number(await until(() => readFile(pidFile, 'utf8').catch(() => ''), text => /^\d+$/.test(text)))
  assert.ok(Number.isInteger(pid) && pid > 1)
  const processExists = () => { try { process.kill(pid, 0); return true } catch (error) { if (error.code === 'ESRCH') return false; throw error } }
  const subprocessId = state.entries.find(entry => entry.key === 'subprocess-local').id
  const stopped = await api('/api/plugins/toggle', { id: subprocessId, enabled: false })
  assert.equal(stopped.entries.find(entry => entry.key === 'bash-local').phase, 'pending')
  assert.equal(stopped.entries.find(entry => entry.key === 'tool-bash').phase, 'pending')
  await until(async () => processExists(), exists => !exists)
  await pending
  await api('/api/plugins/toggle', { id: subprocessId, enabled: true })
  assert.match((await chat(await session(), '/bash printf AFTER_CANCEL')).text, /AFTER_CANCEL/)
  console.log('官方 Bash：真实命令、会话环境、全新 shell、stderr/退出码、超时、输出溢出、工具启停、长进程取消及依赖恢复通过。')
} finally {
  child.kill('SIGTERM')
  const timer = setTimeout(() => child.kill('SIGKILL'), 8000)
  try { assert.equal(await closed, 0, errors) } finally { clearTimeout(timer); await rm(directory, { recursive: true, force: true }) }
}
