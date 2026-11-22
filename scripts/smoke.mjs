/** 通过真实 dsh profile 验证最小组合、多轮历史和退出行为，不请求模型 API。 */
// 导入 Node 严格断言工具；预期与实际不符时抛错，让验证进程以失败状态结束。
import assert from 'node:assert/strict'
// 导入异步子进程 API；它让脚本启动真正的 dsh 进程，并观察其输入、输出和退出状态。
import { spawn } from 'node:child_process'
// 导入 file: URL 到本机文件路径的转换函数，避免直接把 URL 当操作系统路径使用。
import { fileURLToPath } from 'node:url'

// 从当前脚本位置推导 demo 根目录；不依赖用户从哪个目录启动验证命令。
const cwd = fileURLToPath(new URL('../', import.meta.url))

// 封装一次真实脚本调用；默认参数分别表示无额外选项、空输入和无环境覆盖。
function run(mode, args = [], input = '', options = {}) {
  // 用 Promise 把进程的输出事件和 close 事件变成一个可 await 的验证结果。
  return new Promise((resolve, reject) => {
    // 启动与用户相同的 run.mjs，而不是直接调用内部函数；因此能验证官方 profile 的实际组合。
    const child = spawn(process.execPath, ['scripts/run.mjs', mode, ...args], {
      // 对象属性简写，将工作目录固定到 demo 根目录，避免调用位置影响相对脚本路径。
      cwd,
      // 继承环境后应用本次验证的覆盖值；覆盖项用于明确清空凭据或指定无效的本机端点。
      env: { ...process.env, ...options.env },
    // 闭合回调函数或对象参数，再闭合外层调用；读到这里才完成这次注册或构造表达式。
    })
    // 积累普通输出，稍后断言用户看到的回复和状态文字。
    let stdout = ''
    // 单独收集错误输出；断言失败时可把它作为原因展示。
    let stderr = ''
    // 记录是否已发送测试中断，防止多段日志重复触发 SIGINT。
    let interrupted = false
    // 给整次子进程运行设置上限，避免挂起的进程让验证脚本无限等待。
    const timeout = setTimeout(() => {
      // 超时时先请求有序停止子进程；run.mjs 会把信号继续转发给官方启动器。
      child.kill('SIGTERM')
      // 让验证失败并说明哪个模式没有按时结束，而不是把超时误当成功。
      reject(new Error(`验证超时：${mode} ${args.join(' ')}`))
    // 20 秒是单次验证的等待上限，正常的离线场景应远早于此时间完成。
    }, 20000)
    // 让 Node 的流解码器正确处理跨块 UTF-8 字节，再逐段收集输出，避免中文乱码。
    child.stdout.setEncoding('utf8').on('data', data => {
      // 把本段输出接在之前日志后；事件触发次数和程序打印行数不必相同。
      stdout += data
      // 只有信号测试且应用已进入交互状态时才中断，这样能检查正在等待输入的进程如何清理。
      if (options.interrupt && !interrupted && stdout.includes('每行是一轮对话')) {
        // 先记录已中断，再发信号，确保后续 data 事件不会重复发出中断。
        interrupted = true
        // 模拟用户 Ctrl+C；通过包装脚本转发来验证完整退出链路。
        child.kill('SIGINT')
      // 闭合当前花括号结构；与上方对应的 { 配对，结束该函数、条件块或类型声明。
      }
    // 闭合回调函数或对象参数，再闭合外层调用；读到这里才完成这次注册或构造表达式。
    })
    // 把错误日志解码并累积到 stderr，不与正常回复混在一起。
    child.stderr.setEncoding('utf8').on('data', data => { stderr += data })
    // 应用提前退出时输入管道可能关闭，EPIPE 在参数拒绝等场景是预期现象；其他写入错误仍使测试失败。
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') reject(error) })
    // 无法启动进程时清除计时器并立即拒绝，避免只等 20 秒后才得到模糊超时错误。
    child.on('error', error => { clearTimeout(timeout); reject(error) })
    // 等进程及其输出管道完全关闭后收集结果；close 比 exit 更适合确认日志已读取完。
    child.on('close', (status, signal) => {
      // 进程已结束，撤销超时任务，避免它稍后误报或使验证进程多等一段时间。
      clearTimeout(timeout)
      // 释放输入管道；中断测试没有调用 end，因此这里尤其需要清理。
      child.stdin.destroy()
      // 把退出码、终止信号和两类输出一起交给断言，不单凭出现“通过”文字判断成功。
      resolve({ status, signal, stdout, stderr })
    // 闭合回调函数或对象参数，再闭合外层调用；读到这里才完成这次注册或构造表达式。
    })
    // 普通测试一次性写完文本并发送 EOF；信号测试保持输入打开，以免应用先因 EOF 正常退出。
    if (!options.interrupt) child.stdin.end(input)
  // 闭合回调函数或对象参数，再闭合外层调用；读到这里才完成这次注册或构造表达式。
  })
// 闭合当前花括号结构；与上方对应的 { 配对，结束该函数、条件块或类型声明。
}

