/** 启动真实 profile，用本机 HTTP 验证网页、SSE、多轮历史和会话隔离。 */
// 导入 Node 严格断言工具；预期与实际不符时抛错，让验证进程以失败状态结束。
import assert from 'node:assert/strict'
// 导入异步子进程 API；它让脚本启动真正的 dsh 进程，并观察其输入、输出和退出状态。
import { spawn } from 'node:child_process'
// 持久化测试记录保存在临时目录，避免污染用户会话。
import { mkdtemp, rm } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// 导入 file: URL 到本机文件路径的转换函数，避免直接把 URL 当操作系统路径使用。
import { fileURLToPath } from 'node:url'

// 从当前脚本位置推导 demo 根目录；不依赖用户从哪个目录启动验证命令。
const cwd = fileURLToPath(new URL('../', import.meta.url))

// 为 HTTP 验证启动一个独立应用进程；offline 选择模拟或真实适配器，env 提供本次测试覆盖。
async function start(offline, env = {}) {
  const sessionDirectory = await mkdtemp(join(tmpdir(), 'dsh-web-sessions-'))
  // 用真实 Web 启动命令和随机空闲端口运行；条件展开只在离线时追加开关，避免固定端口冲突。
  const child = spawn(process.execPath, ['scripts/run.mjs', 'web', '--port', '0', ...(offline ? ['--offline'] : [])], {
    // 固定脚本工作目录，并让显式测试环境覆盖继承环境，后面的缺密钥场景会用到它。
    cwd, env: { ...process.env, DSH_DEMO_SESSION_DIR: sessionDirectory, DSH_DEMO_PUBLIC_ORIGIN: '', ...env },
  // 闭合回调函数或对象参数，再闭合外层调用；读到这里才完成这次注册或构造表达式。
  })
  // 立即结束标准输入；Web 服务应继续运行，这也能发现终端入口没有被正确禁用的组合错误。
  child.stdin.end()
  // 分别收集就绪日志和诊断日志；这不是聊天内容持久化。
  let stdout = '', stderr = ''
  // 尽早保存进程关闭结果，确保稍后 stop 等待时不会错过已经发生的 close 事件。
  const closed = new Promise(resolve => child.on('close', (code, signal) => resolve({ code, signal })))
  // 只有收到服务打印的实际地址才继续 HTTP 测试，避免用 sleep 猜测服务何时就绪。
  const origin = await new Promise((resolve, reject) => {
    // 15 秒未就绪则请求停止进程并报告已有诊断，防止测试无限挂起。
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error(`Web 启动超时：${stderr}`)) }, 15000)
    // 正确解码日志，并在每段新数据后检查是否出现完整就绪地址。
    child.stdout.setEncoding('utf8').on('data', data => {
      // 累积日志，因为一条就绪文字也可能跨多个 data 事件到达。
      stdout += data
      // 用正则抓取实际监听的本机 URL；\d+ 匹配由系统分配的端口数字。
      const match = stdout.match(/dsh demo web: (http:\/\/127\.0\.0\.1:\d+)/)
      // 捕获到地址后撤销启动超时并返回捕获组，不使用整条日志作为 URL。
      if (match) { clearTimeout(timer); resolve(match[1]) }
    // 闭合回调函数或对象参数，再闭合外层调用；读到这里才完成这次注册或构造表达式。
    })
    // 保留启动诊断；就绪失败时可以说明是端口权限、配置还是插件加载问题。
    child.stderr.setEncoding('utf8').on('data', data => { stderr += data })
    // 系统无法启动进程时立即失败，并取消不再需要的计时器。
    child.on('error', error => { clearTimeout(timer); reject(error) })
    // 若应用在就绪前退出，直接报告而不是误以为可以继续发 HTTP 请求；已 resolve 的 Promise 不会被再次改变。
    child.on('close', code => { clearTimeout(timer); reject(new Error(`Web 提前退出 ${code}：${stderr}`)) })
  // 闭合回调函数或对象参数，再闭合外层调用；读到这里才完成这次注册或构造表达式。
  })
  // 把取得的地址和停止方法作为同一个对象返回，让调用方拥有这次测试进程的生命周期。
  return {
    // 返回实际地址供后续请求使用；这是属性简写，不是再次启动服务。
    origin,
    // 提供可等待的清理方法，供每个场景的 finally 调用，防止测试结束后遗留监听端口。
    async stop() {
      // 请求应用有序关闭；官方启动器应停止 Agent、注销插件并关闭 HTTP 监听。
      child.kill('SIGTERM')
      // 如果正常关闭迟迟不结束，则对包装进程设置最后的强制终止上限，避免测试自身永久挂起。
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000)
      // 等待真实退出并要求正常关闭码为 0；无论断言是否通过都撤销强制终止计时器。
      try { assert.equal((await closed).code, 0, stderr) } finally { clearTimeout(timer); await rm(sessionDirectory, { recursive: true, force: true }) }
    // 结束当前对象成员或回调函数，并用逗号分隔后续成员或参数。
    },
  // 闭合当前花括号结构；与上方对应的 { 配对，结束该函数、条件块或类型声明。
  }
