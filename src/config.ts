/** 终端入口和 Web 入口共用的模型路由配置。 */
// 导入 schema 构造器，用于运行时校验 YAML 配置；它和 TypeScript 的编译前类型检查作用不同。
import Schema from '@deepseek-ai/schemastery'

// 声明并导出配置对象的字段类型；interface 只参与类型检查，运行时不会保留一个 Config 类。
export interface Config {
  // offline 必须是布尔值：true 使用模拟适配器，false 使用 YAML 中的真实模型适配器。
  offline: boolean
  // provider 是模型提供方的路由名；LLM 运行时用它找到已注册的适配器，而不是把它当 API 地址。
  provider: string
  // model 是传给适配器的模型 ID；同一提供方可以用不同 ID 选择不同模型。
  model: string
// 闭合当前花括号结构；与上方对应的 { 配对，结束该函数、条件块或类型声明。
}

// 创建运行时配置校验器；冒号后的 Schema<Config> 说明它校验的对象应符合上面的 Config 类型。
export const Config: Schema<Config> = Schema.object({
  // 要求 offline 为布尔值；调用方未提供时填 false，显式值仍然优先。
  offline: Schema.boolean().default(false),
  // 要求必须提供字符串 provider；缺失配置在插件加载时就会被拒绝。
  provider: Schema.string().required(),
  // 要求必须提供字符串 model；类型正确不等于模型真实可用，后者由适配器和服务端验证。
  model: Schema.string().required(),
// 闭合回调函数或对象参数，再闭合外层调用；读到这里才完成这次注册或构造表达式。
})
