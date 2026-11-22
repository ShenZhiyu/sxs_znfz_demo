# 框架源码阅读索引

本表覆盖实际复制的 354 个源码文件。中文说明解释入口职责；英文说明摘自文件原有模块注释，方便对照源码阅读。源码保留原注释，教学入口的逐行中文说明仍在 demo 根目录的 src、scripts 和 web 下。

每包的 `package.json`、`package.upstream.json`、`tsconfig.json` 和 `tsconfig.upstream.json` 的作用统一见 [README.md](README.md)。`locale/*.json` 是插件名称和说明的翻译；各包原 README 和许可证作为归档保留。

## @deepseek-ai/dsh

dsh CLI: profile launch, plugin management, and configuration inspection

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/args.ts](apps/cli/src/args.ts) | 解析 CLI 参数，把用户输入转换为明确的启动模式。 |
| [src/bin.ts](apps/cli/src/bin.ts) | 官方 CLI 的可执行入口，解析命令后分派到 profile 启动或配置查看。 |
| [src/dump-config-schema.ts](apps/cli/src/dump-config-schema.ts) | 加载 schema 并打印配置结构。 |
| [src/dump-config.ts](apps/cli/src/dump-config.ts) | 组合并打印有效配置，不开始对话。 |
| [src/plugin.ts](apps/cli/src/plugin.ts) | 官方 CLI 的插件管理命令分派。 |
| [src/process-shutdown.ts](apps/cli/src/process-shutdown.ts) | 管理信号、退出请求和有界的资源清理。 |
| [src/profile-boot.ts](apps/cli/src/profile-boot.ts) | 组合 profile 与 patch，启动插件树并协调就绪和退出。 |
| [src/startup-diagnostics.ts](apps/cli/src/startup-diagnostics.ts) | 整理启动失败原因并输出诊断。 |

## @deepseek-ai/dsh-attachment

Durable immutable attachment storage seam for the DeepSeek Harness

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/admission.ts](packages/attachment/attachment/src/admission.ts) | Wire-form admission of base64-encoded image uploads. @module @deepseek-ai/dsh-attachment/admission |
| [src/brand.ts](packages/attachment/attachment/src/brand.ts) | Attachment identifier brand. @module @deepseek-ai/dsh-attachment/brand |
| [src/error.ts](packages/attachment/attachment/src/error.ts) | Attachment failure class. @module @deepseek-ai/dsh-attachment/error |
| [src/index.ts](packages/attachment/attachment/src/index.ts) | 此包的公开入口；聚合导出或定义对应的服务、插件。 |
| [src/request-projection.ts](packages/attachment/attachment/src/request-projection.ts) | Pure request-projection geometry shared by model routes and provider-side request pricing. @module @deepseek-ai/dsh-attachment/request-projection |
| [src/types.ts](packages/attachment/attachment/src/types.ts) | Durable attachment vocabulary. @module @deepseek-ai/dsh-attachment/types |

## @deepseek-ai/dsh-app-boot

Shared boot glue for the app bins: .env loading, fail-loud Loader guards, snapshot-aware config resolution, and the Loader boot sequence

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/compatibility-preflight.ts](packages/boot/app-boot/src/compatibility-preflight.ts) | Compatibility checks at the composition entry points DSH owns; no Loader instrumentation. |
| [src/config-schema/collect.ts](packages/boot/app-boot/src/config-schema/collect.ts) | Boot-free inspection of declared plugin Config schemas using profile module resolution. |
| [src/config-schema/document.ts](packages/boot/app-boot/src/config-schema/document.ts) | Compose Loader entry/patch structure and discovered plugin input schemas into one JSON Schema document. |
| [src/config-schema/index.ts](packages/boot/app-boot/src/config-schema/index.ts) | 此包的公开入口；聚合导出或定义对应的服务、插件。 |
| [src/config-schema/native.ts](packages/boot/app-boot/src/config-schema/native.ts) | Identity checks at the plugin-export and lazy-builder boundaries. |
| [src/config-schema/pattern.ts](packages/boot/app-boot/src/config-schema/pattern.ts) | Conservative compatibility checks between native RegExp validation and Unicode JSON Schema patterns. |
| [src/config-schema/projector.ts](packages/boot/app-boot/src/config-schema/projector.ts) | Project native Config input constraints without executing their validators or transform callbacks. |
| [src/config-schema/types.ts](packages/boot/app-boot/src/config-schema/types.ts) | JSON Schema output and native graph inputs for boot-free configuration inspection. |
| [src/index.ts](packages/boot/app-boot/src/index.ts) | 此包的公开入口；聚合导出或定义对应的服务、插件。 |
| [src/official-bundle-packages.ts](packages/boot/app-boot/src/official-bundle-packages.ts) | 官方可按需安装的 bundle 包名清单，不是本 demo 的启动配置。 |
| [src/official-bundles.generated.ts](packages/boot/app-boot/src/official-bundles.generated.ts) | 随官方启动器保留的 bundle 发现元数据；不会自动加载这些 bundle。 |
| [src/official-bundles.ts](packages/boot/app-boot/src/official-bundles.ts) | Official bundles offered without installing their provider runtimes in the DSH distribution. |
| [src/package-meta.ts](packages/boot/app-boot/src/package-meta.ts) | Read plugin display text and icons through exported resources without evaluating plugin code. |
| [src/plugin-compatibility.ts](packages/boot/app-boot/src/plugin-compatibility.ts) | Evaluate plugin dsh requirements (`engines.dsh`, else dsh peers) without importing plugin code. |
| [src/profile-compatibility.ts](packages/boot/app-boot/src/profile-compatibility.ts) | Profile-local compatibility permissions readable before any Cordis plugins load. |
| [src/profile-context.ts](packages/boot/app-boot/src/profile-context.ts) | Launcher-owned profile locations and composition inputs. |
| [src/profile-plugins.ts](packages/boot/app-boot/src/profile-plugins.ts) | Installed profile dependencies and their bundle activation after package-manager operations. |
| [src/profile-resolution/legacy-links.ts](packages/boot/app-boot/src/profile-resolution/legacy-links.ts) | Package directory and resource canonicalization through the active runtime carrier's filesystem. |
| [src/profile-resolution/resolver.ts](packages/boot/app-boot/src/profile-resolution/resolver.ts) | In-memory profile package routing for Node's default ESM and CommonJS loaders. |
| [src/profile-resolution/service.ts](packages/boot/app-boot/src/profile-resolution/service.ts) | Package metadata resolved through one runtime interception. |
| [src/profile-resolution/worker-bootstrap.ts](packages/boot/app-boot/src/profile-resolution/worker-bootstrap.ts) | 为框架创建的 Worker 恢复运行时模块解析规则。 |
| [src/profile-sanitize.ts](packages/boot/app-boot/src/profile-sanitize.ts) | Filesystem recovery for callers that own profile shutdown and write exclusion. |
| [src/profile.ts](packages/boot/app-boot/src/profile.ts) | 读取 profile 清单，计算 bundle 和运行时依赖解析信息。 |

## @deepseek-ai/dsh-cmdline

Immutable command-line handoff from a dsh launcher to any app plugin that injects cmdlineArgs

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/index.ts](packages/boot/cmdline/src/index.ts) | 此包的公开入口；聚合导出或定义对应的服务、插件。 |

## @deepseek-ai/dsh-config-editor

Persist plugin configuration through profile patches and Loader reconciliation

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/index.ts](packages/boot/config-editor/src/index.ts) | 此包的公开入口；聚合导出或定义对应的服务、插件。 |

## @deepseek-ai/dsh-hmr

Coordinated module and profile configuration hot reload

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/error.ts](packages/boot/hmr/src/error.ts) | error 模块的实现与类型；由同包入口或相邻模块引用。 |
| [src/index.ts](packages/boot/hmr/src/index.ts) | 此包的公开入口；聚合导出或定义对应的服务、插件。 |
| [src/module-files.ts](packages/boot/hmr/src/module-files.ts) | Disk identities of loaded module files, used to find modules whose files changed after loading. |
| [src/package-manifest.ts](packages/boot/hmr/src/package-manifest.ts) | Expire Node's cached package configuration for package directories whose manifest changed. |
| [src/watch-config.ts](packages/boot/hmr/src/watch-config.ts) | Exact-path watching for live profile patch files outside Cordis module roots. |

## @deepseek-ai/dsh-plugin-manager

Current-profile plugin and bundle management shared by dsh CLI, Web and agent tools

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/failure.ts](packages/boot/plugin-manager/src/failure.ts) | Localizable rejections shared by profile management operations. |
| [src/install-spec.ts](packages/boot/plugin-manager/src/install-spec.ts) | Reading an install spec before pnpm sees it: which of pnpm's spec forms it takes, and for a registry name whether it is one the registry can accept. |
| [src/operations.ts](packages/boot/plugin-manager/src/operations.ts) | Shared profile package operations used by dsh plugin and the running manager. |
| [src/run-tree.ts](packages/boot/plugin-manager/src/run-tree.ts) | Waiting for one package run's process tree to disappear before its caller touches the profile. |
| [src/types.ts](packages/boot/plugin-manager/src/types.ts) | Public plugin management records shared with clients. |

