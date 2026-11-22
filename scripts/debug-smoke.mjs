/** 调试功能验证：真实启停核心插件，并用本机模型协议夹具验证原始字节、思考、用量和取消。 */
// 断言失败会以非零退出码结束，不把日志文字当测试成功。
import assert from 'node:assert/strict'
// 启动与用户相同的 Web 命令，确保经过真实 Loader。
import { spawn } from 'node:child_process'
// 模型协议夹具只监听本机临时端口，不访问外部服务。
import { createServer } from 'node:http'
// 生成前后比较配置，确保临时启停不改写教学 YAML。
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
// 临时 profile 用于验证真实 Group/Include 层级，不改写用户运行数据。
import { tmpdir } from 'node:os'
// 安全组合临时文件路径。
import { join } from 'node:path'
// 官方源码启动的路径与 file: URL 都以本项目为基准。
import { fileURLToPath, pathToFileURL } from 'node:url'
// 延迟用于制造可取消的真实网络读取，不在产品代码里伪造模型耗时。
import { setTimeout as delay } from 'node:timers/promises'
// 根据脚本位置定位项目，避免依赖调用目录。
const cwd = new URL('../', import.meta.url)

// HTTP 访问加超时；默认 GET，传对象时发送 JSON POST。
async function api(origin, path, body) {
  // 请求只访问本次启动的本机地址。
  const response = await fetch(origin + path, { signal: AbortSignal.timeout(15000), ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) })
  // JSON 响应与状态一起返回，便于验证失败路径。
  return { status: response.status, value: response.status === 204 ? null : await response.json() }
