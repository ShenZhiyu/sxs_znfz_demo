/** 用真实 stdio 服务和本机 HTTP 协议夹具检查 MCP 管理，不访问外网或收费模型。 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const root = fileURLToPath(new URL('../', import.meta.url))
const directory = await mkdtemp(join(tmpdir(), 'dsh-mcp-management-'))
const configFile = join(directory, 'services.json'), pidFile = join(directory, 'server.pid')
const yamlBefore = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
// 包装器只额外记录 PID，真实工具和协议仍来自项目内置的 MCP 服务。
const wrapper = join(directory, 'server.mjs')
await writeFile(wrapper, `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(pidFile)}, String(process.pid));\nconst { serveStdio } = await import(${JSON.stringify(import.meta.resolve('@modelcontextprotocol/server/stdio'))});\nconst { createPlatformMcp } = await import(${JSON.stringify(new URL('../simulation/platform-mcp/server.mjs', import.meta.url).href)});\nserveStdio(createPlatformMcp);\n`)
const stdio = { serverName: 'managed-local', transport: 'stdio', command: process.execPath, args: [wrapper], cwd: root, env: { DEMO_SECRET: 'private-local-value' }, enabled: true, toolCallTimeoutMs: 10000 }

async function start() {
  const child = spawn(process.execPath, ['scripts/run.mjs', 'web', '--offline', '--port', '0'], { cwd: root, env: { ...process.env, DSH_DEMO_SESSION_DIR: join(directory, 'sessions'), DSH_DEMO_MCP_CONFIG: configFile } })
  child.stdin.end()
  let output = '', errors = ''
  const closed = new Promise(resolve => child.once('close', resolve))
  const origin = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('Web 启动超时：' + errors)) }, 20000)
    child.stdout.setEncoding('utf8').on('data', data => { output += data; const match = output.match(/dsh demo web: (http:\/\/127\.0\.0\.1:\d+)/); if (match) { clearTimeout(timer); resolve(match[1]) } })
    child.stderr.setEncoding('utf8').on('data', data => { errors += data })
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('close', code => { clearTimeout(timer); reject(new Error(`Web 提前退出 ${code}: ${errors}`)) })
  })
  return { origin, async stop() { child.kill('SIGTERM'); const timer = setTimeout(() => child.kill('SIGKILL'), 10000); try { assert.equal(await closed, 0, errors) } finally { clearTimeout(timer) } } }
}
async function api(app, path = '/api/mcp/services', body, headers = {}) {
  const response = await fetch(app.origin + path, { signal: AbortSignal.timeout(20000), ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }) })
  return { status: response.status, value: response.status === 204 ? null : await response.json() }
}
async function until(read, predicate) {
  for (let i = 0; i < 150; i++) { const value = await read(); if (predicate(value)) return value; await delay(30) }
  throw new Error('等待状态超时')
}
const exists = pid => { try { process.kill(pid, 0); return true } catch (error) { if (error.code === 'ESRCH') return false; throw error } }

// HTTP 夹具只实现测试需要的 MCP 初始化与工具发现；握手使用客户端请求的协议版本。
let unblock, hold = false, entered = false, authorization = ''
const http = createServer(async (req, res) => {
  if (req.method !== 'POST') { res.writeHead(405); res.end(); return }
  let raw = ''
  for await (const chunk of req) raw += chunk
  const request = JSON.parse(raw)
  authorization = req.headers.authorization || ''
  if (request.method === 'initialize' && hold) { entered = true; await new Promise(resolve => { unblock = resolve }) }
  if (request.id === undefined) { res.writeHead(202); res.end(); return }
  const result = request.method === 'initialize' ? { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'local-management-fixture', version: '1.0.0' } }
    : request.method === 'tools/list' ? { tools: [{ name: 'echo', description: '本机 HTTP 工具发现夹具', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }] }
      : { content: [{ type: 'text', text: 'fixture' }] }
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }))
})
await new Promise(resolve => http.listen(0, '127.0.0.1', resolve))
const url = `http://127.0.0.1:${http.address().port}/mcp`
let app
try {
  app = await start()
  const original = (await api(app)).value
  const builtin = original.services.find(service => service.config.serverName === 'environment')
  assert.equal(builtin.source, 'yaml')
  assert.equal(builtin.tools.length, 9)
  assert.equal((await api(app, '/api/mcp/delete', { id: builtin.id })).status, 403)
  assert.equal((await api(app, '/api/mcp/save', { config: { ...stdio, serverName: 'environment' } })).status, 409)
  assert.equal((await api(app, '/api/mcp/save', { config: { ...stdio, serverName: 'environment__overlap' } })).status, 409)
  assert.equal((await api(app, '/api/mcp/save', { config: { ...stdio, args: 'bad' } })).status, 400)
  assert.equal((await api(app, '/api/mcp/save', { config: { ...stdio, env: { __jsExpr: 'throw new Error()' } } })).status, 400)
  assert.equal((await api(app, '/api/mcp/save', { config: { serverName: 'bad-url', transport: 'streamable-http', url: 'file:///tmp/a' } })).status, 400)
  assert.equal((await api(app, '/api/mcp/save', { config: { serverName: 'invalid-url', transport: 'streamable-http', url: 'not a url' } })).status, 400)
  assert.equal((await api(app, '/api/mcp/save', { config: stdio }, { Origin: 'https://example.invalid' })).status, 403)
  const saved = await api(app, '/api/mcp/save', { config: stdio })
  assert.equal(saved.status, 200, JSON.stringify(saved.value))
  const local = saved.value.services.find(service => service.config.serverName === stdio.serverName)
  assert.equal(local.phase, 'active', JSON.stringify(local))
  assert.equal(local.tools.length, 24)
  assert.equal(local.config.env, undefined)
  assert.deepEqual(local.config.envKeys, ['DEMO_SECRET'])
  assert.ok(!JSON.stringify(saved.value).includes('private-local-value'))
  assert.equal((await stat(configFile)).mode & 0o777, 0o600)
  const pid = Number(await readFile(pidFile, 'utf8'))
  assert.ok(exists(pid))
  const tree = (await api(app, '/api/plugins')).value.entries
  const entry = tree.find(entry => entry.id === local.entryId)
  assert.ok(entry.switchable)
  assert.equal(entry.parentId, tree.find(entry => entry.key === 'minimal-web').id)

  // 插件树的开关也必须同步写回网页配置，并真正回收进程。
  assert.equal((await api(app, '/api/plugins/toggle', { id: local.entryId, enabled: false })).status, 200)
  // 操作系统可能稍后回收已退出进程的 PID，按实际消失状态等待，不使用固定睡眠。
  await until(async () => exists(pid), value => !value)
  assert.equal(exists(pid), false)
  assert.equal((await api(app)).value.services.find(service => service.id === local.id).tools.length, 0)
  assert.equal(JSON.parse(await readFile(configFile, 'utf8')).services[0].config.enabled, false)
  await api(app, '/api/mcp/toggle', { id: local.id, enabled: true })
  const nextPid = Number(await readFile(pidFile, 'utf8'))
  assert.notEqual(nextPid, pid)
  // 编辑时不传环境变量表示保留；显式 {} 表示清空。
  const { env, ...withoutEnv } = stdio
  await api(app, '/api/mcp/save', { id: local.id, config: { ...withoutEnv, toolCallTimeoutMs: 12000 } })
  assert.equal(JSON.parse(await readFile(configFile, 'utf8')).services[0].config.env.DEMO_SECRET, env.DEMO_SECRET)
  await until(async () => exists(nextPid), value => !value)
  assert.equal(exists(nextPid), false)
  await api(app, '/api/mcp/save', { id: local.id, config: { ...stdio, env: {} } })
  assert.deepEqual(JSON.parse(await readFile(configFile, 'utf8')).services[0].config.env, {})

  // 握手暂停期间查询仍可使用，并发修改被同一全局锁拒绝。
  hold = true
  const connecting = api(app, '/api/mcp/save', { config: { serverName: 'managed-http', transport: 'streamable-http', url, headers: { Authorization: 'Bearer local-secret' }, enabled: true } })
  await until(async () => entered, Boolean)
  assert.equal((await api(app)).value.changing, true)
  assert.equal((await api(app, '/api/mcp/toggle', { id: local.id, enabled: false })).status, 409)
  hold = false
  unblock()
  const connected = await connecting
  const remote = connected.value.services.find(service => service.config.serverName === 'managed-http')
  assert.equal(remote.phase, 'active', JSON.stringify(remote))
  assert.equal(remote.tools[0].name, 'mcp__managed-http__echo')
  assert.equal(authorization, 'Bearer local-secret')
  assert.ok(!JSON.stringify(connected.value).includes('Bearer local-secret'))
  const replacement = await api(app, '/api/mcp/save', { id: remote.id, config: { serverName: 'managed-http', transport: 'streamable-http', url, enabled: true, toolCallTimeoutMs: 14000 } })
  assert.equal(replacement.status, 200)
  assert.equal(authorization, 'Bearer local-secret')

  // 错误连接保留配置和可读错误，页面和其他服务保持可用。
  const failed = await api(app, '/api/mcp/save', { config: { ...stdio, serverName: 'broken', command: join(directory, 'not-an-executable') } })
  const broken = failed.value.services.find(service => service.config.serverName === 'broken')
  assert.equal(broken.phase, 'failed')
  assert.ok(broken.error)
  assert.equal(broken.tools.length, 0)
  assert.ok(!JSON.stringify(broken).includes('private-local-value'))
  await api(app, '/api/mcp/delete', { id: broken.id })
  assert.equal((await api(app, '/api/mcp/save', { id: '', config: stdio })).status, 404)

  // 没有完成握手的服务会超时卸载；等待期间 HTTP 管理查询仍然正常。
  hold = true
  entered = false
  const stalled = api(app, '/api/mcp/save', { config: { serverName: 'stalled-http', transport: 'streamable-http', url, enabled: true } })
  await until(async () => entered, Boolean)
  assert.equal((await api(app)).status, 200)
  const timedOut = (await stalled).value.services.find(service => service.config.serverName === 'stalled-http')
  assert.equal(timedOut.phase, 'failed')
  assert.match(timedOut.error, /10 秒/)
  hold = false
  unblock()
  await api(app, '/api/mcp/delete', { id: timedOut.id })

  // 核心工具服务停用和恢复时，动态子树也跟随真实依赖进入 pending/active。
  const toolsId = (await api(app, '/api/plugins')).value.entries.find(entry => entry.key === 'tools').id
  await api(app, '/api/plugins/toggle', { id: toolsId, enabled: false })
  const pending = (await api(app)).value.services.find(service => service.id === local.id)
  assert.equal(pending.tools.length, 0)
  assert.equal(pending.phase, 'pending')
  await api(app, '/api/plugins/toggle', { id: toolsId, enabled: true })
  assert.equal((await api(app)).value.services.find(service => service.id === local.id).tools.length, 24)

  // 工具变化后的新会话确实拿到新增的 schema。
  const session = (await api(app, '/api/sessions', {})).value.sessionId
  const chat = await fetch(app.origin + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: session, message: '你好' }) })
  assert.match(await chat.text(), /event: done/)
  const runs = (await api(app, '/api/runs')).value
  const run = (await api(app, '/api/runs/' + runs[0].id)).value
  assert.match(JSON.stringify(run.events.filter(event => event.kind === 'llm/request')), /mcp__managed-http__echo/)
  console.log('注册、工具发现、进程释放、插件树同步、编辑凭据保留、并发保护和失败恢复通过。')

  const runningPid = Number(await readFile(pidFile, 'utf8'))
  await app.stop()
  app = undefined
  await until(async () => exists(runningPid), value => !value)
  assert.equal(exists(runningPid), false)
  app = await start()
  const restored = await until(async () => (await api(app)).value, value => !value.changing && value.services.filter(service => service.source === 'web').every(service => service.phase === 'active'))
  assert.equal(restored.services.find(service => service.id === local.id).tools.length, 24)
  assert.equal(restored.services.find(service => service.id === remote.id).tools.length, 1)
  // 删除配置同时注销工具、移除树节点和回收子进程，重启后也不再恢复。
  const restoredPid = Number(await readFile(pidFile, 'utf8'))
  await api(app, '/api/mcp/delete', { id: local.id })
  await until(async () => exists(restoredPid), value => !value)
  assert.equal(exists(restoredPid), false)
  await api(app, '/api/mcp/delete', { id: remote.id })
  assert.equal((await api(app)).value.services.length, 5)
  assert.deepEqual(JSON.parse(await readFile(configFile, 'utf8')).services, [])
  assert.equal(await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8'), yamlBefore)
  console.log('重启恢复、配置权限、删除清理和 YAML 保持原样通过。')
} finally {
  unblock?.()
  if (app) await app.stop()
  http.closeAllConnections()
  await new Promise(resolve => http.close(resolve))
  await rm(directory, { recursive: true, force: true })
}
console.log('MCP 管理 smoke 全部通过；未调用外部 MCP 或真实模型。')