## @deepseek-ai/dsh-agent

Agent interface, registry, initiator scope, and event vocabulary for the DeepSeek Harness

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/archive-admission.ts](packages/core/agent/src/archive-admission.ts) | The `turn` family of the Workspace registry's archive admission: whether a Session's own Agent is inside a turn, and its cancel when the Session is archived with its work. Installed by the registry's constructor, so it answers for every Agent the registry publishes. |
| [src/consumed-work.ts](packages/core/agent/src/consumed-work.ts) | How one agent log accounts for the work it consumed. The turn and step vocabulary alone cannot answer this. A turn that stops before its first step leaves a `turn/end` shaped exactly like the balanced no-op turns a rejection or an empty claim produces, so reading turns in isolation either credits cut-short work as finished or convicts every no-op. The missing fact is the inbox's own record: {@link Inbox} logs each mutation with `removedCount` and marks a cancellation `outcome: 'canceled'`, which separates a turn claiming its input from work being dropped unrun. |
| [src/dispatch.ts](packages/core/agent/src/dispatch.ts) | Agent-scoped dispatch and prompt assembly helpers. The fused dispatcher {@link agentEvents} couples the agent subject to its scope carrier, so the scope key and the payload's `agent` cannot diverge; repeat dispatchers (the loop driver) build it once in the agent's constructor and reuse it. |
| [src/index.ts](packages/core/agent/src/index.ts) | 此包的公开入口；聚合导出或定义对应的服务、插件。 |
| [src/model-selection.ts](packages/core/agent/src/model-selection.ts) | Agent-scoped model selection shared by runtime entry points. |
| [src/projection.ts](packages/core/agent/src/projection.ts) | projection 模块的实现与类型；由同包入口或相邻模块引用。 |
| [src/runtime-types.ts](packages/core/agent/src/runtime-types.ts) | Public agent types and live-runtime events. Durable transcript facts and turn/step boundaries remain `@deepseek-ai/dsh-session` events. |
| [src/types.ts](packages/core/agent/src/types.ts) | Durable agent session-event vocabulary shared with type-only consumers. |

## @deepseek-ai/dsh-agent-loop

The concrete agent loop plugin for the DeepSeek Harness

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/agent.ts](packages/core/agent-loop/src/agent.ts) | Default Agent driver over queued turns and step-boundary input. Every request is derived from the session log. |
| [src/assistant-stream.ts](packages/core/agent-loop/src/assistant-stream.ts) | Process-local assistant attempt framing and durable stream accumulation. |
| [src/constants.ts](packages/core/agent-loop/src/constants.ts) | Shared agent-loop scheduler defaults. |
| [src/inbox.ts](packages/core/agent-loop/src/inbox.ts) | Driver-owned durable agent inbox projection and command facade. |
| [src/index.ts](packages/core/agent-loop/src/index.ts) | 此包的公开入口；聚合导出或定义对应的服务、插件。 |
| [src/runtime-context.ts](packages/core/agent-loop/src/runtime-context.ts) | Durable projection state for the two loop-owned surface messages the system prompt plugin forms: the system prompt (surface node 0 and any in-history replacement) and the dynamic runtime-context snapshot. |
| [src/tool-calls.ts](packages/core/agent-loop/src/tool-calls.ts) | Schedules one assistant step's tool calls. Exclusive calls form barriers; parallel calls use a bounded rolling pool and are reclassified before start. Dispatch may overlap, while policy, results, and result context remain model-ordered. Abort or an internal scheduler failure stops replenishment and drains started calls. Abort records synthetic error results for skipped calls so replay stays valid. A terminal scheduler failure rejects after draining; the owning step records conservative recovery results before closing. |

## @deepseek-ai/dsh-scope

Scoped-context registration primitive (scope tags, scope-filtered event dispatch) for the DeepSeek Harness

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/index.ts](packages/core/scope/src/index.ts) | 此包的公开入口；聚合导出或定义对应的服务、插件。 |
| [src/store.ts](packages/core/scope/src/store.ts) | Shared insertion-ordered storage and effect ownership for scope-aware registries. |

## @deepseek-ai/dsh-session

Event-sourced session store for the DeepSeek Harness

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/fork.ts](packages/core/session/src/fork.ts) | Fork seed construction over an exact source-event prefix. |
| [src/index.ts](packages/core/session/src/index.ts) | 此包的公开入口；聚合导出或定义对应的服务、插件。 |
| [src/known-event-types.ts](packages/core/session/src/known-event-types.ts) | GENERATED by `scripts/gen-persistence-catalog.ts` — do not edit by hand; run `pnpm run gen-persistence-catalog` to regenerate (verified fresh by `pnpm run verify-persistence-catalog`, part of `doc-sync`). |
| [src/preparation.ts](packages/core/session/src/preparation.ts) | Ownership of one unpublished Session before registry publication. |
| [src/repair.ts](packages/core/session/src/repair.ts) | Pending tool-result recovery shared by failed live steps, interrupted logs, and fork seeds. Tail repair preserves closed steps and supplies only missing tool results and lifecycle boundaries, with cause-specific retry guidance. |
| [src/request-header.ts](packages/core/session/src/request-header.ts) | Request-header reconstruction utilities over full `request/header` session events. Anyone holding a session log reconstructs the {@link EpochHeader} any request was built under by taking the latest canonical snapshot; the loop uses the same equality helper to avoid logging unchanged headers. |
| [src/seq-ranges.ts](packages/core/session/src/seq-ranges.ts) | Lossless range encoding for JSONL `sourceEventSeqs` arrays. |
| [src/surface.ts](packages/core/session/src/surface.ts) | Surface layer on top of the session event log: an ordered view of events that produce LLM messages. The append-only log remains the source of truth. Browser-safe: web clients consume this subpath export, so it must stay free of `node:` imports (they break the vite bundle). |
| [src/tool-history.ts](packages/core/session/src/tool-history.ts) | Stateful reconstruction of historical tool definitions for request projection. |
| [src/types.ts](packages/core/session/src/types.ts) | types 模块的实现与类型；由同包入口或相邻模块引用。 |

## @deepseek-ai/dsh-system-prompt

System prompt assembly registry for the DeepSeek Harness

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/index.ts](packages/core/system-prompt/src/index.ts) | 此包的公开入口；聚合导出或定义对应的服务、插件。 |

## @deepseek-ai/dsh-tools

