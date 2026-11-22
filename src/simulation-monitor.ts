/** Web 仿真监控只通过已注册 MCP 工具读状态和取消，不绕过后台模板运行器。 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-tools'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
// 复用 Web 入口已有的同源、方法和生命周期保护。
type Route = (path: string, method: string, handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>, kind?: 'exact' | 'prefix') => void
// 统一返回 JSON，避免浏览器把旧任务状态缓存为最新结果。
function json(res: ServerResponse, status: number, value: unknown): void { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)) }

export function installSimulationMonitor(ctx: Context, route: Route): void {
  // 与 Agent 使用同一个公开工具名，MCP 停用时明确返回服务不可用。
  const invoke = async (res: ServerResponse, name: string, args: Record<string, unknown>): Promise<void> => {
    const tools = ctx.get('tools'), fullName = 'mcp__demo__' + name
    if (!tools?.get(fullName)) { json(res, 503, { error: '仿真 MCP 工具尚未就绪，请在插件树中启用 MCP。' }); return }
    const result = await tools.execute({ name: fullName, arguments: args, callId: ToolCallId(randomUUID()), signal: AbortSignal.timeout(10000) })
    const value = JSON.parse(result.content.filter(block => block.type === 'text').map(block => block.text).join(''))
    json(res, result.isError ? 409 : 200, value)
  }
  // 查询资源也由 MCP 返回真实的演示账本，而不是从页面维护另一份余额。
  route('/api/simulation-resources', 'GET', (_req, res) => invoke(res, 'cluster_resources', {}))
  route('/api/simulations', 'GET', (_req, res) => invoke(res, 'list_simulations', {}))
  // 任务 ID 仅作为后台 Map 的键，不能用来读任意磁盘文件。
  route('/api/simulations', 'GET', (req, res) => {
    const id = new URL(req.url ?? '/', 'http://localhost').pathname.slice('/api/simulations/'.length)
    return invoke(res, 'simulation_status', { jobId: id, afterSeq: -1, waitMs: 0 })
  }, 'prefix')
  // 取消属于显式用户操作；复用已有 POST 的同源和 Content-Type 检查。
  route('/api/simulation-cancel', 'POST', (req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname
    return invoke(res, 'cancel_simulation', { jobId: path.slice('/api/simulation-cancel/'.length) })
  }, 'prefix')
}