// 先通过官方配置打印路径观察真实插件树，而不是只检查 YAML 源文件里有哪些文字。
const tree = await run('config', ['--offline'])
// 要求配置命令成功退出；第三参数把错误输出附到断言失败信息中。
assert.equal(tree.status, 0, tree.stderr)
// 用带全局和多行标记的正则提取顶层插件 ID，再严格比较完整顺序，发现意外混入的额外 bundle。
assert.deepEqual([...tree.stdout.matchAll(/^- id: (.+)$/gm)].map(match => match[1]), [
  // 列出预期七个核心插件；这里是测试预期，不是另一份实际启动注册代码。
  'llm', 'session', 'session-projection', 'system-prompt', 'tools', 'agent', 'agent-loop',
  // 另有真实模型适配器、MCP、官方 Bash 及依赖和终端入口；“七个核心”不表示总条目只有七项。
  'deepseek-api-key', 'mcp-demo', 'fs-local', 'working-directory', 'subprocess-local', 'bash-local', 'shell-env', 'tool-bash', 'minimal-chat',
// 结束数组字面量，并把完整数组交给外层调用。
])
// 组合断言通过后才打印结论；这一项保证 demo 维持最小核心结构。
console.log('最小组合通过：七个核心插件 + MCP + 官方 Bash 及依赖 + 可选模型接入 + 终端入口，无额外 bundle。')

// 第二轮必须在模型请求中看到第一轮的用户消息和 assistant 回复。
// 通过标准输入发送空行和两轮消息；末尾 end 形成 EOF，同时覆盖空行跳过与多轮顺序执行。
const conversation = await run('demo', ['--offline'], '\n我叫小明\n我叫什么名字？\n')
// 整个离线对话必须正常退出，不能只在退出前偶然打印正确回复。
assert.equal(conversation.status, 0, conversation.stderr)
// 检查第一轮模型请求没有先前助手消息，并确实收到第一条用户输入。
assert.match(conversation.stdout, /第 1 轮）收到：我叫小明；首轮输入：我叫小明；已有回复：0 条/)
// 检查第二轮请求保留首轮用户文本及一条助手回复，证明同一个 Agent 的历史被复用。
assert.match(conversation.stdout, /第 2 轮）收到：我叫什么名字？；首轮输入：我叫小明；已有回复：1 条/)
// 恰好应有两轮回复；正则无匹配时用空数组后备，避免 length 访问 null。
assert.equal((conversation.stdout.match(/Agent：/g) ?? []).length, 2)
// 展示去掉两端多余空白的实际对话，方便人工理解验证了什么。
console.log(conversation.stdout.trim())
// 说明这一场景同时验证了历史传递与输入结束后的正常资源释放。
console.log('多轮对话与 EOF 退出通过：第二轮包含首轮输入和首轮回复。')