Tool registry and execution pipeline for the DeepSeek Harness

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/index.ts](packages/core/tools/src/index.ts) | 此包的公开入口；聚合导出或定义对应的服务、插件。 |
| [src/json-schema.ts](packages/core/tools/src/json-schema.ts) | Enforced JSON Schema subset shared by tool outputs, generated PTC mode types, subagents, and workflows. The subset accepts any JSON root, an annotation-only schema for unconstrained JSON, one scalar `type`, object `properties`/`required`/boolean `additionalProperties`, array `items`, type-correct scalar `enum`/`const`, and exact-one `oneOf`. Unsupported or misplaced keywords reject rather than being accepted without enforcement. Consumers that require an object root apply {@link assertObjectJsonSchema} before accepting input. |
| [src/presentation.ts](packages/core/tools/src/presentation.ts) | Tool render-intent vocabulary: the provider-neutral types a tool declares via `ToolDefinition.presentCall`/`ToolDefinition.presentResult` to say how one of its calls renders in a UI (an editor's tool-call card, a CLI log line). |
| [src/ptc-calls.ts](packages/core/tools/src/ptc-calls.ts) | Cancellation and settlement of complete PTC calls, including nested tools. |
| [src/ptc.ts](packages/core/tools/src/ptc.ts) | PTC mode `run_code` transport. Programs call the registry's agent-visible tools through nested executions scheduled under the native concurrency contract; each sub-dispatch is logged for reconstruction, while only the outer curated result enters model history. |
| [src/py-types.ts](packages/core/tools/src/py-types.ts) | PTC mode codegen — Python flavor. The pure projection from registered tool schemas to the Python SDK text the model programs against under `runtime.language === 'python'`. Sibling of {@link ./ts-types.ts / ts-types.ts}; the two files are two projections of the same registry store, keyed by the loaded {@link @deepseek-ai/dsh-ptc-runtime#PtcRuntime.language / PTC runtime's language}. Under `mode: 'ptc'` the native tool schemas are omitted from the request, so this generated SDK is the model's ONLY source for each tool's argument names, required fields, types, descriptions, and canonical output types. Object-shaped arguments and outputs render as one named `TypedDict` per tool (and per nested object), not an opaque `dict[str, Any]`, so the shape survives into the program under the mode that has nothing else to carry it. |
| [src/schema.ts](packages/core/tools/src/schema.ts) | Unified JSON-value schema DSL, inference, compilation, and typed tool helper. @module dsh-tools/schema |
| [src/testing.ts](packages/core/tools/src/testing.ts) | Canonical tool-definition fixtures for repository tests. @module dsh-tools/testing |
| [src/ts-types.ts](packages/core/tools/src/ts-types.ts) | PTC mode codegen: the pure projection from registered tool schemas to the TypeScript SDK text the model programs against (the `tools:sdk` prompt section). Sibling of `json-schema.ts` — `schemas()` (native function calling) and this module (the generated `declare const tools` API) are two projections of the same store. |
| [src/types.ts](packages/core/tools/src/types.ts) | Durable Tool event vocabulary shared with type-only consumers. |

## @deepseek-ai/dsh-credentials

Abstract credential seam (ctx.credentials): settings carry references to secrets, providers own the values

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/index.ts](packages/credentials/credentials/src/index.ts) | 此包的公开入口；聚合导出或定义对应的服务、插件。 |
| [src/types.ts](packages/credentials/credentials/src/types.ts) | Client-safe type surface of the credential seam: the two key brands, the stored-record union, the reference view crossing the Remote wire, and the seam's Cordis event declarations. Types only — no runtime code, and nothing here reaches a Host-only symbol, so a Client compilation face reads exactly the signature the Host emits. |

## @deepseek-ai/dsh-fs

Abstract filesystem capability seam (ctx.fs) for the DeepSeek Harness — vocabulary types, the FileSystem service (text IO + optional version-guarded atomic mutations), and the fs/* policy event vocabulary

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/index.ts](packages/fs/fs/src/index.ts) | 此包的公开入口；聚合导出或定义对应的服务、插件。 |
| [src/types.ts](packages/fs/fs/src/types.ts) | Vocabulary for the filesystem Service Definition (`ctx.fs`): the opaque target/version identities, the metadata `stat` returns, the write-intent and outcome shapes, the literal-edit request/outcome, and the typed error taxonomy. |

## @deepseek-ai/dsh-host-plugin-inventory

Read-only Remote projection of current Cordis Loader plugin state

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/types.ts](packages/host/plugin-inventory/src/types.ts) | types 模块的实现与类型；由同包入口或相邻模块引用。 |

## @deepseek-ai/dsh-host-webserver

Web route-registration plugin: HTTP and upgrade routes, index transform taps, and static dist fallback; knows no harness concepts

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/index.ts](packages/host/webserver/src/index.ts) | 此包的公开入口；聚合导出或定义对应的服务、插件。 |
| [src/injections.ts](packages/host/webserver/src/injections.ts) | Structured index injections: the typed rows plugins contribute to the boot HTML instead of raw `tapIndex` string transforms. Rows are pure JSON-serializable data because one table feeds two renderers: the served form renders rows into the index.html text ({@link renderIndexInjections}), and a static worker deployment ships the same rows over its boot payload for a page-side interpreter. Anything not expressible as a row stays on `tapIndex`, which runs after row rendering. |

## @deepseek-ai/dsh-anonymous-user-id

Shared anonymous user identity for DeepSeek Harness telemetry and feedback correlation

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/index.ts](packages/identity/anonymous-user-id/src/index.ts) | 此包的公开入口；聚合导出或定义对应的服务、插件。 |

## @deepseek-ai/dsh-user-approval

User-approval seam (ctx.approval) for the DeepSeek Harness: one-shot permission decisions dispatched to composed answerers over the approval/request waterfall, fail-closed by default

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/index.ts](packages/interaction/user-approval/src/index.ts) | 此包的公开入口；聚合导出或定义对应的服务、插件。 |
| [src/types.ts](packages/interaction/user-approval/src/types.ts) | Wire-safe approval identifiers and outcome vocabulary, free of cordis/service imports so browser type chains can consume them without loading this package's Context augmentation. |

## @deepseek-ai/dsh-deepseek-llm-api-extensions

Additive request-field registry for the official DeepSeek LLM API adapter

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/index.ts](packages/llm/deepseek-llm-api-extensions/src/index.ts) | 此包的公开入口；聚合导出或定义对应的服务、插件。 |
| [src/types.ts](packages/llm/deepseek-llm-api-extensions/src/types.ts) | Provider-specific JSON and contribution types for DeepSeek request extensions. |

## @deepseek-ai/dsh-llm

Provider-neutral LLM service interface for the DeepSeek Harness

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/adapter-failure.ts](packages/llm/llm/src/adapter-failure.ts) | Normalization for values thrown by a final LLM adapter boundary. |
| [src/api-key.ts](packages/llm/llm/src/api-key.ts) | The one definition of a well-formed provider API key, shared by every adapter that puts one in an HTTP header. |
| [src/assembler.ts](packages/llm/llm/src/assembler.ts) | Incremental chunk-to-message assembler. This is the single canonical assembly algorithm used by the agent loop to build an assistant message from a chunk stream while logging the raw chunks for replay fidelity. |
| [src/assistant-stream.ts](packages/llm/llm/src/assistant-stream.ts) | Lossless compact representation of one model-stream attempt, plus record-level readers that answer common consumer questions without materializing members. Readers trust the static record type; expandAssistantStream is the validating path for records read at a durable boundary. |
| [src/attribution.ts](packages/llm/llm/src/attribution.ts) | 为模型请求补充框架版本等调用归属信息。 |
| [src/brand.ts](packages/llm/llm/src/brand.ts) | dsh-llm's owned branded ids: tool-call correlation and provider request diagnostics. The `Branded<B>` primitive and stateless constructor live in `@deepseek-ai/dsh-brand` so every owner of a cross-boundary id can brand it without depending on dsh-llm; see that package's README for the nominal-typing policy. |
| [src/call-config.ts](packages/llm/llm/src/call-config.ts) | Conversation call configuration and freeze utilities. Provider routing, model, reasoning effort, and sampling values are request-header state that can affect cache reuse; request waterfalls replace them and the loop logs changed snapshots instead of allowing silent per-call drift. |
| [src/content.ts](packages/llm/llm/src/content.ts) | Content-block structure helpers. @module @deepseek-ai/dsh-llm/content |
| [src/error.ts](packages/llm/llm/src/error.ts) | Harness error base with a stable machine-routable code and chained cause. Package errors extend it so tool results and replay can retain failure class. |
| [src/index.ts](packages/llm/llm/src/index.ts) | 此包的公开入口；聚合导出或定义对应的服务、插件。 |
| [src/message.ts](packages/llm/llm/src/message.ts) | Message value types, identity, and immutable construction helpers. |
| [src/retry-policy.ts](packages/llm/llm/src/retry-policy.ts) | Provider-owned request-retry policy configuration and resolution. Adapters expose one resolved policy per registered provider route; the optional dsh-llm-retry plugin executes it on the agent's failed-step extension point. |
| [src/types.ts](packages/llm/llm/src/types.ts) | Canonical provider-neutral message and streaming vocabulary for the loop, session log, and plugins. Adapters alone translate provider wire messages; mapped interfaces make the content, source, and finish unions extensible. |

## @deepseek-ai/dsh-llm-deepseek

DeepSeek Messages adapter

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/adapter.ts](packages/llm/llm-deepseek/src/adapter.ts) | Direct Messages transport with one cancellable lifecycle per model request. |
| [src/config.ts](packages/llm/llm-deepseek/src/config.ts) | Plugin configuration and complete request-local resolution for DeepSeek. |
| [src/defaults.ts](packages/llm/llm-deepseek/src/defaults.ts) | Shared provider limits and Chat Files API defaults. |
| [src/file-id.ts](packages/llm/llm-deepseek/src/file-id.ts) | DeepSeek Files API identifiers. @module dsh-llm-deepseek/file-id |
| [src/file-store.ts](packages/llm/llm-deepseek/src/file-store.ts) | DeepSeek Files API upload reuse, invalidation, and quota recovery. @module dsh-llm-deepseek/file-store |
| [src/files-api.ts](packages/llm/llm-deepseek/src/files-api.ts) | DeepSeek Files API transport. @module dsh-llm-deepseek/files-api |
| [src/host.ts](packages/llm/llm-deepseek/src/host.ts) | Shared Host wiring for the DeepSeek protocol adapter. |
| [src/image-tokens.ts](packages/llm/llm-deepseek/src/image-tokens.ts) | DeepSeek vision-token accounting: the provider's published image-token calculator (api-docs.deepseek.com, Token & Token Usage) ported verbatim in its current `v41` configuration. The provider scales an image below 544×544 total pixels up, aligns it to a 14px-patch grid, downsamples 3:1 per axis into token cells, and caps one image at 1024 tokens by solving the largest aspect-preserving grid inside that budget. The count is exact: this configuration has no alignment pad and no aspect-ratio clamp. Actual usage remains authoritative. |
| [src/images.ts](packages/llm/llm-deepseek/src/images.ts) | Deterministic Messages image preparation for Files references and bounded inline fallback. |
| [src/index.ts](packages/llm/llm-deepseek/src/index.ts) | 此包的公开入口；聚合导出或定义对应的服务、插件。 |
| [src/messages-api.ts](packages/llm/llm-deepseek/src/messages-api.ts) | Shared DeepSeek Messages API endpoint and header policy. @module dsh-llm-deepseek/messages-api |
| [src/model-info.ts](packages/llm/llm-deepseek/src/model-info.ts) | Protocol-independent model capabilities and reasoning choices. |
| [src/models.ts](packages/llm/llm-deepseek/src/models.ts) | Default DeepSeek model catalog. |
| [src/replay.ts](packages/llm/llm-deepseek/src/replay.ts) | Minimal native thinking metadata; durable Harness blocks own all response text. |
| [src/request-extensions.ts](packages/llm/llm-deepseek/src/request-extensions.ts) | Prepare plugin-contributed request fields and commit their delivery after HTTP acceptance. |
| [src/request-files.ts](packages/llm/llm-deepseek/src/request-files.ts) | Shared Files resolution, bounded stale-id recovery, and normalized-image diagnostics. |
| [src/request-pricing.ts](packages/llm/llm-deepseek/src/request-pricing.ts) | Provider-side request-image pricing for DeepSeek routes: prices every retained surface occurrence at its per-model request target with the published vision-token accounting, and every occurrence the surface marks offloaded as its placeholder text. Consumed synchronously by the token meter through `LlmAdapter.imageRequestPricing`; provider usage remains the authoritative anchor for completed requests. |
| [src/serialize.ts](packages/llm/llm-deepseek/src/serialize.ts) | Map system snapshots, tool changes, and conversation turns to Messages using the configured route capability. |
| [src/sse.ts](packages/llm/llm-deepseek/src/sse.ts) | SSE framing delegated to eventsource-parser; JSON errors remain provider failures. |
| [src/translate.ts](packages/llm/llm-deepseek/src/translate.ts) | Translate Messages events while preserving block order and cumulative usage. |
| [src/transport.ts](packages/llm/llm-deepseek/src/transport.ts) | Normalize HTTP and in-band Messages errors into provider-neutral failures. |
| [src/types.ts](packages/llm/llm-deepseek/src/types.ts) | Model catalog and request-local dependencies for DeepSeek Messages. |
| [src/upload-index.ts](packages/llm/llm-deepseek/src/upload-index.ts) | Durable DeepSeek attachment-to-file-id index. @module dsh-llm-deepseek/upload-index |
| [src/wire-types.ts](packages/llm/llm-deepseek/src/wire-types.ts) | DeepSeek's supported subset of the Anthropic Messages request protocol. |

## @deepseek-ai/dsh-llm-deepseek-api-key

DeepSeek api-key provider authentication and discovery

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/config.ts](packages/llm/llm-deepseek-api-key/src/config.ts) | API-key configuration resolved together with one Messages endpoint generation. |
| [src/index.ts](packages/llm/llm-deepseek-api-key/src/index.ts) | 此包的公开入口；聚合导出或定义对应的服务、插件。 |

## @deepseek-ai/dsh-ptc-runtime

Abstract PTC execution seam (ctx.ptcRuntime) for the DeepSeek Harness

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/index.ts](packages/ptc-runtime/ptc-runtime/src/index.ts) | 此包的公开入口；聚合导出或定义对应的服务、插件。 |
| [src/types.ts](packages/ptc-runtime/ptc-runtime/src/types.ts) | Vocabulary types for the PTC execution seam: what a caller hands a {@link ../index.ts / PtcRuntime} and what it gets back. Pure types — no runtime code lives here. |

## @deepseek-ai/dsh-sandbox

Abstract process-sandbox seam (ctx.sandbox) for the DeepSeek Harness: same-world confinement vocabulary and the SandboxProvider contract

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/diagnostics.ts](packages/sandbox/sandbox/src/diagnostics.ts) | Classify observed sandbox runner failures and file-effect denials. |
| [src/escalation.ts](packages/sandbox/sandbox/src/escalation.ts) | The escalation vocabulary and choreography shared by every sandbox-enforcing tool family (`@deepseek-ai/dsh-tool-bash`, `@deepseek-ai/dsh-tool-fs`): the strictly-wider ladder, the argument-pairing validation, the model-facing denial/hint markers, and {@link approveEscalation} — the ordered fail-closed sequence that resolves a `sandbox_permissions` request through a user-approval channel BEFORE anything executes. One home keeps the two families' approval ordering and verbatim error texts from drifting apart. The channel is a minimal STRUCTURAL function shape ({@link EscalationAsk}), not the approval service type: the tool layer — which owns the agent, the call id, and the tool name — closes over `ctx.approval.request(...)` and hands the closure down, so this package never depends on the approval or agent packages. |
| [src/index.ts](packages/sandbox/sandbox/src/index.ts) | 此包的公开入口；聚合导出或定义对应的服务、插件。 |
| [src/roots.ts](packages/sandbox/sandbox/src/roots.ts) | The writable-root derivation shared by every enforcement dialect that expresses a mode as a canonical allow-list: `workspace-write` means "the workspace root plus the platform temp areas", and this module is that meaning's one home. The Seatbelt profile (`@deepseek-ai/dsh-sandbox-local`) and the in-process filesystem fence (`@deepseek-ai/dsh-fs-sandbox`) both derive their allow-list here, so "the write tool cannot write /tmp but bash can" asymmetries cannot arise between them. The bwrap and Landlock dialects keep their own grant spellings (an ephemeral `/tmp` mount, launcher-owned flags) — the honest per-runner differences recorded in the sandbox RFC — with parity pinned by test. |

## @deepseek-ai/dsh-sandbox-policy

Per-call sandbox policy resolver and current model context: deployment fallbacks plus each session's mode and workspace root, shared by every enforcing capability family

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/index.ts](packages/sandbox/sandbox-policy/src/index.ts) | 此包的公开入口；聚合导出或定义对应的服务、插件。 |
| [src/session-mode.ts](packages/sandbox/sandbox-policy/src/session-mode.ts) | Per-session sandbox-mode override: the session log as the store. A runtime switch (a UI policy control or test scenario) is recorded as one `sandbox/mode` event on the session it applies to; `effective = projection state ?? the deployment default`, so an override survives restart by replay, two sessions can never see each other's state, and there is no external config store. The event is log-only (the `approval/*` precedent): the policy owner projects the fold into each model request, while enforcing tools report operation-specific boundary markers. EXECUTION honors the same fold through `ctx.sandboxPolicy.resolve()` — it stamps the mode together with the calling session's workspace root onto each capability call, weakest-precedence beneath an escalation grant. The override is policy state shared by every enforcing family (bash and filesystem alike), so it lives here in the policy package rather than in any one capability's seam. |

## @deepseek-ai/dsh-session-persistence

Abstract durable session persistence seam (ctx.sessionPersistence) for the DeepSeek Harness

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/errors.ts](packages/session/session-persistence/src/errors.ts) | Stable failures exposed by the session-persistence service and its handles, including the format refusals shared by every backend: a stored log this build cannot faithfully interpret is refused, never misread, and the refusal points at the raw artifact when the backend keeps one per session. |
| [src/handle.ts](packages/session/session-persistence/src/handle.ts) | The per-session storage handle: one open channel onto a stored session's append-only event log, returned by `SessionPersistence.create`/`open`. |
| [src/index.ts](packages/session/session-persistence/src/index.ts) | 此包的公开入口；聚合导出或定义对应的服务、插件。 |
| [src/revision.ts](packages/session/session-persistence/src/revision.ts) | Opaque revision identity for lightweight persistence observations. |
| [src/storage-contract.ts](packages/session/session-persistence/src/storage-contract.ts) | Backend-shared storage validation: the version gate, the fail-closed event vocabulary, append-batch materialization, and contiguity — one place so every backend refuses the same inputs identically. |

## @deepseek-ai/dsh-session-projection

Session-projection seam: the merge-extensible projection type table, the provider contract, and the ctx.sessionProjections registry serving whole current values of log-derived per-session state

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/index.ts](packages/session/session-projection/src/index.ts) | 此包的公开入口；聚合导出或定义对应的服务、插件。 |
| [src/types.ts](packages/session/session-projection/src/types.ts) | Pure-type outlet of the session-projection Service Definition: the one projection type table, importable from client aggregates without dragging the host-side cordis Context merges of the package root (dsh-agent → dsh-session). Domain packages may declare-merge through either the package root or this outlet — re-export preserves symbol identity, so both land on the same table. |

## @deepseek-ai/dsh-working-directory

Session working directories with durable changes and model context

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/index.ts](packages/session/working-directory/src/index.ts) | 此包的公开入口；聚合导出或定义对应的服务、插件。 |

## @deepseek-ai/dsh-settings

Abstract user-settings seam (ctx.settings) for the DeepSeek Harness

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/index.ts](packages/settings/settings/src/index.ts) | 此包的公开入口；聚合导出或定义对应的服务、插件。 |
| [src/redact.ts](packages/settings/settings/src/redact.ts) | Structural secret redaction for settings values. `role('secret')` fields are removed from a value before it crosses a wire boundary; a sidecar records each schema-declared secret position and whether it currently holds a value, so a configuration surface can render a write-only input without ever receiving the secret itself. |
| [src/schema.ts](packages/settings/settings/src/schema.ts) | Derive editable forms and plain values from plugin Config schemas. |
| [src/types.ts](packages/settings/settings/src/types.ts) | Client-safe configuration form views and change notifications. |

## @deepseek-ai/dsh-storage

Storage hub (ctx.storage): named backend registry plus mounted data-form facilities for the DeepSeek Harness

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/backend.ts](packages/storage/storage/src/backend.ts) | Backend-facing vocabulary of the storage hub: a backend owns one medium (a file-tree root, a database file) and exposes operation groups over it. This module defines the normative contract text for backend implementers; the shared conformance suite in `tests/contract.ts` checks every rule. |
| [src/error.ts](packages/storage/storage/src/error.ts) | Error vocabulary for the storage hub and its backends. |
| [src/index.ts](packages/storage/storage/src/index.ts) | 此包的公开入口；聚合导出或定义对应的服务、插件。 |
| [src/registry.ts](packages/storage/storage/src/registry.ts) | Named backend registry of the storage hub. |

## @deepseek-ai/dsh-storage-domain

Domain data form (ctx.storage.domain): schema-validated, event-emitting KV domains over storage backends for the DeepSeek Harness

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/domain.ts](packages/storage/storage-domain/src/domain.ts) | Runtime of one open domain: authoritative in-memory state, the single per-domain write chain, and change-event emission. Reads are synchronous from memory; every write queues on the chain, awaits backend durability FIRST, then mutates memory, then emits `domain/changed` — a rejected backend write leaves memory untouched (no divergence between reads and the medium), and events carry values that equal the in-memory state at emission, in write order. |
| [src/error.ts](packages/storage/storage-domain/src/error.ts) | Error vocabulary of the domain data form. |
| [src/events.ts](packages/storage/storage-domain/src/events.ts) | Change-event vocabulary of the domain data form. Every durable write emits one event after the backend resolves durability, carrying the new snapshot and an operation discriminant — never the old value (a diffing consumer keeps its own previous snapshot). This is the event source for cross-process change push (RPC frames) in a later phase. |
| [src/index.ts](packages/storage/storage-domain/src/index.ts) | 此包的公开入口；聚合导出或定义对应的服务、插件。 |
| [src/spec.ts](packages/storage/storage-domain/src/spec.ts) | Domain declaration vocabulary. A spec object is the single source of a domain's identity, layout, and record schemas: the owning package defines it once with {@link defineDomain} and both the type surface and the runtime (validation, descriptor projection) derive from it. Record schemas are zod (`z.infer` keeps types un-duplicated and the same schemas later project to RPC wire schemas); plugin `Config` stays schemastery. |

## @deepseek-ai/dsh-subprocess

Subprocess seam (ctx.subprocess) for the DeepSeek Harness — managed process groups, bounded spill-backed output, and escalated kills behind one abstract service

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/index.ts](packages/subprocess/subprocess/src/index.ts) | 此包的公开入口；聚合导出或定义对应的服务、插件。 |
| [src/types.ts](packages/subprocess/subprocess/src/types.ts) | Vocabulary for the subprocess Service Definition: fully-specified spawn requests with Node-shaped per-stream stdio modes, bounded collected output with spill recovery, raw piped streams, and managed-range termination. Command defaulting, shell semantics, protocol framing, and presentation belong to consumers such as the bash executor seam. |
| [src/control.ts](packages/subprocess/subprocess/src/control.ts) | 官方受管子进程控制通道协议，供 runner 与父进程共享。 |

## @deepseek-ai/dsh-typert-protocol

Compiler-independent Remote metadata and Typert provider protocols

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/index.ts](packages/typert/protocol/src/index.ts) | 此包的公开入口；聚合导出或定义对应的服务、插件。 |
| [src/json-value.ts](packages/typert/protocol/src/json-value.ts) | Lossless JSON checks every Remote carrier shares: the Client handle before it queues an uplink item, the Gateway at its wire and codec-less uplink boundaries, and the in-process mock. |
| [src/owned-value.ts](packages/typert/protocol/src/owned-value.ts) | Generic invocation-owned values returned by synchronous Client Context resolvers. |
| [src/principal.ts](packages/typert/protocol/src/principal.ts) | Reads the non-owner caller of the current Remote call. |
| [src/remote-access.ts](packages/typert/protocol/src/remote-access.ts) | Resources of Remote access control: the built-in identity-less `global` resource and one resource per identity of a kind declared in `TypertResourceMap`. Resources are independent: access to one resource implies no access to any other. |
| [src/remote-error.ts](packages/typert/protocol/src/remote-error.ts) | The one Remote failure class shared by owners, the Gateway, and consumers. |
| [src/remote-info.ts](packages/typert/protocol/src/remote-info.ts) | Lazy assembly of generated Remote definitions using caller-supplied Zod; no runtime imports. |
| [src/types.ts](packages/typert/protocol/src/types.ts) | Compiler-independent Typert protocol shared by business packages, generated Remote artifacts, the Host Gateway, and Client API implementations. |

## @deepseek-ai/dsh-atomic-write

Zero-dependency atomic file replacement: exclusive-create random-suffix temp + rename carrying the caller-stated permissions (writeFileAtomic)

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/index.ts](packages/util/atomic-write/src/index.ts) | 此包的公开入口；聚合导出或定义对应的服务、插件。 |

## @deepseek-ai/dsh-brand

Stateless branded primitive types for the DeepSeek Harness

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/index.ts](packages/util/brand/src/index.ts) | 此包的公开入口；聚合导出或定义对应的服务、插件。 |

## @deepseek-ai/dsh-util-crypto

Zero-dependency browser-safe UUID and byte-encoding helpers

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/index.ts](packages/util/crypto/src/index.ts) | 此包的公开入口；聚合导出或定义对应的服务、插件。 |

## @deepseek-ai/dsh-home-paths

Shared filesystem path helpers for the DeepSeek Harness

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/index.ts](packages/util/home-paths/src/index.ts) | 此包的公开入口；聚合导出或定义对应的服务、插件。 |

## @deepseek-ai/dsh-http-proxy

Process-wide outbound HTTP proxy policy for DeepSeek Harness: resolve it from the launch environment and install it as undici's global dispatcher

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/index.ts](packages/util/http-proxy/src/index.ts) | 此包的公开入口；聚合导出或定义对应的服务、插件。 |
| [src/install.ts](packages/util/http-proxy/src/install.ts) | Proxy installation: the transport half of this package. It owns undici's global dispatcher and the process-wide record of which policy is active. `undici` is imported dynamically so the pure {@link ProxyPolicy} half stays loadable where no Node transport exists, matching how `dsh-web-fetch-http` defers its own transport import. |
| [src/policy.ts](packages/util/http-proxy/src/policy.ts) | Proxy policy resolution: the pure, transport-free half of this package. It turns the launch environment into one {@link ProxyPolicy}, and answers which proxy (if any) a given URL goes through. Nothing here imports `undici`, so the module stays loadable in the browser-worker runtime that evaluates `dsh-web-fetch-http` without a Node transport. |

## @deepseek-ai/dsh-launch-environment

Immutable DeepSeek Harness launch environment that records which layer supplied each value

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/index.ts](packages/util/launch-environment/src/index.ts) | 此包的公开入口；聚合导出或定义对应的服务、插件。 |

## @deepseek-ai/dsh-package-manifest

Shared type declarations for package.json.dsh configuration fields

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/index.ts](packages/util/package-manifest/src/index.ts) | 此包的公开入口；聚合导出或定义对应的服务、插件。 |
| [src/types.ts](packages/util/package-manifest/src/types.ts) | Shared declarations for package.json fields and plugin display metadata. Each reader owns JSON validation and resolved defaults. |

## @deepseek-ai/dsh-timeout

Zero-dependency timeout/deadline primitive: clampTimeout, deadline, timeoutOf, TimeoutReason (timing + classification only, no termination)

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/index.ts](packages/util/timeout/src/index.ts) | 此包的公开入口；聚合导出或定义对应的服务、插件。 |

## @deepseek-ai/dsh-util-values

Duplicate-install-safe value primitives for the DeepSeek Harness

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/index.ts](packages/util/values/src/index.ts) | 此包的公开入口；聚合导出或定义对应的服务、插件。 |
| [src/partial-json.ts](packages/util/values/src/partial-json.ts) | Lazily scanned view of one JSON object's top-level fields, built from text that may still be streaming or from an already parsed object. Nothing is scanned until a reader asks; the view remembers every question it answered and reports changed answers when the owner refreshes for publication. Used for model tool-call arguments: a row reads the fields it cares about at whatever granularity it displays, at every stage of the call. |

## @deepseek-ai/dsh-workspace

Workspace entity registry (ctx.workspaceRegistry): durable workspace records with validated session attachment over the domain data form for the DeepSeek Harness

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/entity.ts](packages/workspace/workspace/src/entity.ts) | Package-private workspace entity: the single {@link Workspace} implementation. Holds a record snapshot that is swapped in place after each durable mutation; every write funnels through the private `mutate` so `updatedAt` stamping and invalid-account pruning happen exactly once. Not re-exported from the package entrypoint — consumers see only the `Workspace` interface. |
| [src/index.ts](packages/workspace/workspace/src/index.ts) | 此包的公开入口；聚合导出或定义对应的服务、插件。 |
| [src/paths.ts](packages/workspace/workspace/src/paths.ts) | Path canonicalization for workspace identity. |
| [src/spec.ts](packages/workspace/workspace/src/spec.ts) | The workspace domain declaration: record schema and the `defineDomain` spec the registry opens. The zod schema validates the shipped format at the durability boundary and is the direct source of a future RPC wire projection. |
| [src/types.ts](packages/workspace/workspace/src/types.ts) | Public type vocabulary of the workspace entity: the `WorkspaceId` brand and the `Workspace` consumer interface. Types only — the `WorkspaceId` factory lives in `index.ts` (this file carries no runtime code). |

## @deepseek-ai/cordis

Meta-Framework for Modern JavaScript Applications

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/context.ts](vendor/cordis/src/context.ts) | context 模块的实现与类型；由同包入口或相邻模块引用。 |
| [src/events.ts](vendor/cordis/src/events.ts) | events 模块的实现与类型；由同包入口或相邻模块引用。 |
| [src/fiber.ts](vendor/cordis/src/fiber.ts) | fiber 模块的实现与类型；由同包入口或相邻模块引用。 |
| [src/index.ts](vendor/cordis/src/index.ts) | 此包的公开入口；聚合导出或定义对应的服务、插件。 |
| [src/logger.ts](vendor/cordis/src/logger.ts) | logger 模块的实现与类型；由同包入口或相邻模块引用。 |
| [src/reflect.ts](vendor/cordis/src/reflect.ts) | reflect 模块的实现与类型；由同包入口或相邻模块引用。 |
| [src/registry.ts](vendor/cordis/src/registry.ts) | registry 模块的实现与类型；由同包入口或相邻模块引用。 |
| [src/service.ts](vendor/cordis/src/service.ts) | service 模块的实现与类型；由同包入口或相邻模块引用。 |
| [src/utils.ts](vendor/cordis/src/utils.ts) | utils 模块的实现与类型；由同包入口或相邻模块引用。 |

## @deepseek-ai/cosmokit

A collection of common utilities

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/array.ts](vendor/cosmokit/src/array.ts) | array 模块的实现与类型；由同包入口或相邻模块引用。 |
| [src/index.ts](vendor/cosmokit/src/index.ts) | 此包的公开入口；聚合导出或定义对应的服务、插件。 |
| [src/misc.ts](vendor/cosmokit/src/misc.ts) | String/symbol keyed dictionary type. |
| [src/string.ts](vendor/cosmokit/src/string.ts) | Uppercase the first character of a string. |
| [src/time.ts](vendor/cosmokit/src/time.ts) | Time constants plus parsing and formatting helpers. |
| [src/types.ts](vendor/cosmokit/src/types.ts) | types 模块的实现与类型；由同包入口或相邻模块引用。 |
| [src/volatile.ts](vendor/cosmokit/src/volatile.ts) | Shared config references used by schema validators and plugin runtimes. |

## @deepseek-ai/cordis-plugin-group

Nested plugin group for cordis

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/index.ts](vendor/group/src/index.ts) | 此包的公开入口；聚合导出或定义对应的服务、插件。 |

## @deepseek-ai/cordis-plugin-include

Include files in cordis configurations

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/index.ts](vendor/include/src/index.ts) | 此包的公开入口；聚合导出或定义对应的服务、插件。 |

## @deepseek-ai/cordis-plugin-loader

Plugin loader for cordis

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/config/diff.ts](vendor/loader/src/config/diff.ts) | Compare raw plugin configs using schema metadata without executing config hooks or validators. |
| [src/config/entry.ts](vendor/loader/src/config/entry.ts) | entry 模块的实现与类型；由同包入口或相邻模块引用。 |
| [src/config/group.ts](vendor/loader/src/config/group.ts) | group 模块的实现与类型；由同包入口或相邻模块引用。 |
| [src/config/isolate.ts](vendor/loader/src/config/isolate.ts) | isolate 模块的实现与类型；由同包入口或相邻模块引用。 |
| [src/config/tree.ts](vendor/loader/src/config/tree.ts) | tree 模块的实现与类型；由同包入口或相邻模块引用。 |
| [src/config/utils.ts](vendor/loader/src/config/utils.ts) | utils 模块的实现与类型；由同包入口或相邻模块引用。 |
| [src/index.ts](vendor/loader/src/index.ts) | 此包的公开入口；聚合导出或定义对应的服务、插件。 |
| [src/internal.ts](vendor/loader/src/internal.ts) | internal 模块的实现与类型；由同包入口或相邻模块引用。 |

## @deepseek-ai/schemastery

Type driven schema validator

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/index.ts](vendor/schemastery/src/index.ts) | 此包的公开入口；聚合导出或定义对应的服务、插件。 |

## @deepseek-ai/cordis-plugin-timer

Timer service for cordis

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/index.ts](vendor/timer/src/index.ts) | 此包的公开入口；聚合导出或定义对应的服务、插件。 |

## @deepseek-ai/dsh-mcp-client

MCP client bridge: connects to MCP servers and registers their tools on ctx.tools

| 文件 | 作用 |
| --- | --- |
| [src/connection.ts](packages/mcp/mcp-client/src/connection.ts) | 监督连接、首次工具发现、重连和工具注册的代际生命周期。 |
| [src/index.ts](packages/mcp/mcp-client/src/index.ts) | MCP 插件/服务公开入口，定义配置、依赖和生命周期。 |
| [src/server-context.ts](packages/mcp/mcp-client/src/server-context.ts) | 把服务端说明和可选资源提供方接入框架上下文。 |
| [src/tools.ts](packages/mcp/mcp-client/src/tools.ts) | 发现 MCP 工具，生成稳定公开名称，转换参数、结果与错误。 |
| [src/transport.ts](packages/mcp/mcp-client/src/transport.ts) | 按配置创建 stdio 或 Streamable HTTP 传输，并清理子进程环境。 |

## @deepseek-ai/dsh-mcp-resources

Scoped MCP resource discovery and reading through shared model tools

| 文件 | 作用 |
| --- | --- |
| [src/index.ts](packages/mcp/mcp-resources/src/index.ts) | MCP 插件/服务公开入口，定义配置、依赖和生命周期。 |
| [src/render.ts](packages/mcp/mcp-resources/src/render.ts) | MCP 客户端与资源桥接的内部实现。 |
| [src/tools.ts](packages/mcp/mcp-resources/src/tools.ts) | 发现 MCP 工具，生成稳定公开名称，转换参数、结果与错误。 |

## @deepseek-ai/dsh-skill

Agent skill provider registry for the DeepSeek Harness

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/index.ts](packages/skill/skill/src/index.ts) | 保留官方实现和原始注释。 |

## @deepseek-ai/dsh-skill-filesystem

Local filesystem skill provider for the DeepSeek Harness

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/index.ts](packages/skill/skill-filesystem/src/index.ts) | 保留官方实现和原始注释。 |

## @deepseek-ai/dsh-tool-skill

Model-facing skill loading tool for the DeepSeek Harness

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/index.ts](packages/skill/tool-skill/src/index.ts) | 保留官方实现和原始注释。 |

## @deepseek-ai/dsh-fs-local

Local-filesystem implementation of the DeepSeek Harness filesystem seam (ctx.fs)

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/fsio.ts](packages/fs/fs-local/src/fsio.ts) | 保留官方实现和原始注释。 |
| [src/index.ts](packages/fs/fs-local/src/index.ts) | 保留官方实现和原始注释。 |
| [src/win32.ts](packages/fs/fs-local/src/win32.ts) | 保留官方实现和原始注释。 |

## @deepseek-ai/dsh-shell

Abstract bash executor seam (ctx.shell) for the DeepSeek Harness

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/index.ts](packages/shell/shell/src/index.ts) | 保留官方实现和原始注释。 |
| [src/render.ts](packages/shell/shell/src/render.ts) | 保留官方实现和原始注释。 |
| [src/types.ts](packages/shell/shell/src/types.ts) | 保留官方实现和原始注释。 |

## @deepseek-ai/dsh-bash-local

Local-subprocess implementation of the DeepSeek Harness bash executor seam

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/index.ts](packages/shell/bash-local/src/index.ts) | 保留官方实现和原始注释。 |

## @deepseek-ai/dsh-tool-bash

Model-facing bash tool with optional generic background-job and sandbox-escalation support

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/background.ts](packages/shell/tool-bash/src/background.ts) | 保留官方实现和原始注释。 |
| [src/index.ts](packages/shell/tool-bash/src/index.ts) | 保留官方实现和原始注释。 |
| [src/render.ts](packages/shell/tool-bash/src/render.ts) | 保留官方实现和原始注释。 |

## @deepseek-ai/dsh-shell-env

Tool-independent managed DSH_* shell environment registry

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/index.ts](packages/shell/shell-env/src/index.ts) | 保留官方实现和原始注释。 |

## @deepseek-ai/dsh-subprocess-local

Local-subprocess implementation of the DeepSeek Harness subprocess seam

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/bin.ts](packages/subprocess/subprocess-local/src/bin.ts) | 保留官方实现和原始注释。 |
| [src/control-spawn.ts](packages/subprocess/subprocess-local/src/control-spawn.ts) | 保留官方实现和原始注释。 |
| [src/index.ts](packages/subprocess/subprocess-local/src/index.ts) | 保留官方实现和原始注释。 |
| [src/linux-execve.ts](packages/subprocess/subprocess-local/src/linux-execve.ts) | 保留官方实现和原始注释。 |
| [src/linux-scope-selector.ts](packages/subprocess/subprocess-local/src/linux-scope-selector.ts) | 保留官方实现和原始注释。 |
| [src/linux-scope.ts](packages/subprocess/subprocess-local/src/linux-scope.ts) | 保留官方实现和原始注释。 |
| [src/managed-owner.ts](packages/subprocess/subprocess-local/src/managed-owner.ts) | 保留官方实现和原始注释。 |
| [src/output.ts](packages/subprocess/subprocess-local/src/output.ts) | 保留官方实现和原始注释。 |
| [src/process-inspector.ts](packages/subprocess/subprocess-local/src/process-inspector.ts) | 保留官方实现和原始注释。 |
| [src/runner-launch.ts](packages/subprocess/subprocess-local/src/runner-launch.ts) | 保留官方实现和原始注释。 |
| [src/runner-protocol.ts](packages/subprocess/subprocess-local/src/runner-protocol.ts) | 保留官方实现和原始注释。 |
| [src/shell-activity.ts](packages/subprocess/subprocess-local/src/shell-activity.ts) | 保留官方实现和原始注释。 |
| [src/spawn-runner.ts](packages/subprocess/subprocess-local/src/spawn-runner.ts) | 保留官方实现和原始注释。 |
| [src/spawn.ts](packages/subprocess/subprocess-local/src/spawn.ts) | 保留官方实现和原始注释。 |
| [src/terminal.ts](packages/subprocess/subprocess-local/src/terminal.ts) | 保留官方实现和原始注释。 |
| [src/windows-inspector.ts](packages/subprocess/subprocess-local/src/windows-inspector.ts) | 保留官方实现和原始注释。 |
| [src/windows-job.ts](packages/subprocess/subprocess-local/src/windows-job.ts) | 保留官方实现和原始注释。 |

## @deepseek-ai/dsh-win32-process

Shared low-level Win32 process, stdio, and Job Object primitives

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/abi.ts](packages/subprocess/win32-process/src/abi.ts) | 保留官方实现和原始注释。 |
| [src/control-stdio.ts](packages/subprocess/win32-process/src/control-stdio.ts) | 保留官方实现和原始注释。 |
| [src/errors.ts](packages/subprocess/win32-process/src/errors.ts) | 保留官方实现和原始注释。 |
| [src/ffi.ts](packages/subprocess/win32-process/src/ffi.ts) | 保留官方实现和原始注释。 |
| [src/index.ts](packages/subprocess/win32-process/src/index.ts) | 保留官方实现和原始注释。 |
| [src/koffi.ts](packages/subprocess/win32-process/src/koffi.ts) | 保留官方实现和原始注释。 |
| [src/process.ts](packages/subprocess/win32-process/src/process.ts) | 保留官方实现和原始注释。 |

## @deepseek-ai/dsh-lazy-require

Caller-relative, success-cached lazy loading for CommonJS-compatible Host dependencies

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/index.ts](packages/util/lazy-require/src/index.ts) | 保留官方实现和原始注释。 |

## @deepseek-ai/dsh-jobs

Background job registry (ctx.jobs) for the DeepSeek Harness — shared ids, owner isolation, polling, cancellation, and completion listeners for long-running tool work

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/archive-admission.ts](packages/jobs/jobs/src/archive-admission.ts) | 保留官方实现和原始注释。 |
| [src/brand.ts](packages/jobs/jobs/src/brand.ts) | 保留官方实现和原始注释。 |
| [src/index.ts](packages/jobs/jobs/src/index.ts) | 保留官方实现和原始注释。 |
| [src/types.ts](packages/jobs/jobs/src/types.ts) | 保留官方实现和原始注释。 |
| [src/view.ts](packages/jobs/jobs/src/view.ts) | 保留官方实现和原始注释。 |

## @deepseek-ai/dsh-session-persistence-jsonl

JSONL durable session persistence backend for the DeepSeek Harness

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/catalog-migration.ts](packages/session/session-persistence-jsonl/src/catalog-migration.ts) | Collect historical discovery facts without recursively preparing related current generations. */ |
| [src/format.ts](packages/session/session-persistence-jsonl/src/format.ts) | On-disk format helpers for the JSONL session-persistence backend: path |
| [src/generation.ts](packages/session/session-persistence-jsonl/src/generation.ts) | Durable whole-generation publication for JSONL Session artifacts. |
| [src/index.ts](packages/session/session-persistence-jsonl/src/index.ts) | JSONL durable session-persistence backend. It stores a header and contiguous |
| [src/lease.ts](packages/session/session-persistence-jsonl/src/lease.ts) | Cross-process write-ownership lock for one session's artifact directory, |
| [src/migration-verifier.ts](packages/session/session-persistence-jsonl/src/migration-verifier.ts) | Isolated verification for a staged or competing current JSONL generation. */ |
| [src/storage.ts](packages/session/session-persistence-jsonl/src/storage.ts) | The JSONL provider's session storage runtime: its concrete write/read |
| [src/testing/generation.ts](packages/session/session-persistence-jsonl/src/testing/generation.ts) | Create generation operations with deterministic I/O and race seams for tests. |
| [src/win32.ts](packages/session/session-persistence-jsonl/src/win32.ts) | Windows durable namespace helpers for the JSONL backend. |
| [src/worker.ts](packages/session/session-persistence-jsonl/src/worker.ts) | Worker entry for current-generation physical and logical verification. */ |
| [src/zstd-private-decoder.ts](packages/session/session-persistence-jsonl/src/zstd-private-decoder.ts) | Node-private synchronous Zstandard frame decoder optimization. |
| [src/zstd-public-decoder.ts](packages/session/session-persistence-jsonl/src/zstd-public-decoder.ts) | Public-API synchronous Zstandard frame decoder fallback. |
| [src/zstd.ts](packages/session/session-persistence-jsonl/src/zstd.ts) | Zstandard frame primitives for the JSONL persistence backend. The backend |

## @deepseek-ai/dsh-session-format

Streaming adjacent Session format migration machinery

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/catalog.ts](packages/session/session-format/src/catalog.ts) | Compile a build-static physical codec and adjacent migration catalog. |
| [src/chain.ts](packages/session/session-format/src/chain.ts) | Validate and freeze one adjacent migration declaration. |
| [src/context.ts](packages/session/session-format/src/context.ts) | Migration output context that expands compact runs into retained events. */ |
| [src/error.ts](packages/session/session-format/src/error.ts) | Error raised when a durable Session artifact cannot be restored or migrated losslessly. */ |
| [src/filename.ts](packages/session/session-format/src/filename.ts) | Canonical raw log basename shared by every generation-addressed Session artifact. */ |
| [src/index.ts](packages/session/session-format/src/index.ts) | Pure adjacent streaming Session format migration machinery. */ |
| [src/json.ts](packages/session/session-format/src/json.ts) | Test whether a value is a non-null, non-array object. |
| [src/types.ts](packages/session/session-format/src/types.ts) | Scalar value admitted at the durable Session JSON boundary. */ |

