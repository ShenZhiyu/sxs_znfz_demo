# 随 demo 保存的 Harness 源码

这里是项目内部的源码副本。运行、安装、构建都不会访问相邻的 `deepseek-harness`。第三方通用库仍通过 npm 安装，精确版本由项目根目录的 `package-lock.json` 固定。

来源：DeepSeek Harness `0.2.1-rc.2`，提交 `687f282e8625c6b8d11ff58211a90524be2e4317`。复制时上游工作区无修改。来源仓库见 [UPSTREAM.json](UPSTREAM.json)，许可证见 [LICENSE](LICENSE)。Cordis 等基础库各目录保留自己的 MIT 许可证；其上游来源和已有修改历史保留在 [FOUNDATION.md](FOUNDATION.md)，该文件是归档资料，其中的全仓库同步命令不适用于此最小副本。

## 保留范围

保留了 354 个源码文件，分属 75 个内部包：七个核心插件、DeepSeek Messages 适配器、HTTP 服务、MCP 客户端及资源类型契约、官方 Skill 插件与本地文件系统、官方 CLI/profile 启动器，以及它们引用的公共服务、工具和类型。类型引用也要保留，例如 Agent 的接口会描述工作区、附件和权限；这些包的源码存在不表示应用启动了相应插件。实际激活的插件仍以根目录两个 YAML 的显式条目为准。

没有复制上游的完整前端、桌面端、原生系统工程、完整 bundle、测试数据或 node_modules。这个副本支持本 demo 的显式组合；扩展到其他官方插件时，需要同时补充相应源码和依赖。

## 文件约定

| 文件或目录 | 作用 |
| --- | --- |
| `apps/cli/src/` | 官方参数解析、profile 组装、就绪通知、退出和错误诊断。 |
| `packages/*/*/src/` | 核心 Agent、模型、HTTP 及公共契约的源码；保留原有注释和实现。 |
| `vendor/*/src/` | Cordis 插件框架、Loader、YAML 组合与配置 schema 的基础实现。 |
| 每包 `package.json` | 本副本使用的 npm workspace 清单；运行入口指向 `.ts`，类型入口指向生成的 `.d.ts`。 |
| 每包 `package.upstream.json` | 未修改的原始清单，便于查看来源依赖与本地裁剪差异；npm 不执行它。 |
| 每包 `tsconfig.json` | 仅检查保留的文件和内部项目引用，生成 `lib/types` 声明。 |
| 每包 `tsconfig.upstream.json` | 原始构建配置的存档，不参与本项目构建。 |
| 每包 `locale/`、`README.md`、`LICENSE` | 保留下来的原始元数据、说明和授权文字。 |
| `tsconfig.base.json` | 保留上游严格检查选项，以及只指向本目录的源码路径映射。 |
| `tsconfig.json` | 聚合各包的构建引用；自身没有输入源码。 |
| `UPSTREAM.json` | 来源提交、包清单、复制文件的 SHA-256 与本地存放位置。 |
| `FILES.md` | 逐个源码文件的阅读索引。 |
| `lib/types/`、`*.tsbuildinfo` | `npm run build` 生成的声明和缓存，忽略提交，可重新生成。 |

## 本地调整与构建

复制的 `.ts` 源码保持字节不变。只调整了构建和包装：将 workspace 协议改为可由 npm 链接的本地版本，依实际源码引用裁剪依赖，为 CLI 补充 YAML 显式插件的安装依赖，将 exports 指向项目内源码，并为类型声明保留独立的包构建边界。没有把多包源码合并成一个放宽类型规则的检查项目。

在 demo 根目录执行 `npm install` 或 `npm ci` 时，npm 先把这些包链接到本项目的 node_modules，再通过 prepare 自动运行 `npm run build`。构建会类型检查框架并生成声明；运行时由本项目安装的 tsx 执行 `.ts`。修改框架源码后重新执行 `npm run build`，再运行 `npm run typecheck` 检查教学入口。

根目录的 `npm run standalone:smoke` 会排除依赖、声明和用户数据，将源码复制到系统临时目录，重新安装并执行全部测试。它同时检查内部包链接的真实路径，确保指向临时副本。

## 包清单

以下是源码/类型依赖清单，不是激活插件清单。每个包的具体源码见 [FILES.md](FILES.md)。