// 闭合当前花括号结构；与上方对应的 { 配对，结束该函数、条件块或类型声明。
}

// 统一构造 JSON API 请求；可覆盖方法和请求头，用于测试输入与来源检查。
async function request(origin, path, body, method = 'POST', headers = {}) {
  // 使用 fetch 发本机请求并返回其 Promise；HTTP 非 2xx 不会自动抛错，调用方需检查 status。
  return fetch(origin + path, {
    // 把参数中的方法放入 fetch 选项，默认是 POST，删除会话时显式传 DELETE。
    method,
    // 先设置 JSON 类型再覆盖指定头，允许专门构造 text/plain 或跨源请求测试拒绝逻辑。
    headers: { 'Content-Type': 'application/json', ...headers },
    // 未提供 body 时不发送正文；否则显式编码 JSON，不能直接把 JS 对象当 HTTP 数据发送。
    body: body === undefined ? undefined : JSON.stringify(body),
    // 为单次 HTTP 请求设置 10 秒超时，避免服务错误时网络读取一直悬挂。
    signal: AbortSignal.timeout(10000),
  // 闭合回调函数或对象参数，再闭合外层调用；读到这里才完成这次注册或构造表达式。
  })
// 闭合当前花括号结构；与上方对应的 { 配对，结束该函数、条件块或类型声明。
}

// 创建测试会话并返回 ID，后续多轮测试将重复使用这个 ID。
async function create(origin) {
  // 发送空 JSON 对象请求创建一个 Agent；此动作不要求模型立刻生成内容。
  const response = await request(origin, '/api/sessions', {})
  // 要求返回资源已创建状态，区别于接口存在但创建失败。
  assert.equal(response.status, 201)
  // 读取并返回服务端随机会话 ID，不依赖其具体字符串值。
  return (await response.json()).sessionId
// 闭合当前花括号结构；与上方对应的 { 配对，结束该函数、条件块或类型声明。
}

// 向指定会话发送一轮文字，并将 SSE 转成适合断言的事件数组。
async function chat(origin, sessionId, message) {
  // 使用与浏览器相同的 API 参数提交输入，覆盖真实的请求读取、AgentLoop 和响应路径。
  const response = await request(origin, '/api/chat', { sessionId, message })
  // 建流成功必须为 200；失败时读取正文作为诊断，成功时不消耗正文，以便后续解析 SSE。
  assert.equal(response.status, 200, await (response.status === 200 ? Promise.resolve('') : response.text()))
  // 确认响应协议确实是 SSE，避免把普通 JSON 回复误当流式实现通过。
  assert.match(response.headers.get('content-type'), /text\/event-stream/)
  // 测试可以等流结束再按空行拆帧；真实浏览器 app.js 使用增量缓冲，不能照搬这里的整段读取。
  const events = (await response.text()).trim().split('\n\n').map(block => {
    // 把每条完整事件拆成 event 和 data 两行，这与本 demo 的单行 JSON SSE 协议对应。
    const lines = block.split('\n')
    // 去掉固定前缀并解析数据，得到结构化事件对象供断言使用。
    return { type: lines[0].slice(7), data: JSON.parse(lines[1].slice(6)) }
  // 闭合回调函数或对象参数，再闭合外层调用；读到这里才完成这次注册或构造表达式。
  })
  // 同时返回完整协议事件和合并后的可见文字，既检查流控制也检查对话内容。
  return { events, text: events.filter(event => event.type === 'delta').map(event => event.data.text).join('') }
// 闭合当前花括号结构；与上方对应的 { 配对，结束该函数、条件块或类型声明。
}