## @deepseek-ai/dsh-session-format-catalog

Build-static first-party Session format codec and migration catalog

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/children.ts](packages/session/session-format-catalog/src/children.ts) | Bind parent-specific child evidence into the static first-party migration inventory. */ |
| [src/current.ts](packages/session/session-format-catalog/src/current.ts) | Current installed Session validation used after vocabulary-aware format restoration. */ |
| [src/generated.ts](packages/session/session-format-catalog/src/generated.ts) | GENERATED by `scripts/gen-session-format-catalog.ts` — do not edit by hand. |
| [src/historical.ts](packages/session/session-format-catalog/src/historical.ts) | Historical restoration for collecting migration prerequisites without recursively opening current Sessions. */ |
| [src/index.ts](packages/session/session-format-catalog/src/index.ts) | Build-static first-party Session format migration catalog. */ |
| [src/message-projections.ts](packages/session/session-format-catalog/src/message-projections.ts) | Pure first-party message interpreters for detached current-format replay, including browser readers. */ |

## @deepseek-ai/dsh-session-format-v2-to-v3

Streaming system-prompt, canonical-envelope and PTC migration into V3

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/codec.ts](packages/session/session-format-v2-to-v3/src/codec.ts) | V3 framing with hard structural admission and recoverable canonical event validation. */ |
| [src/index.ts](packages/session/session-format-v2-to-v3/src/index.ts) | Released-V2 codec and streaming system, canonical-envelope, and PTC migration into V3. */ |
| [src/migration.ts](packages/session/session-format-v2-to-v3/src/migration.ts) | Streaming system-prompt promotion followed by canonical V3 envelope conversion. */ |
| [src/payload.ts](packages/session/session-format-v2-to-v3/src/payload.ts) | Audited V2 migration admission and V3 payload validation, independent of installed core Session types. */ |
| [src/references.ts](packages/session/session-format-v2-to-v3/src/references.ts) | Explicit local-coordinate remapping; captured generations and owner-local counters remain opaque. */ |
| [src/validation.ts](packages/session/session-format-v2-to-v3/src/validation.ts) | Native V3 system-head validation with a private view for frozen non-system relationships. */ |

