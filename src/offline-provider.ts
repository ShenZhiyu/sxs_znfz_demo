/** Web 模式独立的模拟适配器插件：LLM 停止或恢复时由 Cordis 自动撤销或重新注册。 */
// Context 只用于类型检查，真正服务由 YAML 加载。
import type { Context } from '@deepseek-ai/cordis'
// 引入 LLM 服务的 Context 类型扩展。
import type {} from '@deepseek-ai/dsh-llm'
// 模拟适配器依然使用现有实现，不改变终端或离线回复规则。
import { OfflineAdapter } from './offline-adapter.ts'
// 插件名称用于日志，服务依赖由 inject 声明。
export const name = 'demo-offline-provider'
// 单独依赖 llm，确保停止核心服务不会把整个调试页面一起卸载。
export const inject = ['llm']
// Cordis 每次重新激活此插件都会建立一份新的注册，并在卸载时自动清理。
export function apply(ctx: Context): void {
  // 路由名与 Web 模式配置一致；不会把模拟数据伪称为真实 HTTP 响应。
  ctx.llm.registerAdapter(['demo-offline'], new OfflineAdapter())
// 结束模拟提供方注册。
}