// 启动离线 Web 应用；这组测试不需要 API Key，也不会发真实模型请求。
const app = await start(true)
// 开始受保护的执行区；其中抛出的错误会交给后面的 catch，清理操作则由 finally 保证执行。
try {
  // 依次检查浏览器必需的 HTML、JavaScript 和 CSS，避免只有 API 能工作而页面缺资源。
  for (const path of ['/', '/app.js', '/style.css', '/markdown-it.js', '/markdown.js', '/mcp.js', '/chat-turns.js', '/skills.js', '/completion.js', '/dependencies.js', '/plugin-tree-model.js', '/files.js', '/history.js']) {
    // 对当前资源做普通 GET；资源地址使用刚刚取得的随机端口。
    const response = await fetch(app.origin + path)
    // 每份前端资源都必须成功返回，不允许由 404 页面伪装成可用资源。
    assert.equal(response.status, 200)
    // 简单确认资源正文非空且有实际内容；本测试不把具体样式实现写成快照。
    assert.ok((await response.text()).length > 100)
  // 闭合当前花括号结构；与上方对应的 { 配对，结束该函数、条件块或类型声明。
  }
  // 确认 HTTP 只公开白名单资源，而不是把服务端源码目录整个映射到网页。
  assert.equal((await fetch(app.origin + '/src/plugin.ts')).status, 404)
  // 先等 HTTP 响应，再等 JSON 解码；两个 await 对应两个不同的异步步骤。
  const config = await (await fetch(app.origin + '/api/config')).json()
  // 模式接口必须反映本次离线启动配置，防止 UI 状态与实际适配器不一致。
  assert.equal(config.offline, true)
  // 静态资源与模式检查全部通过后，记录这一组验证结果。
  console.log('页面和静态资源通过：HTTP 正常，未暴露源码目录。')

  // 创建第一段对话，用于验证连续两轮历史。
  const first = await create(app.origin)
  // 创建第二个独立 Agent，用于检查不同页面之间不会串历史。
  const second = await create(app.origin)
  // 向第一会话发送首轮消息，模拟器从真实请求中回显首轮历史。
  const turn1 = await chat(app.origin, first, '我叫小明')
  // 要求收到多条文本事件，证明服务端按增量协议输出，而不是只发一个普通最终结果。
  assert.ok(turn1.events.filter(event => event.type === 'delta').length > 1)
  // 最后一条事件必须明确表示成功；连接结束不应替代 done 标记。
  assert.equal(turn1.events.at(-1).type, 'done')
  // 用相同会话 ID 发送第二轮，复用同一 Agent。
  const turn2 = await chat(app.origin, first, '我叫什么名字？')
  // 检查第二次模型请求保留第一轮用户和助手消息，验证上下文累积。
  assert.match(turn2.text, /第 2 轮.*首轮输入：我叫小明；已有回复：1 条/)
  // 第二个会话开始第一轮，其模型历史应与第一会话无关。
  const isolated = await chat(app.origin, second, '另一段对话')
  // 确认第二会话没有继承任何助手回复，且首轮输入为自己的消息。
  assert.match(isolated.text, /第 1 轮.*首轮输入：另一段对话；已有回复：0 条/)
  // 额外确认第一会话的私人文本没有混入第二会话。
  assert.doesNotMatch(isolated.text, /小明/)
  // 说明通过的是传输协议、历史复用与隔离，不是模拟模型的问答理解能力。
  console.log('SSE、多轮上下文和不同页面会话隔离通过。')

  // 空白消息应在进入 Agent 前被拒绝，避免生成无意义轮次。
  assert.equal((await request(app.origin, '/api/chat', { sessionId: first, message: '   ' })).status, 400)
  // 用超出文本上限的请求检查长度校验，413 表示正文内容过长。
  assert.equal((await request(app.origin, '/api/chat', { sessionId: first, message: 'a'.repeat(8001) })).status, 413)
  // 模拟其他网页来源，确认入口拒绝跨源请求；example.invalid 只是头部值，不会被访问。
  assert.equal((await request(app.origin, '/api/chat', { sessionId: first, message: 'x' }, 'POST', { Origin: 'https://example.invalid' })).status, 403)
  // 故意声明错误内容类型，确认接口返回媒体类型不受支持，而不是尝试猜测解析方式。
  assert.equal((await request(app.origin, '/api/chat', {}, 'POST', { 'Content-Type': 'text/plain' })).status, 415)
  // 发送不完整 JSON 文本，专门覆盖 JSON.parse 的异常处理。
  const malformed = await fetch(app.origin + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })
  // 无效 JSON 应成为可读的请求错误，不应令整个进程崩溃。
  assert.equal(malformed.status, 400)
  // 释放第一会话并等待完成；204 表示成功且没有正文。
  assert.equal((await request(app.origin, `/api/sessions/${first}`, undefined, 'DELETE')).status, 204)
  // 删除后的 ID 不得继续发送消息，也不能被静默恢复为另一个空会话。
  assert.equal((await request(app.origin, '/api/chat', { sessionId: first, message: '旧会话' })).status, 404)
  // 释放第二个测试 Agent，让本场景不会依赖进程退出才清理正常使用的会话。
  assert.equal((await request(app.origin, `/api/sessions/${second}`, undefined, 'DELETE')).status, 204)
  // 记录接口边界与会话清理场景的通过结果。
  console.log('输入检查、来源检查和删除会话通过。')
