# 水下通信链路仿真 Agent

基于 DeepSeek Harness 的水下通信仿真演示项目，提供 Web 和终端对话入口。Agent 通过 MCP 调用环境数据、声场、信号处理、回放和评估五个平台的 HTTP 接口。仓库自带本地 Mock，可用于开发和联调。

## 主要功能

- 五组 MCP 服务，覆盖 24 个平台接口。
- 链路仿真 Skill，按阶段确认参数，支持在声场和信号处理环节使用自定义算法。
- Web 对话与调试，支持会话历史、文件附件，以及查看模型请求和工具调用过程。

## 快速启动

需要 Node.js 22.19 起的 22.x，或 Node.js 24 及以上。在项目根目录安装依赖并启动 Mock：

```bash
npm ci
npm run mock:platforms
```

另开一个终端，启动离线 Web Agent：

```bash
npm run web -- --offline
```

打开 `http://127.0.0.1:3080`，发送 `/mcp__environment__get_environment_config` 验证工具调用。离线模式无需 API Key。

使用真实模型时，在启动环境设置 `DEEPSEEK_API_KEY`，再执行 `npm run web`。在 Web 聊天框输入 `/communication-link-simulation` 可进入引导流程。终端模式使用 `npm run demo`，也支持 `--offline`。

## 相关文档

- [五平台接口与 MCP 工具对照](simulation/platform-mock/README.md)
- [HTTP 接口契约](仿真平台接口清单与离线Mock约定.md)
- [链路仿真 Skill](skills/communication-link-simulation/SKILL.md)
- [独立本地模板仿真](simulation/README.md)
