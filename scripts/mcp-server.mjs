/** 本机 MCP 服务：加法与模板化水下链路仿真，通过 stdio 接入 Agent。 */
// 官方 MCP Server SDK 负责协议握手、工具发现、参数校验与请求分派。
import { McpServer } from '@modelcontextprotocol/server'
// stdio 服务读取标准输入并把协议响应写到标准输出，不占用 HTTP 端口。
import { serveStdio } from '@modelcontextprotocol/server/stdio'
// Zod 定义真实的参数校验器；SDK 会据此向客户端公布 JSON Schema。
import { z } from 'zod'
// 仿真流程与工具协议解耦，节点、资源与串并行规则由模板脚本执行。
import { registerSimulationTools } from '../simulation/mcp.mjs'

// SDK 通过工厂创建服务；stdio 协议协商的探测进程也使用同一份定义。
function createServer() {
  // 服务名称是远端身份；模型看到的 demo 命名空间由客户端 YAML 的 serverName 决定。
  const server = new McpServer({ name: 'dsh-demo-mcp', version: '1.0.0' })
  // 注册一个真实工具，计算发生在独立服务进程中，而不是模拟模型里。
  server.registerTool('add', {
    // 给发现工具的客户端提供可读说明。
    description: '计算两个有限数字的和。需要精确加法时使用此工具。',
    // 参数必须是有限数字；字符串不会被静默转换为数字。
    inputSchema: z.object({ a: z.number().finite().describe('第一个加数'), b: z.number().finite().describe('第二个加数') }),
  // 工具执行器返回 MCP 内容块；异步函数使 SDK 能等待处理结果。
  }, async ({ a, b }) => {
    // 即使两个输入都有限，浮点加法也可能溢出，所以单独判断结果。
    const sum = a + b
    // 标准 isError 让 Agent 看见失败，不把溢出伪装为有效答案。
    return { content: [{ type: 'text', text: Number.isFinite(sum) ? String(sum) : '加法结果超出有限数字范围。' }], isError: !Number.isFinite(sum) }
  // 结束工具注册。
  })
  // 每个 MCP 实例拥有自己的调度器，不把运行中的任务放进全局单例。
  const dataIndex = process.argv.indexOf('--simulation-data')
  // 部署或测试可隔离数据目录；Agent 的工具参数不能修改本机输出路径。
  const workflow = registerSimulationTools(server, dataIndex < 0 ? {} : { dataDir: process.argv[dataIndex + 1] })
  // SDK 在 stdio 断开时调用 close；先等待计算子进程退出，再结束协议连接。
  const closeProtocol = server.close.bind(server)
  // 同一工作流的 close 可重复调用，取消和资源回收只执行一次有效状态迁移。
  server.close = async () => { await workflow.close(); await closeProtocol() }
  // 收到客户端终止信号也走同一清理路径，避免卸载 MCP 后遗留仿真子进程。
  const stop = () => { void server.close().then(() => process.exit(0), error => { console.error(error.message); process.exit(1) }) }
  // SDK 的 stdio 子进程关闭协议会使用这些信号。
  process.once('SIGTERM', stop)
  // 直接运行服务时也支持键盘中断清理。
  process.once('SIGINT', stop)
  // 把完整服务实例交给 SDK 的传输层。
  return server
// 结束服务工厂。
}
// stdout 专用于 MCP 协议，不要在此添加 console.log；诊断应写到 stderr。
serveStdio(createServer)