// 结束请求工具。
}
// 每个应用使用 OS 空闲端口；捕获实际地址后才开始测试。
async function start(offline, env = {}, fixture) {
  const sessionDirectory = await mkdtemp(join(tmpdir(), 'dsh-debug-sessions-'))
  // 不启动 shell，参数以独立数组成员传给 Node。
  const args = fixture ? ['--import', 'tsx/esm', 'vendor/harness/apps/cli/src/bin.ts', '--profile', 'minimal-chat', '--patch', 'cordis.patch.yml', '--patch', 'cordis.web.patch.yml', '--patch', fixture.patch] : ['scripts/run.mjs', 'web', '--port', '0', ...(offline ? ['--offline'] : [])]
  // 层级夹具仍通过同一个官方 CLI 与产品 YAML 加载，仅额外叠加测试条目。
  const child = spawn(process.execPath, args, { cwd, env: { ...process.env, DSH_DEMO_SESSION_DIR: sessionDirectory, ...env, ...(fixture ? { DSH_HOME: fixture.home, DSH_DEMO_OFFLINE: '1', DSH_DEMO_PORT: '0', TSX_TSCONFIG_PATH: fileURLToPath(new URL('../vendor/harness/tsconfig.base.json', import.meta.url)) } : {}) } })
  // Web 模式不应因 stdin EOF 退出。
  child.stdin.end()
  // 保存日志及退出结果，失败时展示原因。
  let output = '', errors = ''
  // 先监听 close，避免快速失败时错过事件。
  const closed = new Promise(resolve => child.on('close', code => resolve(code)))
  // 仅实际就绪日志出现后才解析端口。
  const origin = await new Promise((resolve, reject) => {
    // 初始化卡住时终止测试子进程。
    const timeout = setTimeout(() => { child.kill('SIGTERM'); reject(new Error(errors || '应用启动超时')) }, 15000)
    // data 不是按行触发，先累积再寻找完整 URL。
    child.stdout.setEncoding('utf8').on('data', text => { output += text; const match = output.match(/dsh demo web: (http:\/\/127\.0\.0\.1:\d+)/); if (match) { clearTimeout(timeout); resolve(match[1]) } })
    // 错误只用于诊断，不打印进程环境或凭据。
    child.stderr.setEncoding('utf8').on('data', text => { errors += text })
    // 系统无法启动时立即失败。
    child.once('error', error => { clearTimeout(timeout); reject(error) })
    // 就绪前退出不能被视为成功。
    child.once('close', code => { clearTimeout(timeout); reject(new Error(`提前退出 ${code}: ${errors}`)) })
  // 结束就绪等待。
  })
  // 返回显式清理方法，所有测试分支都在 finally 中调用。
  return { origin, async stop() { child.kill('SIGTERM'); try { assert.equal(await closed, 0, errors) } finally { await rm(sessionDirectory, { recursive: true, force: true }) } } }
// 结束进程工具。
}
// 创建一个真实 Agent 会话，只有成功返回 201 才继续。
async function session(origin) { const response = await api(origin, '/api/sessions', {}); assert.equal(response.status, 201, JSON.stringify(response.value)); return response.value.sessionId }
// 开始聊天但不立即读完整正文，用于观察实时事件和取消。
const send = (origin, sessionId, message, signal) => fetch(origin + '/api/chat', { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId, message }) })
// 按本 demo 的协议解析完整 SSE，测试可在响应结束后整体检查。
const frames = text => text.trim().split('\n\n').filter(Boolean).map(block => { const lines = block.split('\n'); return { type: lines[0].slice(7), data: JSON.parse(lines[1].slice(6)) } })
// 等待明确状态而不是用固定 sleep 猜测插件是否就绪。
async function until(read, predicate) { for (let i = 0; i < 100; i++) { const value = await read(); if (predicate(value)) return value; await delay(25) } throw new Error('等待状态超时') }
// 配置应只新增源码，不被临时开关写回。
const originalConfig = await readFile(new URL('../cordis.web.patch.yml', import.meta.url), 'utf8')
// 先用无网络的模拟适配器验证所有核心服务可以真正停用并恢复。
const app = await start(true)
// 无论任一断言成功或失败，都在 finally 中关闭真实测试进程。
try {
  // 根 include 与子插件关系来自真实 Loader，不依赖前端按冒号拆分。
  const initial = (await api(app.origin, '/api/plugins')).value.entries
  // 根配置容器本身也必须可见，不能在列表过滤时丢掉。
  assert.ok(initial.some(entry => entry.id === 'include' && entry.parentId === null && entry.container && !entry.switchable))
  // 当前最小组合的业务条目都属于根 include。
  assert.ok(initial.filter(entry => entry.id !== 'include').every(entry => entry.parentId === 'include'))
  // 依赖快照必须来源于实际服务，不把同级配置条目当成没有关系。
  const graph = (await api(app.origin, '/api/plugins')).value.dependencies
  const node = key => graph.nodes.find(item => item.entryId === initial.find(entry => entry.key === key).id)
  const skillEdges = graph.edges.filter(edge => edge.consumerId === node('tool-skill').id)
  assert.deepEqual(skillEdges.map(edge => edge.service).sort(), ['agents', 'skills', 'tools', 'workingDirectory'])
  assert.equal(skillEdges.find(edge => edge.service === 'tools').providerId, node('tools').id)
  assert.ok(skillEdges.every(edge => edge.status === 'provided' && edge.bound))
  assert.ok(graph.edges.some(edge => edge.consumerId === node('minimal-web').id && edge.origin === 'dynamic' && edge.service === 'skills'))
  assert.equal(node('deepseek-api-key').declarationsKnown, false)
  assert.ok(graph.nodes.some(item => item.kind === 'runtime' && item.provides.includes('loader')))

  // 即使直接调用接口也不能关闭根容器，让控制页面失去恢复能力。
  assert.equal((await api(app.origin, '/api/plugins/toggle', { id: 'include', enabled: false })).status, 403)
  // 两轮消息产生真实模型请求与完整事件记录。
  const id = await session(app.origin)
  // 每次都取实际 SSE，再读取服务端持久于内存的详情。
  const first = frames(await (await send(app.origin, id, '调试历史首轮')).text())
  // 调试事件不替代原有 done/delta 业务协议。
  assert.equal(first.at(-1).type, 'done')
  // 新事件明确告诉浏览器本轮 ID。
  const runId = first.find(frame => frame.type === 'run').data.id
  // 完整事件按 seq 连续推送，不丢首个记录。
  const pushed = first.filter(frame => frame.type === 'trace').map(frame => frame.data.event)
  // 没有隐式采样或只显示文字的过滤。
  assert.deepEqual(pushed.map(event => event.seq), pushed.map((_event, index) => index))
  // 服务端快照应包含相同的完整事件数量。
  const run = (await api(app.origin, '/api/runs/' + runId)).value
  // 核对结算、请求、标准分片和会话步骤都有真实数据。
  assert.equal(run.status, 'completed')
  // 请求包含完整模型历史，不能只记录用户输入摘要。
  assert.ok(run.events.some(event => event.kind === 'llm/request' && event.data.request.messages.some(message => message.role === 'system')))
  // 结束原因分片不能被聊天页面的文本过滤丢掉。
  assert.ok(run.events.some(event => event.kind === 'llm/chunk' && event.data.chunk.type === 'finish'))
  // 时间线必须有实际 Agent 步骤而不只是几个前端动画状态。
  assert.ok(run.events.some(event => event.kind === 'session/step/start'))
  // 所有实时记录也应在完整详情中可补读。
  assert.equal(run.events.length, pushed.length)
  // 七个核心服务逐项停用和恢复，验证真实依赖链而不是只切按钮。
  for (const key of ['tools', 'system-prompt', 'session-projection', 'session', 'agent', 'agent-loop', 'llm', 'offline-provider']) {
    // 使用 Loader 返回的完整 ID，其中可能带 include 前缀。
    const state = (await api(app.origin, '/api/plugins')).value
    // 用原配置 ID 辨认目标，再用其完整 ID 操作。
    const plugin = state.entries.find(entry => entry.key === key)
    // 停止动作完成后才返回，状态不能继续谎称 active。
    const stopped = await api(app.origin, '/api/plugins/toggle', { id: plugin.id, enabled: false })
    // 控制接口应仍可用，而不是把整个 Web 插件依赖卸载掉。
    assert.equal(stopped.status, 200, JSON.stringify(stopped.value))
    // 模型不可用时新建会话必须明确拒绝。
    assert.equal(stopped.value.modelReady, false)
    if (key === 'tools') {
      const dependencies = stopped.value.dependencies
      const missing = dependencies.edges.find(edge => edge.consumerId === 'entry:include:tool-skill' && edge.service === 'tools')
      assert.equal(missing.status, 'missing')
      assert.equal(missing.providerId, null)
      assert.equal(missing.lastProviderId, 'entry:include:tools')
      assert.ok(dependencies.nodes.find(node => node.id === 'entry:include:tools').previouslyProvided.includes('tools'))
      // 该模块曾经实际导入过；停用后仍能读取其静态声明，不能误记为没有依赖。
      const stoppedTool = await api(app.origin, '/api/plugins/toggle', { id: 'include:tool-skill', enabled: false })
      assert.ok(stoppedTool.value.dependencies.edges.some(edge => edge.consumerId === 'entry:include:tool-skill' && edge.origin === 'declaration' && edge.service === 'tools' && edge.status === 'missing'))
      await api(app.origin, '/api/plugins/toggle', { id: 'include:tool-skill', enabled: true })
    }

    // HTTP 服务仍在线，返回的是明确 503 而非连接失败。
    assert.equal((await api(app.origin, '/api/sessions', {})).status, 503)
    // 已有的过程记录独立于失效 Agent，仍可查看和下载。
    assert.equal((await api(app.origin, '/api/runs/' + runId)).status, 200)
    // 恢复目标并等待依赖自动激活。
    const resumed = await api(app.origin, '/api/plugins/toggle', { id: plugin.id, enabled: true })
    // 模拟提供方也应随 llm 恢复重新注册。
    assert.equal(resumed.value.modelReady, true, JSON.stringify(resumed.value))
    if (key === 'tools') assert.equal(resumed.value.dependencies.edges.find(edge => edge.consumerId === 'entry:include:tool-skill' && edge.service === 'tools').status, 'provided')

  // 结束核心服务遍历。
  }
  // HTTP 控制入口属于只读基础设施，不能让页面自我卸载。
  const protectedRow = (await api(app.origin, '/api/plugins')).value.entries.find(entry => entry.key === 'webserver')
  // 即使绕开禁用按钮直接调用 API，也要拒绝操作。
  assert.equal((await api(app.origin, '/api/plugins/toggle', { id: protectedRow.id, enabled: false })).status, 403)
  // 恢复后能真正聊天，不只是在列表中显示 active。
  const recovered = frames(await (await send(app.origin, await session(app.origin), '恢复之后')).text())
  // 证明旧 LLM 注册表没有导致模拟适配器失效。
  assert.equal(recovered.at(-1).type, 'done')
  // 完整模型事件与控制平面验证完成。
  console.log('核心插件逐项启停、依赖恢复、实际聊天与完整调试事件通过。')
// 始终关闭测试进程。
} finally { await app.stop() }

