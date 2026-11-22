/** 使用项目内的框架源码与依赖，通过官方 dsh 启动器加载最小 profile。 */
// 从 Node 文件系统模块导入存在检查、目录创建和文件写入函数；这些操作只准备本地 profile。
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
// 导入异步子进程 API；它让脚本启动真正的 dsh 进程，并观察其输入、输出和退出状态。
import { spawn } from 'node:child_process'
// 导入跨平台路径拼接与绝对化函数；不要用手写斜杠假设所有系统的路径规则一样。
import { resolve } from 'node:path'
// 导入 file: URL 到本机文件路径的转换函数，避免直接把 URL 当操作系统路径使用。
import { fileURLToPath } from 'node:url'

// 以当前脚本所在位置计算 demo 根目录；import.meta.url 指向 run.mjs 自身，不是终端所在目录。
const demoRoot = fileURLToPath(new URL('../', import.meta.url))
// Agent 与网页文件传输共用工作目录；相对环境配置始终以项目根目录解析。
const workDir = resolve(demoRoot, process.env.DSH_DEMO_WORK_DIR || 'work')
// 定位已经复制到项目内的框架源码；移动整个 demo 目录后仍能找到它。
const harness = resolve(demoRoot, 'vendor/harness')
// 读取模式参数；argv[0] 是 Node 路径，[1] 是脚本路径，[2] 才是 demo、web 等自定义参数。
const mode = process.argv[2]
// 从模式之后取出额外参数形成新数组，例如 --offline 或 --port 3081。
const extra = process.argv.slice(3)
// 判断是否显式要求离线模式；includes 返回布尔值，不会修改原数组。
const offline = extra.includes('--offline')
// 把已处理的离线开关从待检查参数中剔除；filter 创建新数组，剩余项稍后验证。
const args = extra.filter(arg => arg !== '--offline')
// 优先读取环境端口，否则用字符串 3080；?? 只对 null/undefined 使用后备值，不把空字符串当缺失。
let port = process.env.DSH_DEMO_PORT ?? '3080'
// 寻找端口选项在数组中的位置；没找到返回 -1，因此不能直接把它当真假值判断。
const portIndex = args.indexOf('--port')
// 仅 Web 启动和 Web 配置模式接受 --port；终端模式收到它会在后面被拒绝。
if (portIndex !== -1 && ['web', 'config-web'].includes(mode)) {
  // 端口值位于 --port 后一项；若调用者漏写值，这里得到 undefined。
  const value = args[portIndex + 1]
  // 要求值存在、只含数字且不超过端口最大值；短路求值保证 undefined 不会进入后续转换。
  if (value === undefined || !/^\d+$/.test(value) || Number(value) > 65535) {
    // 向标准错误输出参数说明；与正常业务输出分开，调用脚本能独立收集。
    console.error('--port 需要 0 到 65535 之间的整数。')
    // 参数或前置依赖不合法时立即以状态码 1 结束启动脚本；此时尚未启动应用子进程。
    process.exit(1)
  // 闭合当前花括号结构；与上方对应的 { 配对，结束该函数、条件块或类型声明。
  }
  // 用显式命令行端口覆盖环境变量，保持“本次调用优先”的直观规则。
  port = value
  // 原地移除 --port 及其值；已识别参数不应在未知参数检查中再次被拒绝。
  args.splice(portIndex, 2)
// 闭合当前花括号结构；与上方对应的 { 配对，结束该函数、条件块或类型声明。
}
// 定位基础插件组合文件，其中逐项声明七个核心插件、模型适配器和终端入口。
const patch = resolve(demoRoot, 'cordis.patch.yml')
// 准备 Node 的 TS 加载钩子参数；tsx 执行源码，不等于已经运行完整 TypeScript 类型检查。
const sourceLaunch = ['--import', 'tsx/esm']
// 使用项目内保存的官方 CLI 源码；仍由它完成 profile 组合、就绪通知和有序退出。
const cli = resolve(harness, 'apps/cli/src/bin.ts')
// 把本 demo 的运行数据隔离到自身目录；不会把 profile 写进用户默认 Harness home。
const home = resolve(demoRoot, '.dsh')
// 定位要初始化的独立 profile；profile 是插件组合与依赖解析的本地载体。
const profileDir = resolve(home, 'profiles/minimal-chat')
// 用数组展开组合基础启动参数；每项独立传给 spawn，不依赖 shell 拆词或命令字符串拼接。
const launch = [...sourceLaunch, cli, '--profile', 'minimal-chat', '--patch', patch]
// 在基础组合后叠加 Web overlay；后者禁用终端入口并加入 HTTP 服务和网页入口。
const webLaunch = [...launch, '--patch', resolve(demoRoot, 'cordis.web.patch.yml')]
// 建立模式到 Node 参数数组的映射；npm 命令只负责选择其中一项。
const commands = {
  // 终端模式使用基础启动组合，保留真实或离线模型的选择。
  demo: launch,
  // Web 模式追加网页 overlay；此时不启动终端读取循环。
  web: webLaunch,
  // 配置模式请求官方 CLI 打印组合树后退出，不启动模型会话。
  config: [...launch, '--dump-config'],
  // 带连字符的属性名须写成字符串；此模式打印包含 Web 入口的最终组合。
  'config-web': [...webLaunch, '--dump-config'],
  // 运行本项目安装的 tsc，检查教学入口的类型；框架源码另由 npm run build 检查。
  typecheck: ['node_modules/typescript/bin/tsc', '--project', resolve(demoRoot, 'tsconfig.json')],
// 闭合当前花括号结构；与上方对应的 { 配对，结束该函数、条件块或类型声明。
}