// 终端与 Web 共用同一官方 Bash 能力，离线别名也必须实际执行。
const bash = await run('demo', ['--offline'], '/bash printf TERMINAL_BASH_OK\n/exit\n')
assert.equal(bash.status, 0, bash.stderr)
assert.match(bash.stdout, /官方工具原始返回[\s\S]*TERMINAL_BASH_OK/)
console.log('终端官方 Bash 调用通过。')

// 在退出命令后继续提供文本，验证应用不会把 /exit 当普通消息或继续消耗后面的业务输入。
const quit = await run('demo', ['--offline'], '你好\n/exit\n不应该处理这一行\n')
// 显式退出属于正常结束，预期状态码为 0。
assert.equal(quit.status, 0, quit.stderr)
// 只允许第一条“你好”产生回复；退出命令本身不应触发模型。
assert.equal((quit.stdout.match(/Agent：/g) ?? []).length, 1)
// 输出中不能出现退出后的文字，避免只计数而漏掉被错误处理的尾部输入。
assert.doesNotMatch(quit.stdout, /不应该处理这一行/)
// 退出语义断言全部通过后记录结果。
console.log('/exit 退出通过：后续输入未被处理。')

// 故意传入未知参数，验证启动脚本会明确拒绝，而不是忽略拼写错误。
const invalid = await run('demo', ['--unknown'])
// 非法参数必须以失败退出码结束，供 shell 或上层自动化识别。
assert.equal(invalid.status, 1)
// 除了退出码，还检查用户收到的是有针对性的参数说明。
assert.match(invalid.stderr, /不支持的参数/)

// 只验证真实适配器能够随 profile 启动；空输入不会触发 API 请求。
// 启动真实适配器但不输入任何消息；EOF 结束程序，因此不触发模型 API 调用。
const realStartup = await run('demo')
// 验证真实模式的组件能成功加载，即使本场景不验证凭据或模型回复。
assert.equal(realStartup.status, 0, realStartup.stderr)
// 检查确实走了真实模式提示，避免误把离线启动当成真实适配器启动成功。
assert.match(realStartup.stdout, /真实模型/)
// 明确测试范围：组件加载与参数检查通过，不宣称已验证网络模型生成。
console.log('真实适配器启动与参数拒绝通过；未调用真实模型。')

// 显式清空凭据并限制到不可用的本地端点，防止继承真实密钥或访问外部 API。
// 在真实模式提交一条消息，专门观察缺少凭据时的错误能否传播到进程退出结果。
const missingKey = await run('demo', [], '你好\n', {
  // 显式覆盖为无密钥和本机不可用端点，避免测试继承用户真实凭据后访问外部模型。
  env: { DEEPSEEK_API_KEY: '', DEEPSEEK_BASE_URL: 'http://127.0.0.1:1' },
// 闭合回调函数或对象参数，再闭合外层调用；读到这里才完成这次注册或构造表达式。
})
// 要求模型失败导致状态码 1；拼接输出只用于失败诊断，不会把“空闲”误认为成功。
assert.equal(missingKey.status, 1, missingKey.stdout + missingKey.stderr)
// 检查失败原因确实是缺少密钥，证明测试没有停在其他不相关的错误上。
assert.match(missingKey.stderr, /no API key/)
// 验证当 whenIdle 已返回时，入口仍会检查事件中的错误并以失败结束。
console.log('模型错误传播通过：缺少密钥时报告错误并以状态码 1 退出。')

// 运行保持输入打开的离线进程，并在它准备读输入后主动发送 SIGINT。
const interrupted = await run('demo', ['--offline'], '', { interrupt: true })
// 130 是本启动链对 Ctrl+C 的预期退出码；检查真实状态而不是仅看终端文字。
assert.equal(interrupted.status, 130, interrupted.stdout + interrupted.stderr)
// 完成对信号转发、Agent 与输入接口清理路径的验证。
console.log('SIGINT 退出通过：启动器收到中断后清理进程。')
// 只有前面的所有断言均未抛错才会打印完成信息；这表示验证通过，不代表测试过真实模型质量。
console.log('离线 smoke 全部通过。')