// 构造包含 Group 和嵌套 Include 的独立 profile，验证真正的多层配置归属。
const treeHome = await mkdtemp(join(tmpdir(), 'dsh-demo-tree-'))
// 测试结束后连同 profile、配置文件一起清理，不影响默认 .dsh。
try {
  // 官方 CLI 需要一个明确的空 bundle profile，避免继承其他组件。
  const profile = join(treeHome, 'profiles/minimal-chat')
  // 创建这次测试独有的 profile 路径。
  await mkdir(profile, { recursive: true })
  // 与产品启动器相同的最小 profile 清单。
  await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'tree-fixture', private: true, dependencies: {}, dsh: { profile: { bundles: [] } } }))
  // 嵌套 Include 读取自己的配置文件，形成第二棵真实 EntryTree。
  const nested = join(treeHome, 'nested.yml')
  // 使用停用的模型条目避免注册重复服务；同名容器用于验证只读权限。
  await writeFile(nested, JSON.stringify([{ id: 'nested-leaf', name: '@deepseek-ai/dsh-llm', disabled: true }, { id: 'agent', name: 'cordis:group', group: true, config: [] }]))
  // 额外 patch 只在这次进程中加载，不写进教学 YAML。
  const patch = join(treeHome, 'tree.patch.yml')
  // Group 与其孩子共享 EntryTree，因此孩子完整 ID 不包含 group 名称。
  await writeFile(patch, JSON.stringify([{ insert: [{ id: 'tree-group', name: 'cordis:group', group: true, config: [{ id: 'group-leaf', name: '@deepseek-ai/dsh-llm', disabled: true }, { id: 'tree-nested', name: 'cordis:include', config: { path: pathToFileURL(nested).href } }] }] }]))
  // 两个隔离作用域注册同名服务，另加动态 inject；服务值中的标记不得出现在只读快照。
  const dependencyFixture = join(treeHome, 'dependency-fixture.mjs')
  await writeFile(dependencyFixture, `
    export const name = 'dependency-fixture'
    export function apply(ctx) {
      for (const label of ['left', 'right']) {
        const scope = ctx.isolate('fixtureShared')
        const provider = { name: 'provider-' + label, apply(inner) { inner.provide('fixtureShared', { secret: 'DO_NOT_EXPOSE_SERVICE_VALUE' }) } }
        const consumer = { name: 'consumer-' + label, inject: ['fixtureShared'], apply() {} }
        scope.plugin(provider)
        scope.plugin(consumer)
      }
      ctx.inject(['fixtureMissing'], () => {})
    }
  `)
  const extra = JSON.parse(await readFile(patch, 'utf8'))
  extra[0].insert.push({ id: 'dependency-fixture', name: pathToFileURL(dependencyFixture).href })
  await writeFile(patch, JSON.stringify(extra))
  // 使用真实官方 CLI 启动同一套 Web，额外叠加上面的层级夹具。
  const treeApp = await start(true, {}, { home: treeHome, patch })
  // 应用进程总在临时目录移除前有序关闭。
  try {
    // 读取与浏览器相同的 API，不用手工构造条目对象替代 Loader。
    const entries = (await api(treeApp.origin, '/api/plugins')).value.entries
    // 查找完整 ID；找不到时断言会明确指出缺失条目。
    const get = id => { const entry = entries.find(entry => entry.id === id); assert.ok(entry, id); return entry }
    // 分组必须作为节点保留，而不是被旧的 group 过滤规则删除。
    assert.equal(get('include:tree-group').container, true)
    // 这个真实关系与完整 ID 的字符串前缀不同，是树形展示的关键边界。
    assert.equal(get('include:group-leaf').parentId, 'include:tree-group')
    // 嵌套 Include 本身也属于该 Group。
    assert.equal(get('include:tree-nested').parentId, 'include:tree-group')
    // 内层树的叶节点归属嵌套 Include，而不是最外层 include。
    assert.equal(get('include:tree-nested:nested-leaf').parentId, 'include:tree-nested')
    // 即使容器使用了允许切换的短 ID，仍然保持只读。
    assert.equal(get('include:tree-nested:agent').switchable, false)
    // 接口也必须拒绝绕过页面发起的容器关闭请求。
    assert.equal((await api(treeApp.origin, '/api/plugins/toggle', { id: 'include:tree-nested:agent', enabled: false })).status, 403)
    const dependencies = (await api(treeApp.origin, '/api/plugins')).value.dependencies
    const fixtureId = 'entry:include:dependency-fixture'
    const isolated = dependencies.edges.filter(edge => edge.consumerId === fixtureId && edge.service === 'fixtureShared')
    assert.equal(isolated.length, 2, JSON.stringify({ fixture: dependencies.nodes.find(node => node.id === fixtureId), edges: dependencies.edges.filter(edge => edge.service.startsWith('fixture')), nodes: dependencies.nodes.filter(node => node.name.includes('consumer') || node.name.includes('provider')) }))
    assert.ok(isolated.every(edge => edge.bound && edge.status === 'provided' && edge.origin === 'dynamic'))
    assert.notEqual(isolated[0].scope, isolated[1].scope)
    assert.equal(dependencies.edges.find(edge => edge.service === 'fixtureMissing').status, 'missing')
    assert.ok(dependencies.nodes.find(node => node.id === fixtureId).provides.includes('fixtureShared'))
    assert.ok(!JSON.stringify(dependencies).includes('DO_NOT_EXPOSE_SERVICE_VALUE'))
    assert.equal(dependencies.nodes.find(node => node.entryId === 'include:group-leaf').declarationsKnown, false)
    console.log('实际 inject、动态子作用域、缺失/恢复、停用模块声明、作用域隔离与服务值不外泄通过。')
    // 所有关系都由实际组合证明后再报告通过。
    console.log('插件树根容器、真实 Group/Include 多层归属与容器只读权限通过。')
  // 无论断言是否成功都关闭夹具进程。
  } finally { await treeApp.stop() }