// 只允许映射自身定义的模式，避免误用对象原型上的属性或未知命令。
if (!Object.hasOwn(commands, mode)) {
  // 打印脚本支持的模式和参数；Web 以外模式仍会单独拒绝端口选项。
  console.error('用法：node scripts/run.mjs <demo|web|config|config-web|typecheck> [--offline] [--port 3080]')
  // 参数或前置依赖不合法时立即以状态码 1 结束启动脚本；此时尚未启动应用子进程。
  process.exit(1)
// 闭合当前花括号结构；与上方对应的 { 配对，结束该函数、条件块或类型声明。
}
// 所有已知参数都已移除，若数组仍非空说明调用含未知内容，应明确报错而非悄悄忽略。
if (args.length > 0) {
  // 把剩余参数用空格连成可读提示；模板字符串只用于显示，不把它交给 shell 执行。
  console.error(`不支持的参数：${args.join(' ')}。可用参数：--offline；Web 模式另支持 --port。`)
  // 参数或前置依赖不合法时立即以状态码 1 结束启动脚本；此时尚未启动应用子进程。
  process.exit(1)
// 闭合当前花括号结构；与上方对应的 { 配对，结束该函数、条件块或类型声明。
}
// 先检查本项目的运行依赖；npm install 会链接内部包并自动生成类型声明。
if (!existsSync(resolve(demoRoot, 'node_modules/tsx/package.json'))) {
  // 恢复步骤只涉及本目录，不再要求安装或构建相邻仓库。
  console.error('请先在 dsh-demo 目录执行 npm install；已有锁文件时可用 npm ci。')
  // 参数或前置依赖不合法时立即以状态码 1 结束启动脚本；此时尚未启动应用子进程。
  process.exit(1)
// 闭合当前花括号结构；与上方对应的 { 配对，结束该函数、条件块或类型声明。
}

// 空 bundle 列表：不继承 web、base 或 sdk-minimal 的额外组件。
// 纯类型检查不需要生成运行 profile；其他模式交给官方 CLI 前先准备 profile 元数据。
if (mode !== 'typecheck') {
  // 在官方工作目录服务校验路径前创建目录，终端模式也可直接使用。
  mkdirSync(workDir, { recursive: true })
  // 递归创建 profile 目录，已存在时不报错；不会删除用户已有的数据。
  mkdirSync(profileDir, { recursive: true })
  // 生成这个 profile 自己的 package.json 路径，与 demo 根目录的 npm 脚本清单不是同一个文件。
  const manifest = resolve(profileDir, 'package.json')
  // 只在首次运行时创建 profile 清单，不每次覆盖用户对已有 profile 的修改。
  if (!existsSync(manifest)) {
    // 把下面的对象序列化为标准 JSON 并写入本地 profile；JSON 本身不支持注释。
    writeFileSync(manifest, JSON.stringify({
      // 为生成的 profile 提供一个本地包名，便于依赖工具和启动器识别。
      name: 'dsh-demo-minimal-chat',
      // 标记生成的 profile 为私有，防止意外按公共 npm 包发布。
      private: true,
      // 初始 profile 不额外安装依赖；官方启动器从项目内 CLI 的依赖图解析框架包。
      dependencies: {},
      // 显式使用空 bundle 列表；因此不会偷偷继承 base 或完整 Web 的额外组件。
      dsh: { profile: { bundles: [] } },
    // JSON.stringify 的第三参数 2 生成两空格缩进；末尾补换行，让生成文件方便阅读。
    }, null, 2) + '\n')
  // 闭合当前花括号结构；与上方对应的 { 配对，结束该函数、条件块或类型声明。
  }
// 闭合当前花括号结构；与上方对应的 { 配对，结束该函数、条件块或类型声明。
}