## @deepseek-ai/dsh-session-format-v1-to-v2

Frozen released-v1 Session codec and assistant-stream migration to v2

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/codec.ts](packages/session/session-format-v1-to-v2/src/codec.ts) | Frozen physical JSON codec for released v2. */ |
| [src/dispositions.ts](packages/session/session-format-v1-to-v2/src/dispositions.ts) | Exact top-level event and payload-member inventory frozen for released v2. */ |
| [src/index.ts](packages/session/session-format-v1-to-v2/src/index.ts) | Frozen released-v1 physical codec and assistant-stream migration into v2. */ |
| [src/migration.ts](packages/session/session-format-v1-to-v2/src/migration.ts) | Adjacent migration that embeds released-v1 top-level Assistant chunks into v2 attempt events. */ |
| [src/testing/validation.ts](packages/session/session-format-v1-to-v2/src/testing/validation.ts) | Validate the frozen released-v2 writer image in tests. |
| [src/validation.ts](packages/session/session-format-v1-to-v2/src/validation.ts) | Validate the exact logical header written by released v2. |

## @deepseek-ai/dsh-session-format-v0-to-v1

Frozen released-v0 Session codec and identity migration to v1

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/codec.ts](packages/session/session-format-v0-to-v1/src/codec.ts) | A released packed Assistant row retained until v1-to-v2 embeds its compact stream. */ |
| [src/dispositions.ts](packages/session/session-format-v0-to-v1/src/dispositions.ts) | Exact top-level payload disposition frozen for every released-v0 event type. */ |
| [src/index.ts](packages/session/session-format-v0-to-v1/src/index.ts) | Frozen released-v0 physical codec and identity migration into shared-layout v1. */ |
| [src/migration.ts](packages/session/session-format-v0-to-v1/src/migration.ts) | Identity format edge that promotes released v0 into released v1. */ |
| [src/payload-validation.ts](packages/session/session-format-v0-to-v1/src/payload-validation.ts) | Validate nested released payload semantics for one known event. |
| [src/relationships.ts](packages/session/session-format-v0-to-v1/src/relationships.ts) | Relationship roles added by a later format while reusing the released validator. */ |
| [src/testing/restore.ts](packages/session/session-format-v0-to-v1/src/testing/restore.ts) | Restore released v0 rows through the production decoder and v0-to-v1 stage. |
| [src/testing/validation.ts](packages/session/session-format-v0-to-v1/src/testing/validation.ts) | Validate one decoded released-v0 source artifact in tests. |
| [src/validation-helpers.ts](packages/session/session-format-v0-to-v1/src/validation-helpers.ts) | Require one plain JSON object. |
| [src/validation.ts](packages/session/session-format-v0-to-v1/src/validation.ts) | Validate the logical header shared by released v0 and v1. |