| 目录 | 包名 | 原始职责 |
| --- | --- | --- |
| `apps/cli` | `@deepseek-ai/dsh` | dsh CLI: profile launch, plugin management, and configuration inspection |
| `packages/attachment/attachment` | `@deepseek-ai/dsh-attachment` | Durable immutable attachment storage seam for the DeepSeek Harness |
| `packages/boot/app-boot` | `@deepseek-ai/dsh-app-boot` | Shared boot glue for the app bins: .env loading, fail-loud Loader guards, snapshot-aware config resolution, and the Loader boot sequence |
| `packages/boot/cmdline` | `@deepseek-ai/dsh-cmdline` | Immutable command-line handoff from a dsh launcher to any app plugin that injects cmdlineArgs |
| `packages/boot/config-editor` | `@deepseek-ai/dsh-config-editor` | Persist plugin configuration through profile patches and Loader reconciliation |
| `packages/boot/hmr` | `@deepseek-ai/dsh-hmr` | Coordinated module and profile configuration hot reload |
| `packages/boot/plugin-manager` | `@deepseek-ai/dsh-plugin-manager` | Current-profile plugin and bundle management shared by dsh CLI, Web and agent tools |
| `packages/core/agent` | `@deepseek-ai/dsh-agent` | Agent interface, registry, initiator scope, and event vocabulary for the DeepSeek Harness |
| `packages/core/agent-loop` | `@deepseek-ai/dsh-agent-loop` | The concrete agent loop plugin for the DeepSeek Harness |
| `packages/core/scope` | `@deepseek-ai/dsh-scope` | Scoped-context registration primitive (scope tags, scope-filtered event dispatch) for the DeepSeek Harness |
| `packages/core/session` | `@deepseek-ai/dsh-session` | Event-sourced session store for the DeepSeek Harness |
| `packages/core/system-prompt` | `@deepseek-ai/dsh-system-prompt` | System prompt assembly registry for the DeepSeek Harness |
| `packages/core/tools` | `@deepseek-ai/dsh-tools` | Tool registry and execution pipeline for the DeepSeek Harness |
| `packages/credentials/credentials` | `@deepseek-ai/dsh-credentials` | Abstract credential seam (ctx.credentials): settings carry references to secrets, providers own the values |
| `packages/fs/fs` | `@deepseek-ai/dsh-fs` | Abstract filesystem capability seam (ctx.fs) for the DeepSeek Harness — vocabulary types, the FileSystem service (text IO + optional version-guarded atomic mutations), and the fs/* policy event vocabulary |
| `packages/host/plugin-inventory` | `@deepseek-ai/dsh-host-plugin-inventory` | Read-only Remote projection of current Cordis Loader plugin state |
| `packages/host/webserver` | `@deepseek-ai/dsh-host-webserver` | Web route-registration plugin: HTTP and upgrade routes, index transform taps, and static dist fallback; knows no harness concepts |
| `packages/identity/anonymous-user-id` | `@deepseek-ai/dsh-anonymous-user-id` | Shared anonymous user identity for DeepSeek Harness telemetry and feedback correlation |
| `packages/interaction/user-approval` | `@deepseek-ai/dsh-user-approval` | User-approval seam (ctx.approval) for the DeepSeek Harness: one-shot permission decisions dispatched to composed answerers over the approval/request waterfall, fail-closed by default |
| `packages/llm/deepseek-llm-api-extensions` | `@deepseek-ai/dsh-deepseek-llm-api-extensions` | Additive request-field registry for the official DeepSeek LLM API adapter |
| `packages/llm/llm` | `@deepseek-ai/dsh-llm` | Provider-neutral LLM service interface for the DeepSeek Harness |
| `packages/llm/llm-deepseek` | `@deepseek-ai/dsh-llm-deepseek` | DeepSeek Messages adapter |
| `packages/llm/llm-deepseek-api-key` | `@deepseek-ai/dsh-llm-deepseek-api-key` | DeepSeek api-key provider authentication and discovery |
| `packages/ptc-runtime/ptc-runtime` | `@deepseek-ai/dsh-ptc-runtime` | Abstract PTC execution seam (ctx.ptcRuntime) for the DeepSeek Harness |
| `packages/sandbox/sandbox` | `@deepseek-ai/dsh-sandbox` | Abstract process-sandbox seam (ctx.sandbox) for the DeepSeek Harness: same-world confinement vocabulary and the SandboxProvider contract |
| `packages/sandbox/sandbox-policy` | `@deepseek-ai/dsh-sandbox-policy` | Per-call sandbox policy resolver and current model context: deployment fallbacks plus each session's mode and workspace root, shared by every enforcing capability family |
| `packages/session/session-persistence` | `@deepseek-ai/dsh-session-persistence` | Abstract durable session persistence seam (ctx.sessionPersistence) for the DeepSeek Harness |
| `packages/session/session-projection` | `@deepseek-ai/dsh-session-projection` | Session-projection seam: the merge-extensible projection type table, the provider contract, and the ctx.sessionProjections registry serving whole current values of log-derived per-session state |
| `packages/session/working-directory` | `@deepseek-ai/dsh-working-directory` | Session working directories with durable changes and model context |
| `packages/settings/settings` | `@deepseek-ai/dsh-settings` | Abstract user-settings seam (ctx.settings) for the DeepSeek Harness |
| `packages/storage/storage` | `@deepseek-ai/dsh-storage` | Storage hub (ctx.storage): named backend registry plus mounted data-form facilities for the DeepSeek Harness |
| `packages/storage/storage-domain` | `@deepseek-ai/dsh-storage-domain` | Domain data form (ctx.storage.domain): schema-validated, event-emitting KV domains over storage backends for the DeepSeek Harness |
| `packages/subprocess/subprocess` | `@deepseek-ai/dsh-subprocess` | Subprocess seam (ctx.subprocess) for the DeepSeek Harness — managed process groups, bounded spill-backed output, and escalated kills behind one abstract service |
| `packages/typert/protocol` | `@deepseek-ai/dsh-typert-protocol` | Compiler-independent Remote metadata and Typert provider protocols |
| `packages/util/atomic-write` | `@deepseek-ai/dsh-atomic-write` | Zero-dependency atomic file replacement: exclusive-create random-suffix temp + rename carrying the caller-stated permissions (writeFileAtomic) |
| `packages/util/brand` | `@deepseek-ai/dsh-brand` | Stateless branded primitive types for the DeepSeek Harness |
| `packages/util/crypto` | `@deepseek-ai/dsh-util-crypto` | Zero-dependency browser-safe UUID and byte-encoding helpers |
| `packages/util/home-paths` | `@deepseek-ai/dsh-home-paths` | Shared filesystem path helpers for the DeepSeek Harness |
| `packages/util/http-proxy` | `@deepseek-ai/dsh-http-proxy` | Process-wide outbound HTTP proxy policy for DeepSeek Harness: resolve it from the launch environment and install it as undici's global dispatcher |
| `packages/util/launch-environment` | `@deepseek-ai/dsh-launch-environment` | Immutable DeepSeek Harness launch environment that records which layer supplied each value |
| `packages/util/package-manifest` | `@deepseek-ai/dsh-package-manifest` | Shared type declarations for package.json.dsh configuration fields |
| `packages/util/timeout` | `@deepseek-ai/dsh-timeout` | Zero-dependency timeout/deadline primitive: clampTimeout, deadline, timeoutOf, TimeoutReason (timing + classification only, no termination) |
| `packages/util/values` | `@deepseek-ai/dsh-util-values` | Duplicate-install-safe value primitives for the DeepSeek Harness |
| `packages/workspace/workspace` | `@deepseek-ai/dsh-workspace` | Workspace entity registry (ctx.workspaceRegistry): durable workspace records with validated session attachment over the domain data form for the DeepSeek Harness |
| `vendor/cordis` | `@deepseek-ai/cordis` | Meta-Framework for Modern JavaScript Applications |
| `vendor/cosmokit` | `@deepseek-ai/cosmokit` | A collection of common utilities |
| `vendor/group` | `@deepseek-ai/cordis-plugin-group` | Nested plugin group for cordis |
| `vendor/include` | `@deepseek-ai/cordis-plugin-include` | Include files in cordis configurations |
| `vendor/loader` | `@deepseek-ai/cordis-plugin-loader` | Plugin loader for cordis |
| `vendor/schemastery` | `@deepseek-ai/schemastery` | Type driven schema validator |
| `vendor/timer` | `@deepseek-ai/cordis-plugin-timer` | Timer service for cordis |

## MCP 增量

本机工具示例新增 `packages/mcp/mcp-client`（真实客户端实现）和 `packages/mcp/mcp-resources`（客户端引用的公共资源类型与可选服务定义）。只在 demo YAML 中激活客户端，没有自动挂载资源服务。两个包的源文件、原始包清单、构建配置与 README 均按同一来源提交保留并记录 SHA-256；运行不需要上游仓库。

- `packages/mcp/mcp-client`：MCP client bridge: connects to MCP servers and registers their tools on ctx.tools。

- `packages/mcp/mcp-resources`：Scoped MCP resource discovery and reading through shared model tools。

## Skill 增量

新增官方 `dsh-skill`、`dsh-skill-filesystem`、`dsh-tool-skill`，以及它们所需的 `dsh-fs-local`。原有的工作目录服务同时在 Web overlay 中激活。技能注册表、文件发现、目录与加载工具、显式 `/技能名` 调用均执行这些原始源码；没有修改官方插件以适配页面。

网页保存的 JSON 是 demo 管理数据，通过 `ctx.skills.register()` 贡献到官方注册表；本地目录则由官方 filesystem provider 负责读取。与其他包一样，新包仅调整 npm workspace 清单、源码 exports 和声明构建配置，原始清单与配置均保留为 `*.upstream.json`。

| 目录 | 包名 | 原始职责 |
| --- | --- | --- |
| `packages/skill/skill` | `@deepseek-ai/dsh-skill` | Agent skill provider registry for the DeepSeek Harness |
| `packages/skill/skill-filesystem` | `@deepseek-ai/dsh-skill-filesystem` | Local filesystem skill provider for the DeepSeek Harness |
| `packages/skill/tool-skill` | `@deepseek-ai/dsh-tool-skill` | Model-facing skill loading tool for the DeepSeek Harness |
| `packages/fs/fs-local` | `@deepseek-ai/dsh-fs-local` | Local-filesystem implementation of the DeepSeek Harness filesystem seam (ctx.fs) |

## Bash 增量

新增官方 shell、bash-local、shell-env、tool-bash、subprocess-local 及其依赖契约 jobs、lazy-require、win32-process。根组合实际激活四个具体运行插件；jobs 仅作为原始类型/工具契约保留，不代表启用后台任务。原始 TypeScript 源码保持不变；子路径 exports（runner、output、control、brand、view）映射到项目内源码，以匹配现有 tsx 启动方式。子进程 runner 同样使用本项目 tsconfig，不读取相邻仓库。

| 目录 | 包名 | 原始职责 |
| --- | --- | --- |
| `packages/shell/shell` | `@deepseek-ai/dsh-shell` | Abstract bash executor seam (ctx.shell) for the DeepSeek Harness |
| `packages/shell/bash-local` | `@deepseek-ai/dsh-bash-local` | Local-subprocess implementation of the DeepSeek Harness bash executor seam |
| `packages/shell/tool-bash` | `@deepseek-ai/dsh-tool-bash` | Model-facing bash tool with optional generic background-job and sandbox-escalation support |
| `packages/shell/shell-env` | `@deepseek-ai/dsh-shell-env` | Tool-independent managed DSH_* shell environment registry |
| `packages/subprocess/subprocess-local` | `@deepseek-ai/dsh-subprocess-local` | Local-subprocess implementation of the DeepSeek Harness subprocess seam |
| `packages/subprocess/win32-process` | `@deepseek-ai/dsh-win32-process` | Shared low-level Win32 process, stdio, and Job Object primitives |
| `packages/util/lazy-require` | `@deepseek-ai/dsh-lazy-require` | Caller-relative, success-cached lazy loading for CommonJS-compatible Host dependencies |
| `packages/jobs/jobs` | `@deepseek-ai/dsh-jobs` | Background job registry (ctx.jobs) for the DeepSeek Harness — shared ids, owner isolation, polling, cancellation, and completion listeners for long-running tool work |

## 会话持久化增量

Web 新增官方 `dsh-session-persistence-jsonl`，以 `compression: none` 保存可读的 JSONL 会话。补齐 `session-format`、`session-format-catalog`、四段已发布格式迁移及其引用的 `compaction-image-offload`、`compaction` 和 `commands` 源码；这些依赖仅供格式校验与恢复使用，没有激活额外命令或压缩插件。原始源码保持不变，SHA-256 与原始包清单记在 `UPSTREAM.json`，阅读索引记在 `FILES.md`。

官方后端的 POSIX 文件锁依赖 npm 发布的 `@deepseek-ai/node-addon-system@0.1.2` 及其平台二进制包；第三方 `p-limit` 和既有 `koffi` 一并由根锁文件固定，不读取相邻仓库或从相邻仓库加载原生文件。使用 Node `^22.19.0 || >=24.0.0`，安装时保留 npm 默认的可选平台依赖。

持久化接口与后端均为官方实现，网页只投影历史并调用 `agents.resume()`；原始 HTTP 调试器仍是进程内存数据。