// 用当前 Node 可执行文件启动对应命令；spawn 直接传参数数组，默认不启动 shell。
const child = spawn(process.execPath, commands[mode], {
  // 服务进程保留项目根目录以加载配置和 MCP；Agent 的执行目录由 working-directory 单独配置。
  cwd: demoRoot,
  // 子进程继承当前终端或管道的输入输出；这样键盘输入能到应用，日志也能直接显示。
  stdio: 'inherit',
  // 为子进程构造环境变量对象；这些配置只传给该子进程，而不是修改系统全局环境。
  env: {
    // 先继承调用者环境，包括可用模型凭据，再用下方明确的 demo 变量覆盖同名值；不要把整个环境打印到日志。
    ...process.env,
    // 让 tsx 使用项目内部的源码别名；类型检查则通过内部包生成的声明解析。
    TSX_TSCONFIG_PATH: resolve(harness, 'tsconfig.base.json'),
    // 通知官方 CLI 使用本 demo 的独立运行目录存放 profile 和日志。
    DSH_HOME: home,
    // 环境变量只能传字符串，因此用 1/0 表示离线开关，YAML 再比较它决定加载哪个适配器。
    DSH_DEMO_OFFLINE: offline ? '1' : '0',
    // 把最终端口交给 Web overlay；overlay 通过 Number(...) 转成 schema 要求的数值。
    DSH_DEMO_PORT: port,
    // 将同一绝对路径交给工作目录、Bash 和网页附件存储，避免相对路径解析不一致。
    DSH_DEMO_WORK_DIR: workDir,
    // 网页聊天事件单独保存，不与文件产物或仿真历史混在一起。
    DSH_DEMO_SESSION_DIR: resolve(demoRoot, process.env.DSH_DEMO_SESSION_DIR || '.dsh/sessions'),
    // 官方文件系统技能提供方只扫描这个目录；配置 JSON 另由网页管理器维护。
    DSH_DEMO_SKILL_DIR: resolve(demoRoot, process.env.DSH_DEMO_SKILL_DIR || '.dsh/local-skills'),
  // 结束当前对象成员或回调函数，并用逗号分隔后续成员或参数。
  },
// 闭合回调函数或对象参数，再闭合外层调用；读到这里才完成这次注册或构造表达式。
})
// 为键盘中断和进程停止两类信号安装转发，让应用启动器有机会清理资源。
for (const signal of ['SIGINT', 'SIGTERM']) {
  // 父包装脚本收到信号时把相同信号发给子进程；不让 Node 子进程在包装脚本退出后继续运行。
  process.on(signal, () => child.kill(signal))
// 闭合当前花括号结构；与上方对应的 { 配对，结束该函数、条件块或类型声明。
}
// 处理子进程无法启动等操作系统级错误；这不同于已经启动的应用返回非零状态。
child.on('error', error => {
  // 打印启动失败的可读原因，不输出整个环境对象或凭据。
  console.error(error.message)
  // 设置最终退出状态而非立即强退，使已登记的异步收尾仍有机会完成。
  process.exitCode = 1
// 闭合回调函数或对象参数，再闭合外层调用；读到这里才完成这次注册或构造表达式。
})
// 当子进程结束时复制其结果；code 可能为 null，此时要根据终止信号给出后备状态。
child.on('exit', (code, signal) => {
  // 保留包括 0 在内的有效退出码；只有 code 缺失时才用后备值，不能用 || 把成功的 0 错当缺失。
  process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 1)
// 闭合回调函数或对象参数，再闭合外层调用；读到这里才完成这次注册或构造表达式。
})