## @deepseek-ai/dsh-session-format-v3-to-v4

Streaming tool-role migration and delivery validation from Session V3 to V4

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/codec.ts](packages/session/session-format-v3-to-v4/src/codec.ts) | V4 framing with native tool-role admission and released physical rows. */ |
| [src/content.ts](packages/session/session-format-v3-to-v4/src/content.ts) | V3 content tags and request-tool fields admitted before V4 interpretation. */ |
| [src/developer.ts](packages/session/session-format-v3-to-v4/src/developer.ts) | Native V4 developer-message and deferred-tool-schema validation. */ |
| [src/extension-identities.ts](packages/session/session-format-v3-to-v4/src/extension-identities.ts) | Fixed V3 event vocabulary and namespaced historical opaque events. */ |
| [src/facts.ts](packages/session/session-format-v3-to-v4/src/facts.ts) | Historical child identity reduced to the fields required by a parent's catalog. */ |
| [src/fork-result.ts](packages/session/session-format-v3-to-v4/src/fork-result.ts) | Native V4 fork-result identity and not-started error validation. */ |
| [src/index.ts](packages/session/session-format-v3-to-v4/src/index.ts) | Tool-role V3-to-V4 migration with native V4 framing and delivery validation. */ |
| [src/message-sources.ts](packages/session/session-format-v3-to-v4/src/message-sources.ts) | Native source admission preserves unknown attribution and refuses retired plugin wrappers. */ |
| [src/migration.ts](packages/session/session-format-v3-to-v4/src/migration.ts) | Append historical child facts after converting V3 source events to V4. */ |
| [src/references.ts](packages/session/session-format-v3-to-v4/src/references.ts) | Remap released V3 local event references after interrupted-turn insertion. */ |
| [src/relationships.ts](packages/session/session-format-v3-to-v4/src/relationships.ts) | Mandatory native V4 relationships; incomplete tails retain their open transactions. */ |
| [src/retired-syntax.ts](packages/session/session-format-v3-to-v4/src/retired-syntax.ts) | Retired native syntax remains a hard refusal even after a recoverable physical-row failure. */ |
| [src/sources.ts](packages/session/session-format-v3-to-v4/src/sources.ts) | Released V3 plugin-source conversion and declared message traversal. */ |
| [src/system-message.ts](packages/session/session-format-v3-to-v4/src/system-message.ts) | Native system-message fields checked before physical recovery can discard a row. */ |
| [src/testing/validation.ts](packages/session/session-format-v3-to-v4/src/testing/validation.ts) | Validate an artifact through the native codec without vocabulary-aware restoration. |
| [src/tool-role.ts](packages/session/session-format-v3-to-v4/src/tool-role.ts) | First-class tool-role messages in the V4 representation. */ |
| [src/validation.ts](packages/session/session-format-v3-to-v4/src/validation.ts) | Native V4 metadata and generation-owned relationship validation. */ |

