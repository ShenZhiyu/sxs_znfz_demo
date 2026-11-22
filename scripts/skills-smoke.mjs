/** Skill 管理集成验证：真实 Web、Prompt、工具执行和重启恢复，不访问外部模型。 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const directory = await mkdtemp(join(tmpdir(), 'dsh-skills-smoke-'))
const config = join(directory, 'skills.json')
const markdown = '---\nname: test-skill\ndescription: 测试按需加载和技能管理。\n---\n\n# 技能说明\n\nBODY_ONLY_MARKER：先检查资源，再按模板执行。\n\n`{{variable}}` 必须原样保留。\n'

async function start() {
  const child = spawn(process.execPath, ['scripts/run.mjs', 'web', '--offline', '--port', '0'], { cwd: root, env: { ...process.env, DSH_DEMO_SESSION_DIR: join(directory, 'sessions'), DSH_DEMO_SKILL_CONFIG: config, DSH_DEMO_SKILL_DIR: join(directory, 'local-skills'), DSH_DEMO_MCP_CONFIG: join(directory, 'mcp.json') } })
  child.stdin.end()
  let output = '', errors = ''
  const closed = new Promise(resolve => child.once('close', resolve))
  const origin = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('启动超时：' + errors)) }, 20000)
    child.stdout.setEncoding('utf8').on('data', data => { output += data; const match = output.match(/dsh demo web: (http:\/\/127\.0\.0\.1:\d+)/); if (match) { clearTimeout(timer); resolve(match[1]) } })
    child.stderr.setEncoding('utf8').on('data', data => { errors += data })
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('close', code => { clearTimeout(timer); reject(new Error(`提前退出 ${code}: ${errors}`)) })
  })
  return { origin, async stop() { child.kill('SIGTERM'); const timer = setTimeout(() => child.kill('SIGKILL'), 8000); try { assert.equal(await closed, 0, errors) } finally { clearTimeout(timer) } } }
}
async function api(app, path = '/api/skills', body, headers = {}) {
  const response = await fetch(app.origin + path, { signal: AbortSignal.timeout(15000), ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }) })
  return { status: response.status, value: response.status === 204 ? null : await response.json() }
}
async function chat(app, sessionId, message) {
  const response = await fetch(app.origin + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId, message }), signal: AbortSignal.timeout(15000) })
  assert.equal(response.status, 200)
  const events = (await response.text()).trim().split('\n\n').map(frame => { const lines = frame.split('\n'); return { type: lines[0].slice(7), data: JSON.parse(lines[1].slice(6)) } })
  assert.equal(events.at(-1).type, 'done')
  const runId = events.find(event => event.type === 'run').data.id
  return (await api(app, '/api/runs/' + runId)).value
}
const session = async app => (await api(app, '/api/sessions', {})).value.sessionId
const calls = run => run.events.filter(event => event.kind === 'session/tool/call')
const results = run => run.events.filter(event => event.kind === 'session/tool/result')
const requestMessages = run => run.events.filter(event => event.kind === 'llm/request').flatMap(event => event.data.request.messages)
const catalogNames = run => requestMessages(run).filter(message => message.source?.kind === 'skill-catalog')
  .flatMap(message => message.source.entries.map(entry => entry.name))
let app
try {
  // 迁移旧版默认停用设置，同时保留第一份原配置备份。
  const legacy = JSON.stringify({ version: 1, skills: [], builtinEnabled: false }) + '\n'
  await writeFile(config, legacy, { mode: 0o600 })
  app = await start()
  const initial = (await api(app)).value
  assert.equal(initial.runtimeReady, true)
  assert.equal(initial.skills.length, 2)
  assert.deepEqual(initial.commands.map(row => row.name), ['tender-writing'])
  const pluginNames = (await api(app, '/api/plugins')).value.entries.map(entry => entry.module)
  for (const name of ['skill', 'tool-skill', 'working-directory', 'fs-local']) assert.ok(pluginNames.includes('@deepseek-ai/dsh-' + name))
  assert.ok(pluginNames.some(name => name.endsWith('/src/skill-filesystem.ts')))
  const builtin = initial.skills.find(row => row.id === 'directory:underwater-simulation')
  assert.equal(builtin.source, 'filesystem')
  assert.equal(builtin.managed, true)
  const migrated = JSON.parse(await readFile(config, 'utf8'))
  assert.equal(migrated.version, 2)
  assert.equal(migrated.directoryEnabled['underwater-simulation'], false)
  assert.equal(await readFile(config + '.v1.bak', 'utf8'), legacy)
  // 标书技能为真实文件目录贡献，保留脚本资源路径，由官方插件负责显式注入。
  const tender = initial.skills.find(row => row.name === 'tender-writing')
  assert.equal(tender.source, 'filesystem')
  assert.equal(tender.managed, true)
  assert.equal(tender.editable, false)
  assert.equal(tender.available, true)
  const tenderRun = await chat(app, await session(app), '/tender-writing 根据样例撰写标书')
  const tenderRequests = JSON.stringify(tenderRun.events.filter(event => event.kind === 'llm/request'))
  assert.match(tenderRequests, /skill-invocation/)
  assert.match(tenderRequests, /assemble_docx.py/)
  assert.match(tenderRequests, /tender-writing/)
  const tenderContents = await readFile(join(root, 'skills/tender-writing/SKILL.md'), 'utf8')
  const tenderScript = await readFile(join(root, 'skills/tender-writing/scripts/assemble_docx.py'), 'utf8')
  const tenderLoaded = await chat(app, await session(app), '/skill tender-writing')
  assert.equal(results(tenderLoaded)[0].data.data.message.isError, false)
  assert.match(JSON.stringify(results(tenderLoaded)), /skills\/tender-writing/)
  // 目录停用同时影响实际加载、官方模型目录和显式用户注入；管理页仍能查看源文。
  const oldSession = await session(app)
  await chat(app, oldSession, '/tender-writing')
  assert.equal((await api(app, '/api/skills/toggle', { id: tender.id, enabled: false })).status, 200)
  assert.ok(!(await api(app)).value.commands.some(row => row.name === tender.name))
  assert.equal((await api(app, '/api/skills/detail?id=' + tender.id)).value.markdown, tenderContents)
  const deniedTender = await chat(app, await session(app), '/skill tender-writing')
  assert.equal(results(deniedTender)[0].data.data.message.isError, true)
  assert.ok(!catalogNames(deniedTender).includes(tender.name))
  const noTender = await chat(app, await session(app), '/tender-writing')
  assert.ok(!requestMessages(noTender).some(message => message.source?.kind === 'skill-invocation'))
  const stale = await fetch(app.origin + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: oldSession, message: '旧会话' }) })
  assert.equal(stale.status, 404)
  assert.equal((await api(app, '/api/skills/delete', { id: tender.id })).status, 403)
  assert.equal((await api(app, '/api/skills/save', { id: tender.id, markdown: tenderContents, enabled: true })).status, 403)
  await api(app, '/api/skills/toggle', { id: tender.id, enabled: true })
  assert.equal(results(await chat(app, await session(app), '/skill tender-writing'))[0].data.data.message.isError, false)
  assert.equal(await readFile(join(root, 'skills/tender-writing/SKILL.md'), 'utf8'), tenderContents)
  assert.equal(await readFile(join(root, 'skills/tender-writing/scripts/assemble_docx.py'), 'utf8'), tenderScript)
  assert.equal(builtin.enabled, false)
  assert.equal(builtin.editable, false)
  assert.equal((await api(app, '/api/skills/delete', { id: builtin.id })).status, 403)
  assert.equal((await api(app, '/api/skills/save', { id: builtin.id, markdown, enabled: true })).status, 403)
  assert.equal((await api(app, '/api/skills/detail?id=../../etc/passwd')).status, 404)
  const existingSession = await session(app)
  const revision = (await api(app)).value.revision
  const preview = await api(app, '/api/skills/preview', { markdown })
  assert.equal(preview.value.name, 'test-skill')
  assert.match(preview.value.body, /BODY_ONLY_MARKER/)
  assert.equal((await api(app)).value.revision, revision)
  for (const invalid of ['plain text', markdown.replace('test-skill', '../../escape'), markdown.replace('description: 测试按需加载和技能管理。', 'description: !!js process.exit()'), markdown.split('\n---\n')[0] + '\n---\n']) {
    assert.equal((await api(app, '/api/skills/save', { markdown: invalid, enabled: true })).status, 400)
  }
  assert.equal((await api(app, '/api/skills/save', { markdown, enabled: true }, { Origin: 'https://example.invalid' })).status, 403)
  // 错误和只读预览不清空现有会话。
  await chat(app, existingSession, '验证无效输入后会话仍然存在')
  const saved = (await api(app, '/api/skills/save', { markdown, enabled: false })).value
  const skill = saved.skills.find(skill => skill.name === 'test-skill')
  assert.equal(skill.available, false)
  assert.equal(skill.markdown, undefined)
  assert.equal((await stat(config)).mode & 0o777, 0o600)
  assert.equal((await api(app, '/api/skills/detail?id=' + skill.id)).value.markdown, markdown)
  assert.equal((await api(app, '/api/skills/save', { markdown, enabled: true })).status, 409)
  await api(app, '/api/skills/toggle', { id: skill.id, enabled: true })
  assert.equal((await api(app)).value.skills.find(row => row.id === skill.id).available, true)

  // 第一请求只有官方持久目录摘要；完整指令通过官方 skill 工具进入第二次请求。
  const loaded = await chat(app, await session(app), '/skill test-skill')
  assert.equal(calls(loaded)[0].data.data.name, 'skill')
  assert.ok(loaded.events.filter(event => event.kind === 'llm/request').every(event => !event.data.request.tools.some(tool => tool.name === 'skill_read')))
  assert.equal(results(loaded)[0].data.data.message.isError, false)
  assert.match(JSON.stringify(results(loaded)), /BODY_ONLY_MARKER/)
  const requests = loaded.events.filter(event => event.kind === 'llm/request')
  assert.equal(requests.length, 2)
  assert.match(JSON.stringify(requests[0].data), /测试按需加载和技能管理/)
  assert.doesNotMatch(JSON.stringify(requests[0].data), /BODY_ONLY_MARKER/)
  assert.match(JSON.stringify(requests[1].data), /BODY_ONLY_MARKER/)
  assert.match(JSON.stringify(results(loaded)), /\{\{variable\}\}/)
  // /技能名 的完整注入由官方 pre-step 处理，无需模拟器伪造工具调用。
  const explicit = await chat(app, await session(app), '/test-skill 请按这个技能处理')
  assert.equal(calls(explicit).length, 0)
  assert.match(JSON.stringify(explicit.events.filter(event => event.kind === 'llm/request')), /skill-invocation/)
  assert.match(JSON.stringify(explicit.events.filter(event => event.kind === 'llm/request')), /BODY_ONLY_MARKER/)
  assert.ok((await api(app)).value.commands.some(row => row.name === 'test-skill'))
  await api(app, '/api/skills/toggle', { id: skill.id, enabled: false })
  assert.ok(!(await api(app)).value.commands.some(row => row.name === 'test-skill'))
  const unavailable = await chat(app, await session(app), '/skill test-skill')
  assert.equal(results(unavailable)[0].data.data.message.isError, true)
  assert.doesNotMatch(JSON.stringify(unavailable.events.filter(event => event.kind === 'llm/request')), /BODY_ONLY_MARKER/)

  const changed = markdown.replace('BODY_ONLY_MARKER', 'EDITED_BODY_MARKER')
  await api(app, '/api/skills/save', { id: skill.id, markdown: changed, enabled: true })
  await api(app, '/api/skills/toggle', { id: builtin.id, enabled: true })
  const tree = (await api(app, '/api/plugins')).value.entries
  const promptId = tree.find(entry => entry.key === 'system-prompt').id
  await api(app, '/api/plugins/toggle', { id: promptId, enabled: false })
  assert.equal((await api(app)).value.runtimeReady, false)
  await api(app, '/api/plugins/toggle', { id: promptId, enabled: true })
  assert.equal((await api(app)).value.runtimeReady, true)
  const toolsId = tree.find(entry => entry.key === 'tools').id
  await api(app, '/api/plugins/toggle', { id: toolsId, enabled: false })
  assert.equal((await api(app)).value.runtimeReady, false)
  await api(app, '/api/plugins/toggle', { id: toolsId, enabled: true })
  assert.equal((await api(app)).value.runtimeReady, true)
  const restoredRuntime = await chat(app, await session(app), '/skill test-skill')
  assert.match(JSON.stringify(results(restoredRuntime)), /EDITED_BODY_MARKER/)
  const builtinRun = await chat(app, await session(app), '/skill underwater-simulation')
  assert.equal(results(builtinRun)[0].data.data.message.isError, false)
  assert.match(JSON.stringify(results(builtinRun)), /mcp__demo__run_simulation/)
  // 目录提供方停止/恢复时，停用技能不能重新泄漏，网页技能也不应被一并移除。
  const filesystem = tree.find(entry => entry.key === 'skill-filesystem')
  await api(app, '/api/skills/toggle', { id: tender.id, enabled: false })
  await api(app, '/api/plugins/toggle', { id: filesystem.id, enabled: false })
  const withoutFiles = (await api(app)).value
  assert.equal(withoutFiles.skills.find(row => row.id === builtin.id).available, false)
  assert.equal(withoutFiles.skills.find(row => row.id === tender.id).enabled, false)
  assert.ok(withoutFiles.commands.some(row => row.name === 'test-skill'))
  assert.ok(!withoutFiles.commands.some(row => row.name === builtin.name))
  await api(app, '/api/skills/toggle', { id: tender.id, enabled: true })
  assert.equal((await api(app)).value.skills.find(row => row.id === tender.id).available, false)
  await api(app, '/api/skills/toggle', { id: tender.id, enabled: false })
  await api(app, '/api/plugins/toggle', { id: filesystem.id, enabled: true })
  assert.equal((await api(app)).value.commands.filter(row => row.name === builtin.name).length, 1)
  assert.ok(!(await api(app)).value.commands.some(row => row.name === tender.name))
  // 同一官方策略必须约束模型工具和用户显式入口，不能只隐藏补全。
  const userOnly = markdown.replace('name: test-skill', 'name: user-only').replace('description:', 'disable-model-invocation: true\ndescription:')
  const userSaved = (await api(app, '/api/skills/save', { markdown: userOnly, enabled: true })).value
  const userRow = userSaved.skills.find(row => row.name === 'user-only')
  assert.equal(userRow.modelAvailable, false)
  assert.equal(userRow.userAvailable, true)
  assert.ok(userSaved.commands.some(row => row.name === 'user-only'))
  const denied = await chat(app, await session(app), '/skill user-only')
  assert.equal(results(denied)[0].data.data.message.isError, true)
  assert.match(JSON.stringify(results(denied)), /not available for model invocation/)
  assert.match(JSON.stringify((await chat(app, await session(app), '/user-only')).events.filter(event => event.kind === 'llm/request')), /BODY_ONLY_MARKER/)
  const modelOnly = markdown.replace('name: test-skill', 'name: model-only').replace('description:', 'user-invocable: false\ndescription:')
  const modelSaved = (await api(app, '/api/skills/save', { markdown: modelOnly, enabled: true })).value
  const modelRow = modelSaved.skills.find(row => row.name === 'model-only')
  assert.equal(modelRow.modelAvailable, true)
  assert.equal(modelRow.userAvailable, false)
  assert.ok(!modelSaved.commands.some(row => row.name === 'model-only'))
  const noInjection = await chat(app, await session(app), '/model-only')
  assert.doesNotMatch(JSON.stringify(noInjection.events.filter(event => event.kind === 'llm/request')), /BODY_ONLY_MARKER/)
  assert.match(JSON.stringify(results(await chat(app, await session(app), '/skill model-only'))), /BODY_ONLY_MARKER/)
  assert.equal((await api(app, '/api/skills/preview', { markdown: modelOnly.replace('user-invocable: false', 'user-invocable: sometimes') })).status, 400)
  await api(app, '/api/skills/delete', { id: userRow.id })
  await api(app, '/api/skills/delete', { id: modelRow.id })

  // 官方注册表/工具插件停止与恢复，网页数据仍可读，贡献不会遗留或重复。
  for (const key of ['tool-skill', 'skill', 'working-directory', 'fs-local']) {
    const entry = (await api(app, '/api/plugins')).value.entries.find(entry => entry.key === key)
    await api(app, '/api/plugins/toggle', { id: entry.id, enabled: false })
    assert.equal((await api(app)).value.runtimeReady, false)
    assert.deepEqual((await api(app)).value.commands, [])
    await api(app, '/api/plugins/toggle', { id: entry.id, enabled: true })
    assert.equal((await api(app)).value.runtimeReady, true)
    assert.equal((await api(app)).value.commands.filter(row => row.name === 'test-skill').length, 1)
  }

  // 新目录自动发现，也能通过相同的独立状态管理启停，源文件保持只读。
  const local = join(directory, 'local-skills', 'local-demo')
  await mkdir(local, { recursive: true })
  await writeFile(join(local, 'SKILL.md'), markdown.replace('test-skill', 'local-demo').replace('BODY_ONLY_MARKER', 'FILESYSTEM_MARKER'))
  const deadline = Date.now() + 10000
  while (!(await api(app)).value.commands.some(row => row.name === 'local-demo')) {
    assert.ok(Date.now() < deadline, '官方文件系统发现超时：' + JSON.stringify((await api(app)).value))
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  const localRow = (await api(app)).value.skills.find(row => row.name === 'local-demo')
  assert.equal(localRow.source, 'filesystem')
  assert.equal(localRow.managed, true)
  assert.equal(localRow.editable, false)
  assert.match((await api(app, '/api/skills/detail?id=' + localRow.id)).value.markdown, /FILESYSTEM_MARKER/)
  assert.equal((await api(app, '/api/skills/toggle', { id: localRow.id, enabled: false })).status, 200)
  assert.equal(results(await chat(app, await session(app), '/skill local-demo'))[0].data.data.message.isError, true)
  await api(app, '/api/skills/toggle', { id: localRow.id, enabled: true })
  assert.match(JSON.stringify((await chat(app, await session(app), '/local-demo')).events.filter(event => event.kind === 'llm/request')), /FILESYSTEM_MARKER/)
  await writeFile(join(local, 'SKILL.md'), markdown.replace('test-skill', 'local-demo').replace('BODY_ONLY_MARKER', 'FRESH_FILESYSTEM_BODY'))
  assert.match(JSON.stringify((await chat(app, await session(app), '/local-demo')).events.filter(event => event.kind === 'llm/request')), /FRESH_FILESYSTEM_BODY/)
  await rm(local, { recursive: true })
  console.log('官方 Skill 目录、模型工具与 /技能名 注入、调用权限、文件发现/正文更新、CRUD 和依赖恢复通过。')

  await app.stop()
  app = undefined
  app = await start()
  const afterRestart = (await api(app)).value
  assert.equal(afterRestart.skills.find(row => row.id === skill.id).available, true)
  assert.equal(afterRestart.skills.find(row => row.id === builtin.id).enabled, true)
  assert.equal(afterRestart.skills.find(row => row.id === tender.id).enabled, false)
  assert.ok(!afterRestart.commands.some(row => row.name === tender.name))
  assert.equal(results(await chat(app, await session(app), '/skill tender-writing'))[0].data.data.message.isError, true)
  const persisted = await chat(app, await session(app), '/skill test-skill')
  assert.match(JSON.stringify(results(persisted)), /EDITED_BODY_MARKER/)
  await api(app, '/api/skills/delete', { id: skill.id })
  await api(app, '/api/skills/toggle', { id: builtin.id, enabled: false })
  assert.equal((await api(app, '/api/skills/detail?id=' + skill.id)).status, 404)
  const removed = await chat(app, await session(app), '/skill test-skill')
  assert.equal(results(removed)[0].data.data.message.isError, true)
  assert.deepEqual(JSON.parse(await readFile(config, 'utf8')).skills, [])
  await app.stop()
  app = undefined

  // 旧版已启用状态与已有网页技能也必须无损迁移，不能退回默认值。
  await rm(config + '.v1.bak')
  const legacyEnabled = JSON.stringify({ version: 1, builtinEnabled: true,
    skills: [{ id: skill.id, enabled: true, markdown, updatedAt: 1 }] })
  await writeFile(config, legacyEnabled)
  app = await start()
  const migratedEnabled = (await api(app)).value
  assert.equal(migratedEnabled.skills.find(row => row.id === builtin.id).enabled, true)
  assert.equal(migratedEnabled.skills.find(row => row.id === tender.id).enabled, true)
  assert.equal(migratedEnabled.skills.find(row => row.id === skill.id).enabled, true)
  assert.equal(await readFile(config + '.v1.bak', 'utf8'), legacyEnabled)
  assert.equal(JSON.parse(await readFile(config, 'utf8')).version, 2)
  assert.match(JSON.stringify(results(await chat(app, await session(app), '/skill test-skill'))), /BODY_ONLY_MARKER/)
  await app.stop()
  app = undefined

  // 损坏的持久化文件不阻止管理页启动，也不会被保存操作悄悄覆盖。
  await writeFile(config, '{invalid')
  app = await start()
  assert.match((await api(app)).value.notice, /无法解析/)
  assert.equal((await api(app, '/api/skills/save', { markdown, enabled: true })).status, 409)
  assert.deepEqual((await api(app)).value.commands, [])
  assert.equal(await readFile(config, 'utf8'), '{invalid')
  assert.equal((await api(app, '/api/config')).status, 200)
  console.log('目录统一启停、补全/模型目录/实际加载同步、资源路径保留、旧配置迁移备份、重启恢复和损坏文件保护通过。')
} finally {
  if (app) await app.stop()
  await rm(directory, { recursive: true, force: true })
}
console.log('Skills smoke 全部通过；未访问外部模型或用户技能目录。')