// 无论断言是否失败，都停止本组 Web 进程，释放实际监听的本机端口。
} finally { await app.stop() }

const externalOrigin = 'https://example-codespace-3080.app.github.dev'
const externalHost = new URL(externalOrigin).host
const externalApp = await start(true, { DSH_DEMO_PUBLIC_ORIGIN: externalOrigin + '/' })
// 直接向本机连接发送代理预期保留的 Host，避免 fetch 根据连接地址生成 Host。
function proxyRequest(path, headers, body) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(externalApp.origin + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
    }, res => {
      let text = ''
      res.setEncoding('utf8').on('data', chunk => { text += chunk })
      res.on('end', () => resolve({ status: res.statusCode, text }))
      res.on('error', reject)
    })
    req.setTimeout(10000, () => req.destroy(new Error('外部地址测试超时')))
    req.on('error', reject)
    req.end(body === undefined ? undefined : JSON.stringify(body))
  })
}
try {
  assert.equal((await fetch(externalApp.origin + '/')).status, 200)
  assert.equal((await proxyRequest('/', { Host: externalHost })).status, 200)
  const externalHeaders = { Host: externalHost, Origin: externalOrigin }
  const session = await proxyRequest('/api/sessions', externalHeaders, {})
  assert.equal(session.status, 201)
  const { sessionId } = JSON.parse(session.text)
  const response = await proxyRequest('/api/chat', externalHeaders, { sessionId, message: '转发测试' })
  assert.equal(response.status, 200)
  assert.match(response.text, /event: done/)
  for (const headers of [
    { Host: externalHost, Origin: externalApp.origin },
    { Host: externalHost, Origin: 'https://example.invalid' },
    { Origin: externalOrigin },
    { Host: 'example.invalid', 'X-Forwarded-Host': externalHost, Origin: externalOrigin },
  ]) {
    assert.equal((await proxyRequest('/api/sessions', headers, {})).status, 403)
  }
  console.log('外部访问地址通过：页面、同源对话、拒绝混用地址和伪造转发头。')
} finally { await externalApp.stop() }

// 清空凭据并固定本机无效端点，验证失败传播，不访问真实模型 API。
// 启动真实适配器但明确清空凭据，并限定本机无效端点，专门测试失败传播而不访问外部模型。
const real = await start(false, { DEEPSEEK_API_KEY: '', DEEPSEEK_BASE_URL: 'http://127.0.0.1:1' })
// 开始受保护的执行区；其中抛出的错误会交给后面的 catch，清理操作则由 finally 保证执行。
try {
  // 先创建真实模式的 Agent；创建会话本身不应消耗模型 API。
  const id = await create(real.origin)
  // 尝试一轮需要凭据的生成，预期在流中得到模型错误事件。
  const failure = await chat(real.origin, id, '你好')
  // 失败轮次最后必须是 error，不能因为 HTTP 建流返回 200 就误发 done。
  assert.equal(failure.events.at(-1).type, 'error')
  // 确认流里的失败原因来自缺少凭据，而非不相关的代码错误。
  assert.match(failure.events.at(-1).data.message, /no API key/)
  // 复用失败后的同一会话再次发送，检查 finally 是否正确解除了 busy 锁。
  const again = await chat(real.origin, id, '再试一次')
  // 第二次仍应到达模型错误；若忙碌锁没释放，会在 HTTP 阶段返回 409，使这里之前的断言失败。
  assert.equal(again.events.at(-1).type, 'error')
  // 模型轮次失败后，普通配置请求仍应可用，证明服务没有被整个退出。
  assert.equal((await fetch(real.origin + '/api/config')).status, 200)
  // 综合说明本场景覆盖错误语义、锁释放与 HTTP 服务存活。
  console.log('模型失败通过 SSE 报告；服务保持可用，会话不会卡在忙碌状态。')
// 真实模式失败验证也必须关闭进程，不因断言异常遗留后台服务。
} finally { await real.stop() }
// 全部断言通过后输出完成信息，同时明确测试未验证外部真实模型质量。
console.log('Web smoke 全部通过；未调用真实模型 API。')