## @deepseek-ai/dsh-compaction-image-offload

Durable image offload for image-capable routes: replace over-budget request images with placeholders and retry

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/image-offload.ts](packages/compaction/compaction-image-offload/src/image-offload.ts) | Select and log permanent image omissions in current model-request order. */ |
| [src/index.ts](packages/compaction/compaction-image-offload/src/index.ts) | Image offload executor for the compaction seam. When an image-capable route |
| [src/project-message.ts](packages/compaction/compaction-image-offload/src/project-message.ts) | Immutable application of the image occurrences recorded by image/offload. */ |
| [src/projection.ts](packages/compaction/compaction-image-offload/src/projection.ts) | Browser-safe durable image selection declaration and pure replay definition. */ |

## @deepseek-ai/dsh-compaction

Abstract compaction service seam (ctx.compaction) for the DeepSeek Harness

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/brand.ts](packages/compaction/compaction/src/brand.ts) | Stable identity shared by one compact start/summary/checkpoint/end transaction. */ |
| [src/checkpoint.ts](packages/compaction/compaction/src/checkpoint.ts) | Compaction checkpoint source: the correlated constructor and type |
| [src/index.ts](packages/compaction/compaction/src/index.ts) | Compaction Service Definition (`ctx.compaction`): providers decide when to |
| [src/tool-pairing.ts](packages/compaction/compaction/src/tool-pairing.ts) | Tool-pairing balance over a session surface. Compaction changes surface |
| [src/types.ts](packages/compaction/compaction/src/types.ts) | Compaction vocabulary: the result type and the `compaction/*` session events. |

## @deepseek-ai/dsh-commands

Plugin-owned human command registry for DeepSeek Harness UIs

| 文件 | 作用或原始模块说明 |
| --- | --- |
| [src/brand.ts](packages/interaction/commands/src/brand.ts) | Command definition identities and execution ids for discovery and lifecycle pairing. |
| [src/index.ts](packages/interaction/commands/src/index.ts) | Plugin-owned human-command registry shared by interactive UI adapters. |
| [src/types.ts](packages/interaction/commands/src/types.ts) | Durable command event vocabulary and the registry's Cordis event |
