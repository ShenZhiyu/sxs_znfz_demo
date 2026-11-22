/** MCP 集成验证：通过真实 Web、AgentLoop 与 stdio 服务验证工具调用和插件生命周期。 */
// 断言失败会以非零退出码结束，不把日志文字当测试成功。
import assert from 'node:assert/strict'
// 启动与用户相同的 Web 命令，确保经过真实 Loader。
import { spawn } from 'node:child_process'
// 持久化测试记录保存在临时目录，避免污染用户会话。
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
async function start(offline, env = {}) {
  const sessionDirectory = await mkdtemp(join(tmpdir(), 'dsh-mcp-sessions-'))
  // 不启动 shell，参数以独立数组成员传给 Node。
  const child = spawn(process.execPath, ['scripts/run.mjs', 'web', '--port', '0', ...(offline ? ['--offline'] : [])], { cwd, env: { ...process.env, DSH_DEMO_SESSION_DIR: sessionDirectory, ...env } })
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
// 一轮调用同时读取实际回复和服务端完整过程记录。
async function chat(origin, sessionId, message) {
  // 发送真实 HTTP 聊天请求，走与网页相同的 SSE 路径。
  const response = await send(origin, sessionId, message)
  // 非成功状态应在解析 SSE 前明确报错。
  assert.equal(response.status, 200, await (response.ok ? Promise.resolve('') : response.text()))
  // 等待完整响应后解析全部协议事件。
  const events = frames(await response.text())
  // 轮次正常结束，工具失败也应转成可读回复，而不是挂起整个 Agent。
  assert.equal(events.at(-1).type, 'done', JSON.stringify(events))
  // run 事件公开本轮记录 ID，可与调试页面使用同一个详情接口。
  const runId = events.find(event => event.type === 'run').data.id
  // 完整请求与工具事件应保存在同一份记录中。
  const run = (await api(origin, '/api/runs/' + runId)).value
  // 返回用户可见文字，供断言精确核对工具输出。
  return { text: events.filter(event => event.type === 'delta').map(event => event.data.text).join(''), run }
// 结束单轮测试工具。
}
// 用实际官方 CLI 启动离线模型；MCP 仍然通过真实子进程协议执行。
const app = await start(true)
// 即使任一断言失败也关闭进程，官方插件负责停止 MCP 子服务。
try {
  // MCP 客户端的激活包含连接和工具发现，不应只是 enabled=true。
  const state = (await api(app.origin, '/api/plugins')).value
  // 保存实际完整 ID，切换 API 不能使用猜测出来的短 ID。
  const plugin = state.entries.find(entry => entry.key === 'mcp-demo')
  // 确认新插件真的激活，且允许用户从网页开关。
  assert.equal(plugin.phase, 'active')
  // 工具桥接属于可切换能力，HTTP 控制入口仍保持独立。
  assert.equal(plugin.switchable, true)
  // 同一个会话测试连续两次计算，防止读取旧轮次的结果。
  const id = await session(app.origin)
  // 模拟模型产生工具请求，独立 MCP 服务计算出真实结果。
  const first = await chat(app.origin, id, '/mcp-add 2 3')
  // 精确回复来自 MCP 服务，而不是模型直接计算。
  assert.equal(first.text, '（离线 MCP 演示）结果：5')
  // 一次网页发送包含工具前和工具后的两次模型请求。
  const requests = first.run.events.filter(event => event.kind === 'llm/request')
  // 缺少第二次模型请求通常说明工具结果没有回到 AgentLoop。
  assert.equal(requests.length, 2)
  // 模型的工具列表必须包含真正发现的 MCP 工具 schema。
  assert.equal(requests[0].data.request.tools.filter(tool => tool.name === 'mcp__demo__add').length, 1)
  // 调用过程必须有实际工具调用事件，不能只显示一段看似成功的文字。
  assert.ok(first.run.events.some(event => event.kind === 'session/tool/call'))
  // 工具结果必须记录到会话并返回模型。
  assert.ok(first.run.events.some(event => event.kind === 'session/tool/result'))
  // 第二次请求确实拿到真实 tool 消息的数字内容。
  assert.ok(requests[1].data.request.messages.some(message => message.role === 'tool' && message.content.some(block => block.type === 'text' && block.text === '5')))
  // 更换数字后不能复用第一轮的 5。
  assert.equal((await chat(app.origin, id, '/mcp-add -2.5 10')).text, '（离线 MCP 演示）结果：7.5')
  // 通用补全入口也必须经过真实 MCP，而不是仅在页面插入一段无法执行的命令。
  const generic = await chat(app.origin, id, '/mcp mcp__demo__add {"a":7,"b":8}')
  assert.match(generic.text, /调用完成/)
  assert.equal(generic.run.events.filter(event => event.kind === 'session/tool/call').length, 1)
  assert.ok(generic.run.events.filter(event => event.kind === 'llm/request')[1].data.request.messages.some(message => message.role === 'tool' && message.content.some(block => block.type === 'text' && block.text === '15')))
  // 无参数工具可以省略 JSON；错误 JSON 和未注册名称不能发起工具执行。
  assert.match((await chat(app.origin, id, '/mcp mcp__demo__cluster_resources')).text, /调用完成/)
  for (const command of ['/mcp', '/mcp mcp__demo__add {broken}', '/mcp mcp__demo__add null', '/mcp mcp__demo__add []', '/mcp skill_read {}', '/mcp mcp__missing__tool {}']) {
    const invalid = await chat(app.origin, id, command)
    assert.equal(invalid.run.events.filter(event => event.kind === 'session/tool/call').length, 0, command)
    assert.match(invalid.text, /用法|JSON|不可用/)
  }
  // 参数字段不合 schema 时仍应通过真实工具返回错误，Agent 不挂起或伪称成功。
  assert.match((await chat(app.origin, id, '/mcp mcp__demo__add {"a":"bad","b":3}')).text, /调用失败/)
  // 服务端的 isError 要传回 Agent，有限输入的加法溢出不能伪装成功。
  assert.match((await chat(app.origin, id, '/mcp-add 1e308 1e308')).text, /工具失败.*超出有限数字范围/)
  // 停用条目应断开 MCP 并注销工具；普通聊天核心继续可用。
  const stopped = await api(app.origin, '/api/plugins/toggle', { id: plugin.id, enabled: false })
  // 控制操作完成后 HTTP 和模型路由仍可用。
  assert.equal(stopped.status, 200)
  // MCP 是附加能力，不计入七核心就绪条件。
  assert.equal(stopped.value.modelReady, true)
  // 开关会释放旧会话，按产品规则创建新会话后继续测试。
  const without = await chat(app.origin, await session(app.origin), '/mcp-add 2 3')
  // 离线模型需要明确报告工具不存在。
  assert.match(without.text, /尚未就绪/)
  assert.match((await chat(app.origin, await session(app.origin), '/mcp mcp__demo__add {"a":2,"b":3}')).text, /不可用/)
  // 工具已经从实际模型工具列表移除，不只是按钮变成了停用。
  assert.ok(without.run.events.filter(event => event.kind === 'llm/request').every(event => !event.data.request.tools?.some(tool => tool.name === 'mcp__demo__add')))
  // 普通文字聊天应继续成功。
  assert.match((await chat(app.origin, await session(app.origin), '普通聊天')).text, /收到：普通聊天/)
  // 启用会重新创建服务连接并发现工具，不依赖进程重启。
  const resumed = await api(app.origin, '/api/plugins/toggle', { id: plugin.id, enabled: true })
  // 真正 active 才表示重新连接完成。
  assert.equal(resumed.value.entries.find(entry => entry.key === 'mcp-demo').phase, 'active')
  // 恢复后再次经过工具请求，且不会因遗留命名空间重复注册失败。
  assert.equal((await chat(app.origin, await session(app.origin), '/mcp-add 12 30')).text, '（离线 MCP 演示）结果：42')
  // 全部断言通过才打印结论。
  console.log('MCP 工具发现、真实 stdio 调用、多轮结果、错误传播及网页停用/恢复通过。')
// 测试结束后有序关闭应用及其 MCP 子服务。
} finally { await app.stop() }