// 最后删除只由本次测试创建的临时目录。
} finally { await rm(treeHome, { recursive: true, force: true }) }

// 本机夹具构造真实 Messages SSE，包括框架可能忽略的供应方字段。
let lastBody = '', lastWire = '', slowStarted = false
// 只使用合成密钥，检查它不会被调试信息导出。
const fixtureKey = 'sk-' + 'x'.repeat(32)
// 模型 HTTP 服务仅供此测试，绝不访问外部模型。
const provider = createServer(async (req, res) => {
  // 收集本次 POST 正文，稍后与捕获到的 HTTP 请求原文比较。
  const chunks = []
  // 从真实 Node HTTP 连接读取字节，走完整适配器 fetch 路径。
  for await (const chunk of req) chunks.push(chunk)
  // 原始 JSON 文本保持不变，用于精确比较。
  lastBody = Buffer.concat(chunks).toString('utf8')
  // 非 2xx 的 HTTP 正文也属于原始模型响应，不能只保留转换后的错误摘要。
  if (lastBody.includes('ERROR_BODY')) {
    // 保留标准错误和额外供应方字段，验证失败响应仍被完整捕获。
    lastWire = JSON.stringify({ error: { type: 'api_error', message: 'fixture failure' }, extra: 'RAW_ERROR_' + 'e'.repeat(5000) })
    // 此分支不使用 SSE，以覆盖适配器 response.text() 的读取路径。
    res.writeHead(500, { 'Content-Type': 'application/json' })
    // 原样发送整份 JSON，并结束本机夹具响应。
    res.end(lastWire)
    // 不继续生成正常回复事件。
    return
  // 结束错误响应分支。
  }
  // SLOW 请求用于验证并发、取消和插件卸载中的模型调用。
  const slow = lastBody.includes('SLOW')
  // 一个协议事件可能包含标准转换不会保留的任意供应方扩展字段。
  const data = [
    // 模型开始与累积输入用量。
    { type: 'message_start', message: { usage: { input_tokens: 12, output_tokens: 0 } }, opaque: 'RAW_ONLY_' + 'z'.repeat(5000) },
    // 模型接口显式返回的思考文本，不是由调试 UI 补造。
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
    // 标准 reasoning 分片也必须完整保留。
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '夹具返回的思考文本' } },
    // 思考签名通常只留在原生数据与 replayState 中。
    { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'fixture-signature' } },
    // 关闭思考块，再开启正文块。
    { type: 'content_block_stop', index: 0 },
    // 正文最初为空，由增量补齐。
    { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
    // 用中文测试跨 UTF-8 字节边界的解码。
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '中文响应原文完整保留。' } },
    // 块结束与标准终止原因。
    { type: 'content_block_stop', index: 1 },
    // 用量在原生与标准化层都应该可观察。
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 8 } },
    // 正常模型消息结束。
    { type: 'message_stop' },
  // 结束协议数组。
  ]
  // 直接生成传输文本，调试器应保留完全相同的原文与字节。
  lastWire = data.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('')
  // Cookie 用于确认调试器不会导出认证类响应头。
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'request-id': 'fixture-request', 'Set-Cookie': 'never-export-cookie=1' })
  // 在中文字符的第一字节后切开响应，确保流解码而非逐块独立解码。
  const bytes = Buffer.from(lastWire), split = bytes.indexOf(Buffer.from('中文')) + 1
  // 先发部分正文，再延迟剩余部分。
  res.write(bytes.subarray(0, split))
  // 向测试报告模型网络已经开始，而不是只看到网页 SSE 头。
  if (slow) slowStarted = true
  // 慢请求可被停用插件或浏览器取消，其余请求只短暂分块。
  await delay(slow ? 1000 : 20)
  // 如果客户端取消，不再写入已经关闭的响应。
  if (!res.destroyed) res.end(bytes.subarray(split))
