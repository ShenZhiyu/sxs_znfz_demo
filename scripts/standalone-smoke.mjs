/** 把源码复制到无相邻仓库的临时目录，重新安装、构建并验证全部聊天功能。 */
// 使用严格断言，让越界链接或任一失败命令都中断验证。
import assert from 'node:assert/strict'
// 同步子进程按顺序运行，避免多个测试共享端口或同时安装。
import { spawnSync } from 'node:child_process'
// 复制时排除安装产物与用户数据，验证结束后删除本脚本创建的临时目录。
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
// tmpdir 返回当前系统的临时目录，不假定所有系统都使用 /tmp。
import { tmpdir } from 'node:os'
// join 组合路径，relative 和 sep 用于判断真实路径是否位于副本内。
import { join, relative, sep } from 'node:path'
// 从脚本 URL 得到项目路径，使测试可从任意工作目录启动。
import { fileURLToPath } from 'node:url'
// npm run 会传入 npm CLI 的实际文件位置，避免通过 shell 查找命令。
const npmCli = process.env.npm_execpath
// 这份脚本应通过 package.json 提供的命令执行。
assert.ok(npmCli, '请使用 npm run standalone:smoke 执行独立性验证。')
// 以脚本所在目录为基准定位待验证的源码。
const source = fileURLToPath(new URL('../', import.meta.url))
// 每次验证使用全新目录，不覆盖已有项目或运行数据。
const isolated = mkdtempSync(join(tmpdir(), 'dsh-demo-standalone-'))
// 所有命令继承输出，失败原因直接显示在终端。
function run(args) {
  // 仅执行系统 Node 与 npm，子命令的工作目录固定为独立副本。
  const result = spawnSync(process.execPath, [npmCli, ...args], { cwd: isolated, stdio: 'inherit', env: { ...process.env, NODE_PATH: '' }, timeout: 300000 })
  // 操作系统启动错误与测试失败分别处理，不能把无退出码当作成功。
  if (result.error) throw result.error
  // 非零退出码会阻止继续执行后续步骤。
  assert.equal(result.status, 0, `独立副本执行失败：npm ${args.join(' ')}`)
// 结束命令工具。
}
// 无论安装还是测试失败，都清理这次创建的目录。
try {
  // 不带入原项目的 node_modules、.dsh、类型声明或增量编译缓存。
  cpSync(source, isolated, { recursive: true, filter: path => !relative(source, path).split(sep).some(part => ['node_modules', '.dsh', 'lib'].includes(part) || part.endsWith('.tsbuildinfo')) })
  // 用锁文件重新安装；prepare 生命周期会从复制的源码生成声明并检查框架类型。
  run(['ci', '--no-audit', '--no-fund'])
  // 安装之后逐一确认框架 workspace 链接的真实目标仍然在副本里。
  const upstream = JSON.parse(readFileSync(join(isolated, 'vendor/harness/UPSTREAM.json'), 'utf8'))
  // 只检查记录中的框架包；npm 的第三方下载依赖不来自相邻仓库。
  for (const pkg of upstream.packages) {
    // realpath 会跟随 npm 创建的符号链接，发现指向原项目的错误链接。
    const target = realpathSync(join(isolated, 'node_modules', pkg.name))
    // 目标必须恰好等于副本中的对应包，不能指向原项目或相邻仓库。
    assert.equal(target, realpathSync(join(isolated, 'vendor/harness', pkg.directory)))
  // 结束框架包链接检查。
  }
  // 严格检查教学入口代码，确认类型声明也能在副本中解析。
  run(['run', 'typecheck'])
  // 终端测试覆盖多轮历史、组合树和正常退出。
  run(['run', 'smoke'])
  // Web 测试覆盖静态资源、SSE、会话与错误恢复。
  run(['run', 'web:smoke'])
  // 调试测试使用本机协议服务器，不消耗真实模型额度。
  run(['run', 'debug:smoke'])
  // MCP 专项测试证明复制后的客户端和本机服务也能独立发现、调用和恢复。
  run(['run', 'mcp:smoke'])
  // 网页注册的服务也必须在无相邻仓库的环境中独立连接、保存和恢复。
  run(['run', 'mcp:management:smoke'])
  // 在独立副本确认技能目录、标准 Markdown 和按需加载工具可用。
  run(['run', 'skills:smoke'])
  // 官方 Bash 的启动、输出、超时与取消也必须完全来自独立副本。
  run(['run', 'bash:smoke'])
  // 文件收发与官方 file 消息同样必须在独立副本中工作。
  run(['run', 'files:smoke'])
  // 持久化后端和恢复必须在没有相邻仓库的副本中正常运行。
  run(['run', 'sessions:smoke'])
  // 用复制的模板和节点脚本验证资源约束、数值计算和 Agent 集成。
  run(['run', 'simulation:test'])
  run(['run', 'simulation:smoke'])
  // 只有安装和全部检查都成功才输出最终结果。
  console.log('独立运行验证通过：全新目录安装、框架构建、类型检查、终端、Web、调试、MCP 与仿真功能。')
// finally 保证失败时也不会留下这次测试的安装产物。
} finally {
  // isolated 来自本脚本的 mkdtempSync，不删除用户已有的项目目录。
  rmSync(isolated, { recursive: true, force: true })
// 结束清理块。
}