// 结束夹具 HTTP 服务。
})
// 随机本机端口避免与 demo 和其他测试冲突。
await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve))
// 真实适配器只连接上面的本机夹具。
const real = await start(false, { DEEPSEEK_API_KEY: fixtureKey, DEEPSEEK_BASE_URL: `http://127.0.0.1:${provider.address().port}` })
// 原始响应与取消测试共同拥有这份本机应用，结束后必须释放两个监听服务。
try {
  // 使用真实适配器与实际 HTTP 网络流，而不是模拟器伪造调试事件。
  const id = await session(real.origin)
  // 等待本次生成完整结束，再取得调试记录 ID。
  const stream = frames(await (await send(real.origin, id, '验证原始响应')).text())
  // 模型回复应成功完成。
  assert.equal(stream.at(-1).type, 'done', JSON.stringify(stream.at(-1)))
  // 从服务端读取完整记录，测试不依赖浏览器本地缓存。
  const run = (await api(real.origin, '/api/runs/' + stream.find(frame => frame.type === 'run').data.id)).value
  // HTTP 原文中的未知字段不能因标准转换而丢失。
  const raw = run.events.filter(event => event.kind === 'http/chunk' || event.kind === 'http/tail').map(event => event.data.text).join('')
  // 确认没有长度截断、换行修改或中文替换字符。
  assert.equal(raw, lastWire)
  // 原始二进制块也可完全还原，便于核对解码显示。
  assert.deepEqual(Buffer.concat(run.events.filter(event => event.kind === 'http/chunk').map(event => Buffer.from(event.data.base64, 'base64'))), Buffer.from(lastWire))
  // 适配器实际序列化的请求也应精确保存。
  assert.equal(run.events.find(event => event.kind === 'http/request').data.body, lastBody)
  // 必须验证真正发出的 Messages 请求，避免只修改了展示目录却仍被旧输出预算截断。
  assert.equal(JSON.parse(lastBody).max_tokens, 393216)
  assert.equal(run.events.find(event => event.kind === 'llm/request').data.request.maxTokens, 393216)
  assert.equal(run.events.find(event => event.kind === 'session/request/context').data.data.contextWindow, 1048576)
  // 标准化思考、用量、结束元数据不能被只保留正文的过滤丢掉。
  assert.ok(run.events.some(event => event.kind === 'llm/chunk' && event.data.chunk.type === 'reasoning-delta'))
  // 用量是单独的模型事件，并非 UI 估计值。
  assert.ok(run.events.some(event => event.kind === 'llm/chunk' && event.data.chunk.type === 'usage' && event.data.chunk.usage.outputTokens === 8))
  // 认证数据不会混进原始内容导出。
  assert.equal(JSON.stringify(run).includes(fixtureKey), false)
  // 只导出允许的定位头，不包含 Set-Cookie。
  assert.equal(JSON.stringify(run).includes('never-export-cookie'), false)
  // 用单独会话触发 HTTP 错误，避免该提示词进入后面的正常测试历史。
  const failedStream = frames(await (await send(real.origin, await session(real.origin), 'ERROR_BODY 原文')).text())
  // HTTP 失败仍通过网页 SSE 的 error 结算，不会误发 done。
  assert.equal(failedStream.at(-1).type, 'error')
  // 完整调试记录应保留真实 500 状态和未截断的错误正文。
  const failedRun = (await api(real.origin, '/api/runs/' + failedStream.find(frame => frame.type === 'run').data.id)).value
  // 标准运行结果必须是 error，而不是仅看网页连接是否关闭。
  assert.equal(failedRun.status, 'error')
  // 模型错误的真实 HTTP 状态可用于排查提供方问题。
  assert.equal(failedRun.events.find(event => event.kind === 'http/response').data.status, 500)
  // 未知扩展字段不能因转换成 LlmError 而丢失。
  assert.equal(failedRun.events.filter(event => event.kind === 'http/chunk' || event.kind === 'http/tail').map(event => event.data.text).join(''), lastWire)
  // 另开慢会话，验证浏览器取消与停用插件是两个可观察的路径。
  slowStarted = false
  // 请求信号只控制本次网页读取，不直接伪造服务端 Agent 状态。
  const controller = new AbortController()
  // 页面 SSE 先建流，模型协议夹具随后开始返回正文。
  const disconnect = await send(real.origin, await session(real.origin), 'SLOW 浏览器断连', controller.signal)
  // 提前安装拒绝处理，取消读取不产生未处理的 Promise 异常。
  const reading = disconnect.text().catch(error => error.name)
  // 确认模型真的开始工作后才关闭浏览器连接。
  await until(async () => slowStarted, value => value)
  // 客户端中断 fetch，服务端 close 监听器应取消实际 Agent。
  controller.abort()
  // 等浏览器侧读取结束，而不是等待模拟服务完整发送完毕。
  await reading
  // 从独立详情接口观察持久于内存的取消终态。
  await until(async () => (await api(real.origin, '/api/runs')).value, list => list.some(run => run.prompt === 'SLOW 浏览器断连' && run.status === 'cancelled'))
  // 后续插件卸载测试必须再次确认收到新的慢请求。
  slowStarted = false
  // 启动慢模型调用，准备验证实际依赖卸载会取消它。
  const slow = await send(real.origin, id, 'SLOW 插件卸载')
  // 持续读取响应，避免测试自己引入的背压阻止 Agent 停稳。
  const slowBody = slow.text()
  // 必须等本机模型实际收到请求，而不只是网页接口已经返回 200。
  await until(async () => slowStarted, value => value)
  // 获取本轮中 LLM 的完整 Loader ID。
  const llm = (await api(real.origin, '/api/plugins')).value.entries.find(entry => entry.key === 'llm')
  // 停用模型运行时应取消活动生成，但不能关闭 Web 页面。
  assert.equal((await api(real.origin, '/api/plugins/toggle', { id: llm.id, enabled: false })).status, 200)
  // 本轮结算必须是取消，不能误报成功。
  const stopped = frames(await slowBody)
  // 原始记录继续存在，可检查取消前收到的部分响应。
  const cancelled = (await api(real.origin, '/api/runs/' + stopped.find(frame => frame.type === 'run').data.id)).value
  // 保留真实取消状态。
  assert.equal(cancelled.status, 'cancelled')
  // HTTP 控制平面保持在线，允许恢复模型运行时。
  assert.equal((await api(real.origin, '/api/plugins/toggle', { id: llm.id, enabled: true })).value.modelReady, true)
  // 恢复后再次真实调用本机协议夹具，证明依赖和适配器都已恢复。
  assert.equal(frames(await (await send(real.origin, await session(real.origin), '恢复真实适配器')).text()).at(-1).type, 'done')
  // 手工清理已结束记录，避免进程内存无限保留实验数据。
  assert.equal((await api(real.origin, '/api/runs/clear', {})).status, 204)
  // 清理后摘要列表应为空。
  assert.deepEqual((await api(real.origin, '/api/runs')).value, [])
  // 核对源码 YAML 没有被临时实验改写。
  assert.equal(await readFile(new URL('../cordis.web.patch.yml', import.meta.url), 'utf8'), originalConfig)
  // 原生协议、标准分片和依赖切换验证全部完成。
  console.log('原始 HTTP/错误正文、未知字段、思考/用量、凭据排除、浏览器取消、生成中卸载与恢复通过。')
// 清理两个本机服务；没有使用外部模型 API。
} finally { await real.stop(); provider.closeAllConnections(); await new Promise(resolve => provider.close(resolve)) }
// 只有全部断言通过才报告最终成功。
console.log('调试 smoke 全部通过；只使用离线模拟与本机模型协议夹具。')
