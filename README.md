# dsh-demo：水下通信链路仿真 Agent 与 Web 调试台

这个目录是学习用的独立项目：显式加载七个 dsh 核心插件，再接上终端或网页入口，以及五个平台的 MCP 工具。网页提供真实插件启停、原始模型数据、调用过程检查、MCP 服务注册管理和 Skill 管理；技能运行时使用官方 Skill 插件。必要的框架源码已保存在项目内部，安装和运行都不需要相邻的 `deepseek-harness`。你可以先沿着本目录理解“输入如何到达模型、工具如何执行、结果如何回到用户”。

终端和 Web Agent 默认接入五平台的 24 个 MCP 工具。本地联调先启动 HTTP Mock，再启动 Agent。

```bash
npm ci
npm run mock:platforms
# 在另一个终端执行
npm run web -- --offline
```

在网页或离线终端发送 `/mcp mcp__environment__get_environment_config` 验证调用。Agent 会通过 stdio MCP 中间层请求 HTTP 平台。工具目录、服务地址配置和文件交接见[五平台 HTTP Mock 与 MCP 接入](simulation/platform-mock/README.md)。

在真实模型模式下运行 `npm run web`，在聊天中发送 `/communication-link-simulation` 可启动分阶段确认流程。Skill 会在环境、声场、信号处理、回放和评估阶段分别询问参数，也支持在 P2/P3 用用户自有算法替代平台处理。离线模式可验证 Skill 加载，并用 `/mcp` 手动调用单项工具。[链路仿真 Skill](skills/communication-link-simulation/SKILL.md)

本地模板仿真可独立通过 `npm run simulation -- small` 运行。[本地模板仿真说明](simulation/README.md)

教学注释覆盖本目录维护的 TypeScript、JavaScript、HTML、CSS、YAML 和 `.gitignore`。代码旁的中文注释解释语法、执行时机和资源归属。JSON 不允许注释，因此 `package.json`、`tsconfig.json` 保持标准格式，本文提供逐行解释版。`.dsh/`、`node_modules/` 是运行产物与依赖。`vendor/harness/` 是随项目保存的框架源码副本，保留原有注释与许可证。

按你当前的目标阅读：

| 想做什么 | 从哪里开始 |
| --- | --- |
| 安装并启动项目 | [先运行，再看代码](#1-先运行再看代码) |
| 启停插件、查看模型原文 | [Web 调试台](#web-调试台怎么用) |
| 查看插件服务依赖 | [插件依赖关系](#查看插件依赖关系) |
| 让 Agent 执行 Bash | [官方 Bash 工具](#执行-bash-命令) |
| 体验或替换 MCP 服务 | [本机 MCP 工具](#体验本机-mcp-工具) |
| 在网页注册和管理 MCP | [MCP 服务管理](#在网页注册和管理-mcp-服务) |
| 管理和加载 Skill | [Skill 管理](#在网页管理-skill) |
| 区分官方能力与 demo 实现 | [能力来源与边界](#能力来源与边界) |
| 理解目录与每个文件 | [文件职责](#2-每个文件由谁读取负责什么) |
| 理解七个插件与启动流程 | [核心插件](#3-七个核心插件怎样协作)、[终端启动](#4-终端启动的完整顺序)、[Web 启动](#5-web-对话的完整顺序) |
| 修改 TypeScript 代码 | [服务端文件讲解](#6-逐个读懂服务端文件)、[语法入门](#11-阅读逐行注释时先掌握这些语法) |
| 检查修改或排查问题 | [验证脚本](#8-验证脚本为什么存在)、[常见问题](#13-常见问题) |

## 1. 先运行，再看代码

需要 Node `^22.19.0 || >=24.0.0` 和 npm。下面的命令从 `dsh-demo` 的父目录执行；如果终端已经位于项目内，跳过 `cd`。安装时保留默认开发依赖，TypeScript 构建需要它们。

```bash
cd dsh-demo
# 按项目自带的锁文件安装，并自动检查框架源码、生成类型声明。
npm ci
# 使用模拟模型，体验终端的多轮输入与回复。
npm run demo -- --offline
```

输入以下内容，每次按 Enter：

```text
我叫小明
我叫什么名字？
/exit
```

你会看到第二轮回显仍包含“我叫小明”和“已有回复：1 条”。这说明第二次模型请求确实拿到了先前消息。离线适配器只读取和回显请求，不理解姓名，也不会像真实模型那样回答问题。

启动网页版本：

```bash
# 复用同一套核心插件，改由网页收发消息。
npm run web -- --offline
```

在浏览器打开日志中的地址，默认是 `http://127.0.0.1:3080`。Enter 发送，Shift + Enter 换行；“新对话”会取消当前请求并释放旧会话。Ctrl+C 停止服务。端口冲突时可用 `npm run web -- --offline --port 3082`；`--port 0` 让系统自动分配空闲端口。

两个入口都会自动启动五平台 MCP 中间层。本地平台 Mock 单独用 `npm run mock:platforms` 启动。`--offline` 使用离线模型，仍可通过 `/mcp` 发送实际工具请求。终端输入 `/exit` 退出。

### 常用命令速查

以下命令都在 `dsh-demo` 根目录执行。

| 命令 | 用途 |
| --- | --- |
| `npm ci` | 根据锁文件重建依赖，自动执行框架构建。 |
| `npm run web -- --offline` | 启动离线 Web 调试台和本机 MCP 服务。 |
| `npm run demo -- --offline` | 启动离线终端对话和本机 MCP 服务。 |
| `npm run web` / `npm run demo` | 使用真实模型，需要配置 API Key。 |
| `npm run web -- --offline --port 3082` | 指定 Web 端口；`0` 表示让系统分配。 |
| `npm run config -- --offline` | 打印终端的插件组合，不启动对话。 |
| `npm run config:web -- --offline` | 打印 Web 的插件组合，不启动 HTTP 服务。 |
| `npm run build` | 检查项目内部的框架源码并生成类型声明。 |
| `npm run typecheck` | 严格检查教学入口的 TypeScript。 |
| `npm run mcp:smoke` | 验证 MCP 发现、调用、结果回传和启停恢复。 |
| `npm run mcp:management:smoke` | 验证网页注册、stdio/HTTP 连接、工具目录、持久化、凭据隐藏及重启恢复。 |
| `npm run skills:smoke` | 验证技能管理、SKILL.md 格式、真实按需加载、依赖恢复与重启持久化。 |
| `npm run standalone:smoke` | 在临时副本重新安装、构建并执行全部功能验证。 |

`npm run` 后的第一个 `--` 告诉 npm 把后面的参数交给启动脚本；`--port` 只适用于 Web 模式。其余功能测试见[第 8 节](#8-验证脚本为什么存在)。

### Web 调试台怎么用

左侧对话区按 **第 1 轮、第 2 轮……** 分组，一次发送算一轮；同轮的多次模型请求和工具调用仍放在这一轮中。每轮显示你的问题、助手说明 / 回答、独立的工具调用与结果，以及当前轮次是否完成。

工具调用前的模型文字标为“助手说明”，后续生成的答复标为“助手回答”，正文继续支持 Markdown。工具卡片显示工具名、所属步骤和执行状态，短结果直接展示；展开卡片可查看调用参数、完整工具返回内容和原始结果事件 JSON。复杂 JSON 默认折叠，避免与助手回答混在一起。参数和工具返回按纯文本展示，里面的 HTML 或 Markdown 不会作为助手回答执行或渲染。

多个工具按调用 ID 配对结果，即使并行调用乱序返回也不会串行错配。断线时保留已有回答和工具结果，尚未收到结果的调用显示“结果未确认”，不把后台可能仍在执行的任务误报为失败。轮次“已完成”只说明本次对话生成结束，平台任务状态以对应的查询工具返回为准。点击“新对话”会清空左侧并从第 1 轮重新编号。

右侧提供六个视图：

| 视图 | 可以做什么 | 数据从哪里来 |
| --- | --- | --- |
| 插件 | 按树形展开配置容器，查看并启停七个核心插件、模型适配器、MCP 客户端及官方 Skill 插件；切换依赖视图追踪服务提供者与消费者。 | Loader 的真实父子归属、enabled 和 Fiber 状态。 |
| 原始输出 | 查看完整模型分片、真实 HTTP/SSE 响应正文、请求 JSON 和模型接口返回的思考文本。 | 适配器流及同次异步调用内实际收到的 HTTP 字节。 |
| 调用过程 | 按时间查看用户消息、Agent 轮次/步骤、请求、HTTP、工具事件和结束结果；展开查看全部 payload。 | Agent 会话事件、模型中间件和传输观察器。 |
| MCP 服务 | 注册、编辑、启停、重连和删除服务，展开查看工具说明及完整参数定义。 | 真实 MCP 客户端、Loader 状态和 agent 当前 ToolRuntime。 |
| Skill 管理 | 搜索、新建、编辑、启停、复制、删除、预览与导入导出 SKILL.md。 | 网页配置、官方本地目录、调用策略和实际 skill 工具状态。 |
| 文件 | 搜索工作目录、下载上传资料和 Agent 产物，将已上传文件重新添加到消息。 | `work/` 中实际存在的文件及持久化上传回执。 |

启停插件会结束此进程中的当前会话，所有打开的网页共享这套插件状态。已捕获的调用记录继续保留，选择旧记录仍可查看或下载。“已启用”与“运行中”不同：依赖停用时，下游插件即使 enabled=true，也可能处于“等待依赖”。HTTP、Web 调试入口和当前模式不兼容的终端入口保持只读，避免把恢复开关一起关闭。

YAML 条目的开关只影响当前进程，不安装插件、不写回源码 YAML。网页注册的 MCP 条目则会同步保存启停状态。启用另一个适配器不会自动切换当前 provider；实际使用的路由仍由配置和 `--offline` 决定。页面会根据真实模型依赖是否就绪启用或禁用发送按钮。Loader 的完整 ID 可能包含 `include:` 前缀，控制接口使用列表返回的完整 ID，`key` 才是基础 YAML 中的条目 ID。

插件面板默认显示 **服务依赖树**：父节点依赖其下面的服务提供者。例如官方 Bash 的主要依赖链是：

```text
tool-bash
├── bash-local（提供 shell）
│   └── subprocess-local（提供 subprocess）
├── shell-env（提供 shellEnv）
├── working-directory（提供 workingDirectory）
│   ├── fs-local（提供 fs）
│   ├── session-projection（提供 sessionProjections）
│   └── system-prompt（提供 systemPrompt）
├── tools
└── system-prompt（共享引用）
```

实际布局以当前作用域的运行时快照为准。一个插件只出现一份完整开关，其余位置显示 **共享依赖引用**，点击可展开祖先并定位原节点。内部循环关系显示引用并停止递归；缺失服务显示单独的缺失节点；子作用域按实际状态分组，避免混同主插件需求。服务恢复或插件重载后，树会随快照更新。

点击左侧箭头折叠分支，不会停用插件或结束会话。每行状态徽标表示实际运行状态，右侧按钮用于启停。可通过 **树形关系 → 按配置归属** 查看原来的 Include/Group 挂载层级；这个辅助视图仍使用真实 `parentId`，不按 ID 字符串猜测层级。默认依赖树不再把所有插件放在 include 下面。

原始输出的四种内容分别是：

- **完整模型分片 JSON**：适配器输出的全部标准分片，包含 text、reasoning、tool-call、usage、finish 及 replayState 等实际返回字段；这是框架协议，不是原生 HTTP。
- **HTTP/SSE 响应原文**：实际收到的响应正文，包括标准转换可能忽略的供应方扩展字段；导出还保留每个网络块的 base64，可精确还原字节。只显示允许的定位响应头，不记录认证头或 Cookie。
- **完整请求 JSON**：框架层的完整消息历史、提示词、工具及生成参数，以及适配器实际序列化的 HTTP 请求正文。API Key 和 URL 中的凭据不会因调试被导出。
- **模型返回的思考文本**：仅展示模型通过接口显式返回的 reasoning 分片。未返回的内部内容不能查看或补造。默认 `thinking: disabled`，如需请求可见思考，可在基础 YAML 中改为 `thinking: enabled` 后重启真实模式，并使用支持该功能的模型。

离线模拟不访问 HTTP，因此没有真实 HTTP 响应原文；鉴权阶段就失败时也可能没有 HTTP 响应。取消或断线只会保留已经收到的部分，不会伪称后续未收到的正文已经完整捕获。这不是 TLS/网络抓包工具，原始 HTTP 视图针对模型响应正文。

数据不按长度截断，页面的高频刷新节流也不会丢弃记录。记录包含实际发送的历史和模型返回内容，只在本机进程内存中保留；可下载“完整 JSON”，或点“清空已结束记录”释放内存。清空不会删除正在生成的轮次。生成期间下载的是截至当时已捕获内容的快照，完成后可重新下载终态记录。

### 查看插件依赖关系

在右侧 **插件** 面板默认浏览依赖树，切换 **插件树 / 依赖详情**，或点击任意完整插件行右侧的 **依赖** 按钮。切换仅浏览，不启停插件，也不结束对话。

插件树的状态徽标表示实际运行状态；右侧按钮表示下一步操作。运行中的插件显示 **停用**，等待依赖的插件显示 **未运行 · 等待依赖** 和 **取消启用**。点击“取消启用”后，即使依赖恢复，该插件也不会自动启动；保持等待则会在依赖满足后自动启动。已关闭配置的插件显示 **启用**。

1. 下拉框选择一个配置插件或启动器创建的运行时节点。默认选择 `tool-skill`，可以看到它需要的 `agents`、`tools`、`skills` 和 `workingDirectory`。
2. 中间列出当前插件、运行状态和当前提供的服务；左侧是“谁依赖它”，右侧是“它依赖谁”。箭头方向是 **依赖方 → 提供方**。
3. 点击关系卡片中的插件名称可以继续追踪；展开 **查看间接依赖与完整服务关系**，可沿当前实际边查看多层关系。遍历会去重，即使存在环也不会无限展开。
4. **服务已提供** 表示已经观察到提供方注册的实现，**已绑定** 表示该消费作用域确实保留了这个实现；**服务缺失** 表示当前作用域中没有注册实现。服务提供方仍在加载/卸载时显示 **提供者未就绪**。视图不会为了检查而执行可用性检查函数或插件代码。
5. 启停后视图随原来的插件轮询刷新。曾观察到的提供者会显示为历史线索，并明确标注当前缺失；历史线索不会被当成实际依赖继续遍历。停用插件若曾经加载过，会显示缓存模块的依赖声明；从未加载的模块显示“声明未知”。

依赖数据来自 Cordis 的 `Fiber.inject`、服务实现注册和消费方的隔离标签，不按包名或配置树父子关系猜测。主插件依赖和内部 `ctx.inject()` 子作用域分开标明：例如某个可选扩展子作用域等待 `typert`，不代表主 Agent 插件已经故障。辅助的“按配置归属”模式仍只表示 Include/Group 的挂载归属，两种关系保留各自含义。

这个视图覆盖当前已创建作用域的声明式服务依赖，不宣称包含 `ctx.get()` 可选读取、npm 包依赖或尚未执行到的条件分支。启动器直接创建的 Loader 等基础设施以运行时节点显示，不伪造为 YAML 子插件。接口只返回服务名称、作用域和拥有者标识，不返回服务值、插件配置或凭据。

### 在网页注册和管理 MCP 服务

运行 `npm run web -- --offline` 后，点击右侧 **MCP 服务**。YAML 配置的五组 MCP 服务共提供 24 个工具；展开“可用工具”可以查看每个工具的模型公开名称、说明和完整参数 schema，不需要先发送聊天消息。

体验新增本机服务：

1. 点击 **填入本机示例**，会自动填好当前 Node 路径、启动参数和项目目录，并选择一个未使用的服务名。
2. 保持“保存后启用连接”勾选，点击 **保存服务**。
3. 卡片显示真实客户端状态；工具发现完成后可以展开目录。新服务使用自己的名称，例如 `mcp__local-example__get_environment_config`。
4. 使用 **停用 / 启用** 或 **重新连接** 管理连接；**编辑** 修改参数；**删除配置** 同时断开连接、移除工具和持久化记录。

注册外部服务时选择对应方式：

| 连接方式 | 填写内容 | 示例 |
| --- | --- | --- |
| stdio | 程序、JSON 参数数组、工作目录、可选环境变量对象。 | 程序 `node`，参数 `["simulation/platform-mcp/server.mjs","--platform","P1"]`，目录为本项目根目录。 |
| Streamable HTTP | MCP 的 http(s) 地址、可选 Headers 对象。 | 地址 `http://127.0.0.1:8000/mcp`，Headers 可填 `{"Authorization":"Bearer …"}`。 |

stdio 参数直接传给程序，不经过 shell 拆分或插值；页面不会替你安装外部 MCP 程序。服务名称需要唯一，使用 1–32 位字母、数字、下划线或横线。互为双下划线前缀的名称也会被拒绝，以便准确区分工具归属。勾选启用后才会启动本机程序或发起 HTTP 连接；也可以取消勾选，仅保存配置。

网页配置保存在 `.dsh/mcp-services.json`，重启后自动恢复；页面底部显示实际文件位置。可在启动前设置 `DSH_DEMO_MCP_CONFIG` 改用另一个文件，HTTP 接口不能更改保存路径。文件按 `0600` 权限原子写入，env / Headers 的值不会在列表中回显；编辑时留空保留原值，显式填写 `{}` 才会清空。配置文件含凭据时应只在本机妥善保存。

迁移网页注册列表时，可以单独备份并恢复这个 JSON 文件，再更新新机器上的程序路径和工作目录；它属于本地配置，不会随着源码复制或 `npm ci` 自动迁移。

YAML 服务可以启停、重新连接和查看工具，参数编辑或删除需要修改对应 YAML；网页操作不改写教学配置。新增服务挂在 `minimal-web` 的真实 Loader 子树下，插件树中的开关同样会保存其启停状态。修改连接会结束所有页面的当前会话，已捕获的调用记录保留。

“客户端运行中”表示插件已运行，工具目录显示当前实际可用的工具；它不是额外的网络心跳检测。连接失败会保留配置并显示错误，可编辑后重连。每次手动连接最多等待约 10 秒，超时会卸载本次客户端。停用 `tools` 核心插件会使连接等待依赖，恢复后由框架重新激活。

新增服务发布的工具可以由真实模型选择调用。离线模式可通过 `/mcp 完整工具名 JSON参数` 调用新服务。

### 聊天输入框的命令补全

聊天输入框提供两个目录入口，离线与真实模型模式都可以使用：

| 输入 | 显示内容 |
| --- | --- |
| `/` | `/mcp`、`/skill` 目录入口，以及所有当前可调用的 Skill 和已连接 MCP 工具。 |
| `/mcp` 或 `/mcp ` | 所有可用 MCP 工具，可继续输入工具名称或名称片段筛选。 |
| `/skill` 或 `/skill ` | 所有已启用、允许用户调用的 Skill，可继续输入名称筛选。 |
| `/under` 或 `/__add` | 在合并目录中筛选技能或 MCP 工具。 |

方向键选择，Tab / Enter 或鼠标点击补全；Esc 关闭，Shift + Enter 换行，中文输入法确认不触发补全或发送。选择目录入口会继续展开子项；选择具体条目只修改草稿，下一次发送才进入 Agent。单独提交 `/mcp` 或 `/skill` 只浏览目录，不创建会话或调用模型。参数和描述按纯文本显示，不执行其中的 HTML。

选择技能后回填官方 `/技能名`，由官方插件加载正文；例如启用并选中 `explain-simulation` 后得到 `/explain-simulation `。停用、删除、依赖未就绪或 `user-invocable: false` 的技能不会进入列表；`disable-model-invocation: true` 的技能仍可允许用户显式调用。

选择 MCP 工具后回填 `/mcp 完整工具名 `，候选项显示服务名称和真实 JSON Schema 的参数摘要，`*` 表示必填；已写在光标后的 JSON 参数会保留。例：`/mcp mcp__environment__get_environment_config`。真实模式由模型按指令通过官方工具运行时调用，缺少必填信息时先询问用户；离线模式仍使用现有 JSON 命令适配器。两种模式都展示实际工具调用和结果，补全本身不执行工具。

Skill 数据读取 `/api/skills.commands`，MCP 数据读取 `/api/mcp/services` 中已启用、连接运行中的实际工具，去重后展示；断连、停用或移除的工具会退出列表。目录展开期间定期刷新，Skill/MCP 管理变更后立即刷新；两个目录独立读取，一种失败不会隐藏另一种可用能力。`/mcp` 与 `/skill` 是本项目的目录入口，不宣称由 MCP 协议规定。`/bash` 是离线测试快捷入口，不加入补全；直接通过 API 发送旧 `/skill 名称` 的离线测试行为保留。

### 在网页管理 Skill

启动 Web 后，打开右侧 **Skill 管理**。运行时复用 `@deepseek-ai/dsh-skill`、`@deepseek-ai/dsh-skill-filesystem` 和 `@deepseek-ai/dsh-tool-skill`；网页 CRUD 与 JSON 存储是本 demo 的适配层。Skill 是告诉 agent“何时使用、按什么步骤处理”的指令；MCP 工具负责实际计算。启用技能不会直接启动仿真任务。

可在下方创建一个示例技能，也可以将技能文件放到配置的目录，让官方插件发现。

1. 点击 **查看** 阅读指令和 Markdown 预览；目录源文件保持只读。
2. 点击 **启用**，模型后续请求会看到技能的名称与使用场景摘要。
3. 在聊天框输入 `/explain-simulation`，官方插件会在本轮请求前注入完整指令。可在原始请求和调用过程中查看 `source.kind: skill-invocation`；显式调用不需要先由模型发起工具调用。
4. 离线适配器只报告实际收到的技能注入，不理解或自动执行正文。真实模型可根据官方目录匹配任务，通过 `skill` 工具按需读取，或使用用户已显式加载的指令调用 MCP。

新建自己的技能时，可以点击 **填入示例**，也可以点击 **导入 SKILL.md** 读取本机 Markdown 文件。导入只载入浏览器草稿，点击 **保存技能** 后才写入本机配置；“保存后启用”默认不勾选。已有网页技能可编辑或删除，目录技能可查看、启停、导出或复制为新技能；网页不会编辑或删除目录源文件。复制只包含 SKILL.md，不复制其脚本和附件。

标准文件的最小内容如下：

```markdown
---
name: explain-simulation
description: 当用户需要解释通信仿真结果时使用。
---

# 仿真结果解释

1. 先查看任务实际状态和工具返回值。
2. 分别说明误码率、投递率和吞吐率。
3. 不编造未返回的指标，明确区分演示模型与工程结论。
```

`name` 使用小写字母、数字和单横线，最多 64 位，且不能与已有技能重名；`description` 说明使用场景，最多 1024 个字符；正文必填，每个文件最多 48000 字节。YAML 仅解析安全的 JSON 类型，不支持 `!!js` 等自定义标签。网页导入支持官方 `disable-model-invocation`、`user-invocable` 调用策略，`whenToUse` 传给官方注册表；其他未映射字段保留在导出文件中。网页导入的是单文件，不会把附件和脚本一起上传，也不注册脚本执行工具。

**预览 Markdown** 只检查和显示草稿，不保存或结束会话；**导出** 会下载完整的 `SKILL.md`。网页技能与启用状态保存在 `.dsh/skills.json`，采用原子写入和 `0600` 文件权限，重启后恢复。也可在启动前通过 `DSH_DEMO_SKILL_CONFIG` 指定另一个配置文件；网页不能选择服务端任意路径，也不会修改本机其他软件的技能目录。迁移时可备份这个 JSON，或逐个导出标准文件。

保存、启停或删除技能会结束所有网页的当前会话，防止旧对话中的已加载指令继续影响新状态。网页技能通过 `ctx.skills.register()` 贡献启用项，目录技能通过目录适配层应用同一份管理状态；官方 `tool-skill` 发布目录并处理模型加载与 `/技能名` 显式注入。停用目录技能会同时退出补全和模型目录，实际读取也会被阻止。启停不会修改文件中的调用策略；恢复启用后，`disable-model-invocation` 和 `user-invocable` 仍由官方插件检查。

随项目提供的目录技能统一放在 `skills/<技能名>/SKILL.md`，新增子目录可自动发现；额外本地技能放在 `.dsh/local-skills/<技能名>/SKILL.md`，也支持该根目录下的 `<技能名>.md`。`DSH_DEMO_SKILL_DIR` 只更改额外根目录。`src/skill-filesystem.ts` 复用官方 `FileSystemSkillProvider` 的发现、解析、监听、缓存失效通知和正文读取，在提供方的 `list/get` 边界额外检查启停状态，保留官方 `resourceBase`，不修改 vendored 源码。配置仍为 `includeDefaultRoots: false`，不扫描用户的 `~/.agents/skills`。

目录技能的启停按官方目录使用的技能名称保存，不因文件路径或插件重启丢失；重命名技能视为新技能。管理配置为版本 2，包含 `skills`（原网页技能）和 `directoryEnabled`（名称到布尔值的映射）。旧版配置迁移时保留网页技能，原配置另存为同目录的 `skills.json.v1.bak`（自定义配置路径则在原路径后加 `.v1.bak`），已有备份不覆盖。损坏配置不覆盖保存，目录调用保持关闭，修复后重启恢复。

### 上传资料与下载文件

1. 点击输入框旁 **＋ 文件**，或将文件拖入输入区，可选择多个文件。上传完成后显示“待发送”，可以移除或重试失败项；上传成功本身不调用模型。
2. 输入问题后发送，也可以只发送附件。该轮会展示附件下载链接，服务器仅接纳真实上传 ID，通过官方 `file` 内容块加入会话。
3. 官方 LLM 运行时把文件引用转换成文件名、大小和真实只读路径，Agent 用现有 Bash/文档工具按需读取；不会把二进制伪装成文本。DOCX、PDF、扫描件及其他格式需要相应的读取或转换工具，上传不等于自动完成解析或 OCR。图片本次作为原始文件保存，不自动进行图片归一化或视觉分析。
4. 让 Agent 将需要下载的产物保存到 `work/`，例如 `work/output/report.docx`。打开右侧 **文件**，点击名称即可下载；生成结束后自动刷新，面板也支持手动刷新和按路径搜索。原始上传和其他工作文件同样可下载，已上传资料可重新添加为附件。

上传原件存储为 `work/uploads/<随机上传ID>/<文件名>`，同名文件不会覆盖；隐藏的 `.upload.json` 保存哈希和回执，不能从下载接口读取。对话通过已签收回执引用原件，后台校验字节哈希后再接纳附件。原件设置为只读，需要修改时复制到项目工作目录。单文件上限 **20 MiB**，每条消息最多 **10 个附件、合计 100 MiB**；大文件流式写入，超限或取消会清理半成品。从待发送列表移除只取消该消息的引用，不删除已保存文件。重启后文件与上传回执保留，网页对话同时由官方 JSONL 后端持久化；此本机 demo 的多个页面共享工作文件目录。

文件面板只列出工作根目录内的普通文件，忽略隐藏项和符号链接；下载接口校验规范路径，拒绝目录、路径穿越和指向工作区外的链接，始终以附件方式下载。Agent 可返回 `[下载 Word](/api/files/download?path=output%2Freport.docx)` 这样的真实链接；中文与空格需 URL 编码。聊天中的 `work/...` 链接及工作目录内的绝对路径会由前端转换为下载地址。仅在工具确认文件存在后交付，不使用虚构的 `sandbox:` 地址。工作目录过大时面板最多列出 1000 个文件，已知路径的有效下载链接仍可使用。

### 执行 Bash 命令

两个入口都挂载官方 `@deepseek-ai/dsh-subprocess-local`、`@deepseek-ai/dsh-bash-local`、`@deepseek-ai/dsh-shell-env` 和 `@deepseek-ai/dsh-tool-bash`，模型看到的工具名是 **`bash`**。Agent 工作目录由官方 `working-directory` 管理，默认是本项目的 `work/`（当前为 `/home/shenzy/dsh/dsh-demo/work`），启动时自动创建，与网页上传和下载共用目录。模型收到的工作目录与 Bash 实际执行目录一致；例如相对路径 `tenders/demo/output/report.docx` 对应项目中的 `work/tenders/demo/output/report.docx`，无需重复添加 `work/`。服务进程仍从项目根目录启动，技能和 MCP 的加载路径保持有效；技能文档中标明在项目根目录执行的命令，需要显式切换目录或使用绝对路径。需要本机 PATH 中能够找到 `bash`；这里使用本机执行器，以服务进程所属用户的权限运行，不额外提供文件沙箱。

真实模型模式下，可以直接说“请执行 Bash，显示当前目录与 Node 版本”。离线适配器不理解自然语言，可手动测试：

```text
/bash pwd
/bash printf 'hello\n'; node --version
/bash printf 'out\n'; printf 'err\n' >&2; exit 7
```

`/bash` 是 demo 专用的离线测试别名，**不会加入自动补全**；它只生成标准 `bash` 工具调用，执行、超时和进程清理由官方插件完成。网页中参数与原始结果仍位于工具卡片，右侧时间线记录真实调用；离线回复同时回显真实返回，方便终端查看。

每次调用是全新 Bash，不保留前一次的变量或 `cd`。真实模型调用可指定 `workdir`（相对路径从会话目录解析）和 `timeoutMs`。默认前台超时 30 秒，单次上限 60 秒；可用 `DSH_DEMO_BASH_TIMEOUT_MS` 配置默认值，或修改 YAML 中的官方执行器配置。每条 stdout/stderr 的内存上限为 64000 字节，超出部分由官方子进程管理器保存，结果报告完整输出位置。正常退出 0 不附加退出标记，非零退出显示 `[exit code: N]`；非零退出本身是命令结果，不等同于工具基础设施错误。

本示例关闭 `run_in_background` 与超时转后台，未挂载通用后台 jobs。超时会终止命令；新对话、连接断开或插件切换会取消当前执行。停用 `subprocess-local` 会让 `bash-local` 和 `tool-bash` 等待依赖，恢复后自动重新注册；手动取消启用的插件保持关闭。

### 接入真实模型与配置项

真实模型需要在启动终端中提供凭据。下面使用 Bash 的环境变量语法：

```bash
# 这里填写自己的值，不要把真实密钥保存到源码或提交到版本库。
export DEEPSEEK_API_KEY="你的 API Key"
# 可选：选择部署实际支持的模型；本例默认 deepseek-flash。
export DSH_MODEL="你的模型 ID"
# 网页模式；终端模式则运行 npm run demo。
npm run web
```

真实模型会产生相应 API 用量。本例使用上游 DeepSeek Messages 适配器；`DEEPSEEK_BASE_URL` 可以覆盖兼容端点地址，它不表示任意 Chat Completions 接口都能直接使用。API Key 留在服务端，不发送到浏览器。

模型容量已按 [DeepSeek 官方模型元数据](https://api-docs.deepseek.com/api/list-models/) 配置（2026-10-21 核对）：上下文为 **1,048,576 tokens（1M，输入与输出合计）**，单次输出上限为 **393,216 tokens（384K）**。`cordis.patch.yml` 同时设置 `defaultContextWindow`、目录中模型的 `contextWindow` 及 `maxTokens`，避免已知模型仍沿用框架旧目录中的容量。`maxTokens` 是单次上限，包含工具调用参数，不代表每次都生成这么多；原先的 2048 限制已移除，终端和 Web 共用新配置。

官方当前推荐模型 ID 为 `deepseek-flash`，由 DeepSeek-V4.1-Flash 承载；旧名 `deepseek-v4-flash` 也由该模型处理，见 [官方调用说明](https://api-docs.deepseek.com/quick_start/agent_integrations/)。设置本地容量不会扩展服务端模型的实际能力，也不会自动压缩历史。修改 YAML 后需重启 Web；页面右侧“调用过程”中的 `session/request/context` 可核对上下文容量，`llm/request` 中的 `maxTokens` 及原始 HTTP 请求中的 `max_tokens` 可核对输出上限。

| 配置项 | 作用与默认行为 |
| --- | --- |
| `DEEPSEEK_API_KEY` | 真实模型适配器读取的凭据；离线模拟不需要。 |
| `DSH_MODEL` | 真实模式的模型 ID；基础 YAML 的默认值为 `deepseek-flash`，实际使用应与接入端点支持的模型一致。 |
| `DEEPSEEK_BASE_URL` | 覆盖 DeepSeek Messages 兼容端点地址；未设置时由适配器使用默认地址。 |
| `DSH_DEMO_PORT` | Web 端口，默认 `3080`；命令行 `--port` 优先。 |
| `DSH_DEMO_MCP_CONFIG` | 网页 MCP 配置文件，默认 `.dsh/mcp-services.json`。 |
| `DSH_DEMO_SKILL_CONFIG` | 网页技能与启用状态文件，默认 `.dsh/skills.json`。 |
| `DSH_DEMO_BASH_TIMEOUT_MS` | 官方本地 Bash 默认前台超时，默认 30000 毫秒，受 maxTimeoutMs 上限约束。 |
| `DSH_DEMO_SKILL_DIR` | 官方文件系统技能提供方的扫描根目录，默认 `.dsh/local-skills`。 |
| `DSH_DEMO_SESSION_DIR` | Web 会话历史目录，默认本项目 `.dsh/sessions/`；相对配置值以项目根目录解析。 |
| `DSH_DEMO_WORK_DIR` | Agent 默认工作目录、Bash 后备目录及 Web 上传下载的共同根目录，默认本项目 `work/`，启动时自动创建；相对配置值以项目根目录解析。 |
| `--offline` | 选择 `demo-offline` 提供方与 `echo` 模型，禁用真实模型适配器。 |
| `cordis.patch.yml` 的五组 `mcp-*` 条目 | 默认五平台 MCP 服务的 stdio 启动配置、HTTP 平台地址和工具超时。 |
| `cordis.patch.yml` 的 `deepseek-api-key.config` | 模型容量：`defaultContextWindow` / 模型目录 `contextWindow` 为 1048576，`maxTokens` 为 393216；保留非思考模式。 |

`DSH_DEMO_OFFLINE`、`DSH_HOME` 和 `TSX_TSCONFIG_PATH` 由 `scripts/run.mjs` 为子进程设置。切换离线模式请使用 `--offline`；这些内部变量不需要手动准备。

### 独立安装与迁移

现在整个 `dsh-demo` 可以单独复制到其他目录或机器。必要的框架源码已保存在 `vendor/harness/`，不再读取相邻 `deepseek-harness` 的源码、依赖或声明文件。需要 Node `^22.19.0 || >=24.0.0` 和 npm；首次安装仍需联网下载通用 npm 依赖。安装完成后，`--offline` 对话不调用模型网络服务。

有锁文件时可执行 `npm ci`，它按 `package-lock.json` 重建依赖；`npm install` 适合首次准备或修改依赖。两者都会自动执行 `prepare`，从项目内源码生成类型声明并检查框架类型。修改框架源码后运行 `npm run build`，再运行 `npm run typecheck` 检查教学入口。请保留默认开发依赖安装，因为 TypeScript 构建需要它们。

复制时带上 `src/`、`web/`、`scripts/`、`simulation/`、`vendor/`、两个 YAML、JSON 配置与锁文件即可；不要携带 `.env`、`.dsh/`、`node_modules/` 或生成的 `lib/` 和 `*.tsbuildinfo`。在新目录重新执行 `npm ci`，然后执行 `npm run web -- --offline`。框架来源、裁剪范围和许可证见 [vendor/harness/README.md](vendor/harness/README.md)，每个复制的源码文件见 [FILES.md](vendor/harness/FILES.md)。

### 体验本机 MCP 工具

发送 `/mcp mcp__environment__get_environment_config` 可查询环境配置。Web「调用过程」显示模型请求、工具调用、HTTP 平台结果和后续模型回复。各平台的 MCP 客户端由 `cordis.patch.yml` 加载，通过 stdio 使用同一个适配器脚本和各自的 `--platform` 参数。

在「插件」页停用任一平台 MCP 条目会断开对应连接并移除该组工具。重新启用会重新发现工具。切换会结束当前会话，进程重启时按 YAML 重新加载。

#### 改成其他 MCP 服务

每个 MCP 条目对应一个服务。复制某个平台的 MCP 条目时，用不同的 `id` 和 `serverName` 避免工具名冲突。本机程序仍用 `transport: stdio`，把 command、args、cwd 改为服务实际的启动命令。SDK 会直接传递参数，不执行 shell 拼接。`env` 只填写服务需要的显式环境值，凭据应通过环境表达式读取。

远程服务使用 Streamable HTTP，可把原条目的 config 改成下面这样；同时删除原有的 command、args、cwd、env。这里是替换示意，请把地址换成自己的 MCP 端点：

```yaml
# 工具公开名前缀改为 mcp__remote__，不影响服务自身声明的工具名。
serverName: remote
# 选择 HTTP 传输，客户端不会再启动本机子进程。
transport: streamable-http
# 这是 MCP 端点，不是模型 API 或普通网页地址。
url: http://127.0.0.1:9000/mcp
# 无鉴权服务不加额外请求头；有鉴权时通过环境变量表达式提供凭据。
headers: {}
# 单次工具请求的超时，单位毫秒。
toolCallTimeoutMs: 10000
# 首次连接失败显示插件错误；客户端默认还带有自动重连策略。
failOnStartupError: true
```

当前最小例子只挂载 MCP 工具桥接（包括仿真工具）；MCP 资源发现/读取服务没有单独激活。`serverName` 改变后，离线命令需要使用新的工具全名。网页可管理实际的 MCP 客户端条目，无需为每个新 MCP 服务修改开关允许清单。

### 能力来源与边界

“复用官方实现”指运行 `vendor/harness` 中保留的官方源码，源码文件保持与记录的上游提交一致；这些源码在本项目内独立安装和运行。下表区分运行时能力和 demo 的界面、适配代码，不把保存了某个包的类型文件等同于已经启用该插件。

| 能力 | 当前实际实现 | 来源与边界 |
| --- | --- | --- |
| 启动、配置组合、插件依赖与生命周期 | 官方 dsh CLI、Cordis、Loader、Include | 复用官方；`scripts/run.mjs` 只是 demo 的参数与 profile 包装。 |
| 模型路由、工具执行、会话、提示词、AgentLoop | 七个核心插件 | 复用官方；没有另外实现对话循环。终端使用内存会话，Web 额外挂载官方 JSONL 持久化后端。 |
| DeepSeek 真实接口、鉴权、流协议与工具响应 | 官方 DeepSeek 适配器 | 复用官方；离线模式的规则回显由 demo 自己实现，不具备自然语言理解。 |
| Skill 注册、来源合并、目录、按需加载、调用权限、`/技能名` 注入 | `dsh-skill`、`dsh-skill-filesystem`、`dsh-tool-skill` | 复用官方；目录提供方由本地适配插件实例化官方类，额外应用逐技能启停状态，解析/监听/正文加载和资源路径仍来自官方。 |
| 技能与 Bash 共用的本地文件系统和会话工作目录 | `dsh-fs-local`、`dsh-working-directory` | 复用官方；提供运行时依赖，未额外注册独立文件读写工具；Bash 由下列官方插件提供。 |
| MCP 连接、工具发现、stdio / Streamable HTTP 调用 | `dsh-mcp-client` 与 MCP SDK | 复用官方客户端；SDK 是第三方依赖。 |
| Bash 命令、Shell 环境、超时、输出与子进程清理 | `dsh-subprocess-local`、`dsh-bash-local`、`dsh-shell-env`、`dsh-tool-bash` | 复用官方，前台模式；离线测试别名由 demo 适配器生成标准工具调用。 |
| HTTP 监听与路由注册 | `dsh-host-webserver` | 复用官方；聊天 API、SSE 转发和页面资源白名单由 demo 编写。 |
| Web 聊天、轮次分组、工具结果卡片、补全 | `web/`、`src/web-plugin.ts` | demo 自己的最小页面，未使用官方完整 Web 前端。补全合并官方用户技能目录与已连接 MCP 工具。 |
| Markdown 展示 | `markdown-it` 与 `web/markdown.js` | 第三方解析器加 demo 的安全配置和样式。 |
| 插件树、服务依赖视图与启停控制 | `src/plugin-control.ts`、`src/plugin-dependencies.ts`、`web/debugger.js`、`web/plugin-tree-model.js`、`web/dependencies.js` | demo 控制与展示层，调用真实官方 Loader；不等同于官方完整插件管理界面。 |
| 模型原文、调用时间线、下载调试记录 | `src/debugger.ts`、`web/debugger.js` | demo 捕获和展示官方运行事件、模型请求及适配器 HTTP 数据；记录保存在内存。 |
| MCP 服务注册、凭据回显处理与配置保存 | `src/mcp-management.ts`、`web/mcp.js` | demo 的管理适配层；每个连接实例实际运行官方 MCP 客户端。 |
| Skill 新建、编辑、启停、导入导出、预览与 JSON 保存 | `src/skill-management.ts`、`src/skill-filesystem.ts`、`web/skills.js` | demo 的管理适配层；不是另一套技能加载运行时。旧版管理 JSON 自动迁移到版本 2 并备份。 |
| 会话落盘、读取与恢复 | 官方 `session-persistence-jsonl`、`session-persistence`、`agents.resume()`；demo `src/session-history.ts`、`web/history.js` | 官方后端保存事件并恢复上下文；demo 提供列表、选择、历史渲染及删除适配。格式迁移依赖仅作为库保留，不额外激活命令或压缩插件。 |
| 文件上传/下载、原件存储、附件队列与工作文件面板 | `src/web-files.ts`、`web/files.js` | demo 实现官方 `AttachmentStore` 的文件部分；`file` 消息及模型端只读路径投影复用官方 LLM 运行时。不提供图片归一化。 |
| 五平台 MCP 服务 | `simulation/platform-mcp/server.mjs` | stdio 工具将请求转发到五个平台的 HTTP 接口。 |
| 仿真模板、DAG 依赖、并行执行、串行锁、节点脚本与数值内核 | `simulation/workflow.mjs`、模板和 kernels | demo 自己实现；没有接入官方 workflow、jobs 或真实计算集群；数值模型用于演示。 |

当前没有激活官方完整 Web/桌面应用、子 Agent、浏览器/搜索、持久 Shell/通用后台 jobs、通用文件工具、长程目标、通用工作流、持久化会话等扩展能力。今后需要这些能力时应接入对应官方插件，配合必要的业务适配层。

## 2. 每个文件由谁读取，负责什么

“入口”不是只有一个：npm 先找到启动脚本，dsh 再加载插件，浏览器还会执行自己的 JavaScript。区分运行环境，比先背 TypeScript 语法更有帮助。

```text
dsh-demo/
├── package.json / package-lock.json  npm 命令、依赖和固定版本
├── tsconfig.json                    教学入口的类型检查
├── cordis.patch.yml                 七核心 + 模型适配器 + MCP + 官方 Bash + 终端入口
├── cordis.web.patch.yml             Web 模式的叠加配置
├── src/                             终端、Web、模拟模型与调试控制
├── web/                             浏览器执行的 HTML、CSS、JavaScript
├── scripts/                         启动包装、MCP 服务和验证脚本
├── simulation/                      仿真模板、资源账本与数值计算
├── vendor/harness/                  项目内部的必要框架源码与授权
└── .dsh/                            profile、MCP/技能配置和诊断数据
```

| 文件 | 谁读取或执行 | 具体职责 |
| --- | --- | --- |
| [README.md](README.md) | 你 | 学习路线、文件说明、配置字段和完整执行过程；不参与运行。 |
| [package.json](package.json) | npm、Node | 定义 npm 命令、ESM 模块模式和 Node 版本要求。 |
| [package-lock.json](package-lock.json) | npm | 固定第三方依赖版本及项目内部 workspace 链接；应随源码一起保存。 |
| [tsconfig.json](tsconfig.json) | TypeScript 编译器 | 规定如何检查教学 `.ts`；从本项目 workspace 包的 exports 找到生成的类型声明。 |
| [.gitignore](.gitignore) | Git | 忽略本地数据、依赖、环境配置和检查缓存；不是运行时访问控制。 |
| [cordis.patch.yml](cordis.patch.yml) | dsh/Cordis | 显式声明七个核心插件、真实模型适配器、MCP、官方 Bash 及工作目录依赖和终端入口。 |
| [cordis.web.patch.yml](cordis.web.patch.yml) | dsh/Cordis | 在基础组合上禁用终端入口，增加 HTTP、官方 Skill、独立模拟提供方和 Web 调试入口；文件系统/工作目录与 Bash 已由基础组合共用。 |
| [scripts/run.mjs](scripts/run.mjs) | Node | 解析模式与选项，准备独立 profile，启动本项目 vendor 中保存的官方 dsh CLI。 |
| [src/config.ts](src/config.ts) | 类型检查器、Cordis | 同时定义共享配置类型和运行时校验规则，供两个入口复用。 |
| [src/plugin.ts](src/plugin.ts) | Cordis 加载，Node 执行 | 终端入口：创建 Agent、逐行提交输入、打印回复、处理错误和退出。 |
| [src/offline-adapter.ts](src/offline-adapter.ts) | LLM 运行时调用 | 按真实流协议产生可预测的模拟回复，不请求外部模型。 |
| [src/web-plugin.ts](src/web-plugin.ts) | Cordis 加载，Node 执行 | Web 控制入口：注册聊天、插件控制和记录 API；核心服务停用后仍然在线。 |
| [src/debugger.ts](src/debugger.ts) | Web 入口安装 | 保存完整运行记录，透传观察模型流，按异步调用归属捕获真实 HTTP 正文与字节。 |
| [src/plugin-dependencies.ts](src/plugin-dependencies.ts) | 插件状态 API | 只读扫描 Fiber inject、实际服务注册与隔离作用域，关联提供者/消费者，保存不含服务值的历史线索。 |
| [src/plugin-control.ts](src/plugin-control.ts) | Web API 调用 | 读取真实 Loader 父子归属与状态，保留配置容器，临时启停允许的插件并等待依赖链稳定。 |
| [src/mcp-management.ts](src/mcp-management.ts) | Web 入口 | 校验和保存网页 MCP 配置，创建真实 Loader 子树，连接、重连和清理服务，提供当前工具 schema。 |
| [src/skill-management.ts](src/skill-management.ts) | Web 入口 | 校验网页导入、保存技能与启用状态，通过官方 ctx.skills.register 贡献数据，投影目录和调用策略；不自行注册加载工具。 |
| [src/skill-filesystem.ts](src/skill-filesystem.ts) | Cordis Loader | 实例化官方文件技能提供方，保留其解析、监听和资源目录，在目录发现和正文读取时检查统一启停状态；管理页可查看停用项。 |
| [src/session-history.ts](src/session-history.ts) | Web 入口 | 从官方持久化服务读取会话摘要，并在官方排他写锁保护下删除日志；保存与恢复仍使用官方实现。 |
| [src/web-files.ts](src/web-files.ts) | Web 入口 | 实现官方附件存储接口的原样文件能力，流式上传、持久化回执与哈希校验，发现工作文件并安全下载。 |
| [src/offline-skills.ts](src/offline-skills.ts) | 离线适配器 | 观察官方 /技能名 注入；保留手动 /skill 名称 离线测试别名，调用官方 skill 工具。 |
| [src/offline-bash.ts](src/offline-bash.ts) | 离线适配器 | 把手动 /bash 测试请求转换为官方 bash 工具调用并回显真实结果，不执行进程、不参与补全。 |
| [src/offline-mcp.ts](src/offline-mcp.ts) | 离线适配器 | 解析 /mcp 完整工具名 JSON参数，检查可用性并产生标准工具调用，不绕过 AgentLoop。 |
| [src/offline-provider.ts](src/offline-provider.ts) | Cordis 加载 | Web 专用模拟适配器插件；llm 停止或恢复时随依赖重新注册。 |
| [web/index.html](web/index.html) | 浏览器 | 定义标题、欢迎区、消息列表、输入框和按钮；没有模型调用逻辑。 |
| [web/style.css](web/style.css) | 浏览器 | 定义颜色、布局、气泡、焦点反馈和手机适配；不保存会话。 |
| [web/app.js](web/app.js) | 浏览器 | 处理聊天和 SSE，给用户提交编号，把同一份事件交给轮次视图和调试面板，并响应插件状态变化。 |
| [web/chat-turns.js](web/chat-turns.js) | 浏览器 | 按轮次和模型步骤显示助手回答，按调用 ID 配对工具参数与结果，保留流式 Markdown、工具详情和错误状态。 |
| [web/history.js](web/history.js) | 浏览器 | 搜索、选择和确认删除历史会话，同步标签页删除通知；聊天内容来自磁盘。 |
| [web/files.js](web/files.js) | 浏览器 | 多文件/拖放上传、失败重试、消息附件队列、原始附件复用、工作文件搜索及下载链接。 |
| [web/markdown.js](web/markdown.js) | 浏览器 | 配置 Markdown 渲染，禁用原始 HTML，为链接设置新页打开，为表格添加横向滚动容器。 |
| [web/mcp.js](web/mcp.js) | 浏览器 | MCP 服务表单、连接操作、实时列表和可展开工具定义；轮询不覆盖编辑草稿。 |
| [web/skills.js](web/skills.js) | 浏览器 | 技能搜索、表单、只读/复制、Markdown 预览、导入导出和启停管理。 |
| [web/completion.js](web/completion.js) | 浏览器 | 合并官方用户可调用 Skill 与实际连接的 MCP 工具，提供 /skill、/mcp 目录、参数提示和草稿补全。 |
| [web/plugin-tree-model.js](web/plugin-tree-model.js) | 浏览器 | 把实际服务依赖投影为森林；合并服务边、分组子作用域、标记共享/循环引用，并支持配置归属模式。 |
| [web/dependencies.js](web/dependencies.js) | 浏览器 | 配置树/依赖关系切换、插件选择、直接/反向关系、间接依赖遍历及状态标记。 |
| [web/debugger.js](web/debugger.js) | 浏览器 | 嵌套插件树、折叠与启停、完整数据视图、调用时间线、历史补读与 JSON 下载。 |
| [scripts/smoke.mjs](scripts/smoke.mjs) | Node | 启动真实终端进程，验证核心组合、多轮历史、参数和退出行为。 |
| [scripts/web-smoke.mjs](scripts/web-smoke.mjs) | Node | 启动真实 HTTP 服务，验证页面资源、SSE、历史隔离、输入检查和错误恢复。 |
| [scripts/debug-smoke.mjs](scripts/debug-smoke.mjs) | Node | 逐项验证核心启停，并用本机 Messages 协议夹具检查原始字节、思考/用量、取消及恢复。 |
| [simulation/platform-mcp/server.mjs](simulation/platform-mcp/server.mjs) | MCP SDK 启动，独立 Node 进程执行 | 提供五平台工具，通过 stdin/stdout 处理 MCP 并转发 HTTP。 |
| [scripts/platform-mcp-smoke.mjs](scripts/platform-mcp-smoke.mjs) | Node | 验证工具发现、两次模型请求、真实工具结果、多轮计算、错误传播、停用后注销及重新启用。 |
| [scripts/mcp-management-smoke.mjs](scripts/mcp-management-smoke.mjs) | Node | 隔离验证 stdio/HTTP 注册、工具目录、进程退出、凭据保留、并发保护、配置恢复和删除。 |
| [scripts/bash-smoke.mjs](scripts/bash-smoke.mjs) | Node | 通过真实 Agent 验证官方 Bash 执行、会话环境、全新 shell、错误输出、超时/输出溢出、取消与依赖恢复。 |
| [scripts/sessions-smoke.mjs](scripts/sessions-smoke.mjs) | Node | 验证官方落盘与恢复、排他写锁、历史删除与重启不复活、活动命令清理及原件保留。 |
| [scripts/files-smoke.mjs](scripts/files-smoke.mjs) | Node | 验证原样文件传输、官方附件消息、实际工具读取、产物下载、重启恢复、超限和取消清理、下载范围。 |
| [scripts/skills-smoke.mjs](scripts/skills-smoke.mjs) | Node | 通过真实 Agent 验证技能摘要、工具加载、CRUD、格式检查、依赖恢复、删除和重启恢复。 |
| `.dsh/sessions/` | 官方 JSONL 后端 | Web 会话事件日志及跨进程写锁；重启后可读和恢复，具体文件名由官方格式版本决定。 |
| `.dsh/skills.json` | 技能管理器 | 运行时生成的网页技能和启用状态，重启恢复；不作为静态资源公开。 |
| `.dsh/mcp-services.json` | Web 管理器 | 运行时生成的网页服务配置与启停状态，可能包含凭据，不应提交到版本库。 |
| [simulation/](simulation/README.md) | 模板脚本与 Node 子进程 | 资源账本、流程模板、DAG 调度、串行锁、数值内核、实例化节点脚本与结果持久化；各文件详见目录 README。 |
| [scripts/simulation-workflow.mjs](scripts/simulation-workflow.mjs) | Node | 无 Agent 的模板脚本入口，执行模板的资源申请与调度流程。 |
| [scripts/simulation-node.mjs](scripts/simulation-node.mjs) | 计算子进程 | 从 JSON stdin 执行受信数值任务，输出 JSON Lines 进度和结果。 |
| [scripts/standalone-smoke.mjs](scripts/standalone-smoke.mjs) | Node、npm | 复制源码到全新临时目录，重新安装与构建，并执行类型检查及全部功能 smoke 和仿真约束测试，检查内部包没有链接到外部仓库。 |
| [vendor/harness/](vendor/harness/README.md) | npm、tsx、TypeScript | 随项目保存的必要框架源码、包清单、构建配置和授权；详细文件索引见其 FILES.md。 |

运行后出现的 `.dsh/profiles/minimal-chat/package.json` 是启动脚本生成的 profile 清单，其中 `bundles: []` 表示不继承官方完整 bundle。启动器还会生成 profile 根配置、诊断日志等。它们不是本目录 `package.json` 或 `cordis.patch.yml` 的替代品，学习和修改功能时应优先改上表中的源码。

推荐阅读顺序：`src/config.ts` → `src/offline-adapter.ts` → `src/plugin.ts` → `cordis.patch.yml` → `scripts/run.mjs` → `src/web-plugin.ts` → `web/index.html` → `web/app.js` → `web/style.css` → `src/debugger.ts` → `src/plugin-control.ts` → `web/debugger.js` → 全部功能 smoke 和仿真约束测试。这样先理解单轮对话，再理解启动器、网络传输和调试控制。

## 3. 七个核心插件怎样协作

完整包名前缀均为 `@deepseek-ai/`。

| 核心插件 | 提供的能力 | 为什么在最小组合里保留 |
| --- | --- | --- |
| `dsh-llm` | `ctx.llm`、模型路由与适配器注册 | 把统一模型请求交给具体提供方。 |
| `dsh-session` | 内存会话与事件记录 | 保存用户、助手和轮次历史。 |
| `dsh-session-projection` | 从事件派生当前状态 | AgentLoop 依赖它维护收件箱等状态。 |
| `dsh-system-prompt` | 系统提示词和工具定义组装 | 为每次模型请求组织角色说明与能力描述。 |
| `dsh-tools` | 工具注册和执行运行时 | AgentLoop 的必需依赖；本例通过 MCP 客户端注册五平台工具。 |
| `dsh-agent` | `ctx.agents`、Agent 注册表与创建接口 | 让入口通过公开接口管理 Agent。 |
| `dsh-agent-loop` | Agent 实际工厂与轮次驱动 | 接纳消息、调用模型、记录回复，必要时执行工具。 |

“七个”是核心服务数量，不是整个应用所有条目的数量。MCP 客户端是附加插件，工具仍在同一套 dsh-tools 中执行。真实对话额外需要模型适配器和输入输出入口；网页还需要 HTTP 服务。Cordis 根据 `inject` 等待依赖，不要求你手写复杂的服务启动排序。

本例使用独立的 `minimal-chat` profile，没有继承 `base`、官方 `web` 或 `sdk-minimal` bundle，也没有使用 testkit。这样文件里的组件清单就是你要学习的实际组合。

## 4. 终端启动的完整顺序

```text
npm run demo -- --offline
  → package.json 查到 demo 命令
  → Node 执行 scripts/run.mjs，mode 为 demo
  → 生成或复用 .dsh 中的空 bundle profile
  → 启动官方 dsh CLI，并传入基础 patch 与离线环境变量
  → Cordis 读取七个核心插件，禁用真实适配器，加载终端入口
  → MCP 客户端在工具运行时就绪后启动本机服务，完成握手和工具发现
  → apply() 注册模拟适配器和启动完成回调
  → appReady 触发 chat()，创建一个 Agent
  → readline 读到一行文字
  → createUserMessage() 补齐消息 ID 与 user 角色
  → followup() 入队并唤醒 AgentLoop
  → 组装历史和提示词，交给 LLM 运行时与适配器
  → assistant-stream 文本事件到达，终端打印文字
  → whenIdle() 等待本轮停稳，再检查 agent/error
  → 继续读取下一行；退出时 dispose() 释放 Agent
```

`import` 会装载模块并执行其顶层语句，但定义 `function apply(...)` 不等于执行它。真正调用 `apply` 的是 Cordis。`apply` 中注册的回调又要等 `appReady`，不能把这些不同时间点当成“一加载就执行完全部聊天”。

上图按职责展示流程；插件加载会按依赖推进，不表示所有插件的 `apply` 都严格串行执行。正常就绪时，MCP 的首次连接与工具发现已经完成，所以第一轮模型请求就能看到 `mcp__environment__get_environment_config`。

`scripts/run.mjs` 用 `spawn` 启动另一个 Node 进程。`cwd: demoRoot` 将服务进程目录固定为项目根目录；Agent 的默认工作目录另由 `working-directory.config.defaultDirectory` 指向 `work/`。`stdio: 'inherit'` 决定键盘与日志如何穿过包装脚本。`--import tsx/esm` 负责执行 TS 源码；`npm run typecheck` 才是专门的类型检查，两者是独立操作。

## 5. Web 对话的完整顺序

```text
npm run web -- --offline
  → 同一基础 patch + cordis.web.patch.yml
  → 禁用终端入口，加载 webserver 与 web-plugin
  → 读取 HTML/JS/CSS，注册资源路由和 API
  → appReady 后打印实际监听地址
  → 浏览器 GET /，再加载 /style.css、/debugger.js 和 /app.js
  → app.js 请求 /api/config 显示当前模式
  → 首次发送时 POST /api/sessions，取得独立 sessionId
  → 有附件时先 POST /api/files/upload，取得上传回执 ID
  → POST /api/chat，把 sessionId、message 和 attachments ID 数组编成 JSON
  → Web 入口找到该会话的 Agent，提交用户消息
  → Agent 的文本事件转成 SSE delta
  → 浏览器把 delta 累积到同一条助手消息里
  → SSE done 表示成功；error 表示失败
```

| 接口 | 请求 | 返回或作用 |
| --- | --- | --- |
| `GET /api/config` | 无正文 | 公开的 `offline`、`model`，不含 API Key。 |
| `POST /api/sessions` | JSON 空对象即可 | `201` 与 `{ "sessionId": "随机 ID" }`，创建 Agent 但不调用模型。 |
| `POST /api/chat` | `{ "sessionId": "ID", "message": "你好", "attachments": ["上传ID"] }` | SSE 文本流；attachments 可省略，存在附件时 message 可为空。 |
| `GET /api/sessions` | 无正文 | 按最近活动时间列出已保存会话及读取错误。 |
| `GET /api/sessions/:id` | 无正文 | 读取完整官方事件日志、摘要及历史附件链接，不创建 Agent。 |
| `POST /api/sessions/:id/resume` | JSON 空对象 | 官方恢复同一 ID 的 Agent；同一会话的恢复和关闭串行处理。 |
| `DELETE /api/sessions/:id` | 无正文 | 关闭内存 Agent 并落盘，保留历史，返回 `204`；不是永久删除记录。 |
| `DELETE /api/sessions/:id/history` | 无正文 | 停止该会话 Agent，取得官方排他写锁后删除全部历史日志代次及该会话的内存调试记录；上传文件和仿真结果保留。 |
| `GET /api/files` | 无正文 | 工作文件列表、上传回执、工作根目录与大小限制。 |
| `POST /api/files/upload` | 原始二进制，`Content-Type: application/octet-stream`，`X-File-Name` 为 URL 编码名称 | `201` 与上传 ID、文件相对路径、字节数和下载链接；不自动发送消息。 |
| `GET /api/files/download?path=...` | URL 编码的相对工作目录路径 | 原始文件下载，支持中文文件名；拒绝工作区外路径和目录。 |
| `GET /api/plugins` | 无正文 | 实际插件条目、`parentId` 父节点、`container` 容器标志、状态、修改版本及模型可用性。 |
| `POST /api/plugins/toggle` | `{ "id": "完整 Loader ID", "enabled": false }` | 启停已有插件，结束旧会话并等待依赖稳定；只在当前进程有效。 |
| `GET /api/runs` | 无正文 | 所有网页轮次的摘要，包括进行中、完成、失败与取消。 |
| `GET /api/runs/:id` | 无正文 | 一次轮次的完整事件与原始数据，用于补读和下载。 |
| `POST /api/runs/clear` | JSON 空对象 | 清空已经结束的记录，保留正在生成的记录。 |

页面按需创建会话，不同页面使用不同 Agent。“新对话”会中止旧 fetch，尽力 DELETE 旧会话，并清空页面。Web 的“新对话”只关闭旧 Agent 并保留磁盘历史。左侧“历史会话”侧栏可以搜索、打开旧会话，默认展开，可点击侧栏“收起”按钮关闭，之后点击页头“历史”按钮重新展开；同一标签页刷新会自动加载上次选中的会话。历史展示从官方事件日志重建轮次、回答、工具结果及附件链接，读取历史不会调用模型。下一次发送时通过 `ctx.agents.resume()` 恢复同一会话 ID 和完整上下文。正常完成通知前会执行官方 `sessions.flush()`，保证已确认的轮次落盘；关闭和正常退出也会等待保存。硬崩溃时只承诺已完成的持久化检查点，未完成轮次会由官方恢复逻辑标为中断，不自动重跑旧 Bash 或计算任务。

### 会话历史的使用与保存位置

历史会话列表位于页面左侧栏，**默认展开**，刷新页面后也会展开。可按首条消息搜索并选择；手动收起后，点击页头 **历史** 按钮重新展开。选择会话后侧栏保持展开，只有点击侧栏内的“收起”按钮才会关闭。页头“历史”按钮只负责展开，Esc 和点击遮罩不会关闭侧栏；窄屏下仍以遮罩抽屉展示。打开只回放记录，发送新消息才恢复 Agent；点击 **新对话** 会保留旧记录。同一标签页刷新自动读取上次选择的会话，其他标签页可从列表选择。多个标签页打开同一会话时共用其后台 Agent，同一时间只允许一条消息生成。

每条历史会话右侧有 **删除** 按钮，确认后永久删除该会话的全部日志版本；当前会话正在生成时会先取消并等待 Agent/前台工具退出，再删除记录。删除当前会话会回到新对话，同源标签页通过删除通知同步退出该会话；侧栏保持展开。删除其他会话不会清空当前对话。删除失败会保留列表项并显示错误，可重试。原始上传、工作目录文件和独立后台仿真任务不随会话删除。

官方 `session-persistence` 未提供删除方法，demo 在 `src/session-history.ts` 增加适配：复用官方 `open(id, 'write')` 的进程内/跨进程写锁与目录命名，仅移除配置根目录下的标准日志文件，保留 `session.lock` 和空目录，避免破坏文件锁。其他服务仍占用会话时返回 `409`；“新对话”与离页清理依旧只关闭 Agent，不永久删除历史。

Web 历史默认保存在 `.dsh/sessions/<项目目录标识>/<会话UUID>/session.v4.jsonl`，具体文件名由官方格式版本决定，同目录的 `session.lock` 是官方跨进程写锁。上传原件仍保存在 `work/uploads/`，仿真任务仍保存在 `.dsh/simulations/`。备份或迁移历史时，应停止服务后复制 `.dsh/sessions/` 和所需 `work/` 文件；换机器后可浏览历史，继续执行前应确认原工作目录和附件仍可访问。独立安装说明中“不复制 .dsh”适用于创建干净实例；保留历史需要显式携带这些数据。

持久化保存的是官方会话事件及其中的模型输出和工具结果，**右侧调试器捕获的原始 HTTP 数据仍只在内存中**。当前版本提供会话列表、搜索、查看、继续对话和永久删除，暂未增加重命名。旧版本从未落盘的内存会话无法在升级后补回。终端入口保持原有内存会话行为。

## 6. 逐个读懂服务端文件

### `src/config.ts`：类型与真实数据校验

`interface Config` 中的 `offline: boolean` 等字段只告诉 TypeScript“代码应该传什么”。同名 `const Config` 是真正运行的 schema：为缺失的 offline 填默认值，为 provider 和 model 检查类型及是否提供。TS 允许类型和值分别使用同一个名称，因此这种同名写法是有意的。

这份 schema 被两个入口重新导出，Cordis 才能在插件加载时找到它。只写 interface 不能阻止 YAML 中的错误值进入运行时。反过来，schema 校验通过也不代表远端模型 ID 必然可用。

### `src/offline-adapter.ts`：最小适配器协议

`OfflineAdapter extends LlmAdapter` 复用框架基类，并实现 `stream`。`override async *` 的意思是“覆盖基类方法，并返回可以异步逐项读取的生成器”。每次 `yield` 交出一个协议分片，和普通函数只 `return` 一个最终值不同。

分片依次是 `block-start` → 多个 `text-delta` → `block-end` → `finish`。即使只是在本机回显，也遵守真实模型适配器的输入输出协议。它从 `options.messages` 读取首轮输入、当前输入与已有助手回复数量，因此 smoke 能验证 AgentLoop 是否真的传递了历史。

`options.signal?.throwIfAborted()` 在开始及每次输出前检查取消。`for...of` 按 Unicode 码点遍历字符串；JavaScript 的 `.length` 则统计 UTF-16 码元，这两者遇到某些 emoji 时并不相同。

`/mcp` 分支读取当前轮次的命令，校验工具名和 JSON 参数，再发出工具调用。AgentLoop 执行工具并将结果传回同一轮。普通消息按历史回显。

### `src/plugin.ts`：终端入口与资源所有权

公开导出 `name`、`inject`、`Config`、`apply` 构成函数插件接口。`inject` 声明服务依赖，`apply` 注册启动动作，私有的 `chat` 处理具体会话。

`ctx.agents.create()` 返回 handle：`handle.agent` 用于交互，`handle.dispose()` 表示“我拥有它，所以退出时负责释放”。setup 回调在输入开始前安装流与错误监听器。回复不是 `whenIdle()` 的返回值，而是在 `agent/assistant-stream` 回调中显示。

`for await...of` 一轮一轮读取文本，只有处理完当前轮才继续下一行。`try/finally` 保证 `/exit`、EOF、异常等路径都会关闭输入并释放 Agent。`appExit` 让官方启动器关闭整个插件树；入口不直接调用 `process.exit()` 强退。

### `src/web-plugin.ts`：HTTP 与 Agent 的衔接

顶部 `Conversation` 描述 Map 中的会话值：handle 管资源，busy 防止同会话重复生成，error 记录当前轮次失败，response 只在生成期间指向当前 SSE 连接，cancelled 区分取消与正常停稳。Web 控制入口仅 inject webServer 和 loader，agents/llm 通过可选读取取得；因此停用核心服务不会卸载整个控制页面。这份 Map 属于本插件，不是共享数据库。

`readJson` 收集字节块，限制到 64 KiB，然后一次性 UTF-8 解码并解析。解析后仍返回 unknown，调用方再校验对象与字段类型。消息长度另限为 8000 个 JS 字符串长度单位；它不是 8000 字节，也不严格等于用户看到的 8000 个字符。

`route` 统一处理 Host/Origin、HTTP 方法、Content-Type、启动状态与错误。HTTP 服务只绑定本机回环地址，路由只公开明确列出的 HTML、CSS、浏览器脚本和 API，没有把整个源码目录或 node_modules 做成静态目录。没有声明跨域许可，因此页面应从打印的地址访问。

正文开始前出错，可以返回 `400/403/404/409/413/415/500` 等状态与 JSON；SSE 头已经发出后不能再改 HTTP 状态，必须发 `error` 事件。这个区别是为什么浏览器同时需要 checked(response) 和 SSE error 处理。

每个会话的事件监听器注册到自己的 `agent.ctx`，不会混入其他 Agent 的回复。同一会话 busy 时返回 409；`finally` 无论成功失败都清掉 response 和 busy。客户端断开连接时调用 cancel；删除会话及插件卸载时调用 dispose 并等待停止。

### `src/debugger.ts`：观察模型流与真实传输

`Debugger` 以每次网页发送为一个 run；一个 run 可以包含多个底层模型调用，每个调用又有自己的 callId，实际 HTTP 请求另有 httpId。事件使用连续 seq 和毫秒时间，JSON 导出与实时 SSE 使用同一份快照，不靠前端生成虚假的“正在调用”步骤。

`llm/stream` 是 waterfall：观察器必须调用 next 并原样 yield 每个分片，不能因为只想看文字就丢弃思考、工具、用量或结束事件。`AsyncLocalStorage` 把迭代器每次 next/return 中的网络活动与所属调用关联起来。

当前适配器没有提供原生响应观察 hook，因此 Web 入口在自己的生命周期内安装作用域化 fetch 包装。没有当前模型调用归属时完全透传；有归属时记录序列化请求和真实响应，通过 TransformStream 原样交回字节，保留取消和背压传播。它不是把框架分片再拼成伪造的 HTTP 原文。卸载时还原自身包装，不改写上游仓库。

### `src/plugin-control.ts`：可恢复的真实开关

每次列表请求直接从 Loader 读取状态。控制器按完整条目 ID 查找，再按允许的 YAML key 判断权限；控制动作串行化，先释放现有会话，再更新 entry.disabled，等待 fiber 和依赖链停稳。它不调用 tree.write，所以临时实验不会写回教学配置。

每个条目的 `parentId` 来自 `entry.parent.ctx.fiber.entry`，没有上级时返回 null。Group 的孩子与组本身可能位于同一 EntryTree，所以完整 ID 未必包含组名；实际拥有者才是准确的树形关系。`container` 标识 Include 子树或 Group 分组。容器保留在 API 中供前端展示，并由接口强制禁止启停；核心就绪判断不把同名容器当成业务服务。

每次实际变更递增 revision。其他网页轮询到版本变化时会丢弃旧会话 ID，并禁用或恢复发送；完整调试记录独立保存。Web、HTTP 与配置加载器只读，防止将控制面板本身卸载。

`change()` 现在也是 MCP 管理的共享修改入口，连接增删和插件启停不能并发执行。网页创建的 MCP 条目在 `managed` 表登记自己的持久化开关处理器；从插件树操作它也会写入专属 JSON。YAML 条目仍保留原来的临时开关行为。

### `src/mcp-management.ts` 与 `web/mcp.js`：注册和管理服务

管理器只加载固定的 `@deepseek-ai/dsh-mcp-client` 模块，连接配置使用 Zod 校验。`RuntimeTree` 挂在 Web 插件下，使用真实 Entry 和 Fiber；它自己的 `write()` 不改 YAML，只有 `persist()` 会原子写入网页服务 JSON。更新先关闭旧 Fiber 再创建连接，删除和 Web 关闭时等待清理；恢复连接安排在 HTTP 页面就绪之后。

工具定义来自 `ctx.get('tools')?.schemas()`，不是把 MCP 源码中的工具名称写死在页面里。接口只投影名称、连接参数和凭据键名，不返回 env / Headers 的值。`web/mcp.js` 通过安全文本节点展示这些数据，每两秒刷新打开的服务页，保留工具展开状态和操作焦点，表单内容独立保留。

| 接口 | 用途 |
| --- | --- |
| `GET /api/mcp/services` | 服务状态、当前工具 schema、配置保存位置和本机示例默认值。 |
| `POST /api/mcp/save` | `{config}` 注册，或 `{id, config}` 编辑网页服务。 |
| `POST /api/mcp/toggle` | `{id, enabled}` 启停连接。 |
| `POST /api/mcp/reconnect` | `{id}` 关闭旧客户端后重新连接。 |
| `POST /api/mcp/delete` | `{id}` 删除网页服务，清理连接与工具。 |

### `src/offline-provider.ts`：让模拟适配器也能恢复

终端入口仍可自己注册模拟器；Web 则把模拟路由注册独立为 inject llm 的插件。若让不依赖 llm 的控制入口直接持有旧 LLM 的注册，重启 llm 后新运行时可能没有模拟适配器。独立插件会随依赖停用和重新激活，保证恢复后可以真正聊天。

### `src/skill-management.ts` 与 `web/skills.js`：技能如何进入 Agent

`parseSkill()` 校验网页草稿和目录详情预览；目录的真实运行时解析仍由官方提供方完成。非法网页草稿在清空会话前拒绝。持久化使用单个版本 2 JSON，原子写入 `skills` 和 `directoryEnabled`；旧版在备份后迁移。目录技能的启用状态与文件编辑权限分别处理：可以启停，不能从网页覆盖或删除源文件。

管理器通过 `ctx.inject(['skills'])` 注册网页技能，通过 `ctx.inject(['demoSkillFiles'])` 将启停策略绑定到目录适配插件。后者在 `ctx.skills.registerProvider()` 中直接复用官方 `FileSystemSkillProvider`，管理页读取完整目录，模型/用户目录只返回启用项；`get()` 在读取前后再次检查策略。未加载管理配置时不开放目录调用，插件重启后重新绑定当前持久化状态。官方注册表继续处理作用域、重名优先级、缓存失效和释放。

官方 `tool-skill` 的 `agent/pre-step` 监听器发布可追踪的目录消息，并把用户显式 `/技能名` 转换为 `skill-invocation` 上下文。模型的 `skill` 工具调用则通过同一个官方注册表加载正文，结果使用规范的 `<skill_content>` 包装。两条路径均执行各自的用户/模型调用策略；demo 不再注册 `skill_read` 或自行拼接技能系统提示词。

`web/skills.js` 只更新列表，轮询不覆盖编辑草稿。详情响应和文件导入带版本检查，旧请求不能覆盖用户已经继续编辑的文本。预览使用与助手回答相同的安全 Markdown 解析器，HTML 标签作为文字显示。导入、预览和导出都不会自动启用技能。

| 接口 | 用途 |
| --- | --- |
| `GET /api/skills` | 网页及本地技能摘要、用户/模型可调用状态、官方补全目录 commands、保存位置与大小上限。 |
| `GET /api/skills/detail?id=...` | 读取一个技能的完整 SKILL.md 和解析后的正文。 |
| `POST /api/skills/preview` | `{markdown}` 校验预览，不改变配置或会话。 |
| `POST /api/skills/save` | `{markdown, enabled}` 新建，或加 `id` 编辑网页技能。 |
| `POST /api/skills/toggle` | `{id, enabled}` 切换启用状态。 |
| `POST /api/skills/delete` | `{id}` 删除网页技能。 |

### `web/debugger.js`：展示、补读与导出

浏览器按 runId 和 seq 合并 SSE 与详情快照，晚到的旧快照不会覆盖较新的事件。原始内容始终用 textContent 展示；下载先读服务端完整详情，界面上的关键步骤过滤、提示词摘要与重绘节流都不影响导出。

时间线按当前轮次和事件序号复用已有 `details` 节点，只插入新事件；定时刷新和模型流式更新不会重建已经展开的详情。正文没变化时不重复写入，因此展开状态、键盘焦点、详情内部滚动和文字选择都能保留。切换过滤条件或调用记录后也会恢复本页先前的展开状态；清空记录时移除对应状态。

插件开关显示 enabled 和 phase 两个状态，并把真实 modelReady 通知聊天脚本。插件切换使旧 Agent 失效时，聊天页面重置，但调用记录不清空。响应原文、框架分片、请求与思考文本是不同数据投影，选择器不会重新请求模型。

插件树按服务端 `parentId` 连接节点，再递归生成嵌套的 ul/li；左侧展开按钮只切换子列表的 hidden，右侧启停按钮才调用控制 API。页面用 Set 保存折叠的完整条目 ID，并在轮询重绘后恢复原控件的键盘焦点。它使用原生按钮与列表语义，不要求用户通过特殊的树组件快捷键才能操作。

### `cordis.patch.yml` 与 `cordis.web.patch.yml`：组合而非业务

YAML 中 `id` 是 patch 定位用的稳定条目 ID，`name` 是模块路径，`config` 是传给该模块的参数。基础 patch 使用 insert 加入显式组件，Web patch 用相同 ID 禁用终端条目，再 insert HTTP 与 Web 入口。

`!!js` 是本框架支持的表达式标签，不是所有 YAML 工具都能直接执行。`>-` 后的缩进正文是一段 JS 表达式，折叠成一行后求值。因此正文中的教学注释使用 JS 的 `/* ... */`，不能插入会被当作表达式文字的 YAML `#`。

`agents: []` 表示不在配置加载阶段自动创建固定 Agent。创建时机交给终端入口或网页请求。模式和模型通过 `DSH_DEMO_OFFLINE`、`DSH_MODEL` 选择；环境变量原本是字符串，schema 需要的布尔与数值由表达式转换。

### `scripts/run.mjs`：官方启动器的薄包装

此文件先解析 `process.argv`，识别 mode、`--offline` 和 Web 的 `--port`，拒绝剩余未知参数。`const args` 仍可调用 splice 修改数组内容；const 限制的是重新绑定变量，不是冻结数组。

它准备 `.dsh/profiles/minimal-chat/package.json`，仅首次生成且不覆盖已有清单。启动时把 `TSX_TSCONFIG_PATH` 指向项目内部 `vendor/harness/tsconfig.base.json`，把 `DSH_HOME` 指向本目录数据。最后转发 SIGINT/SIGTERM，并将子进程退出码作为自己的结果。

`code ?? fallback` 保留成功状态码 0。若误写成 `code || fallback`，0 会因为是假值被替换，导致成功被误报失败。这是这个短表达式里最需要理解的语义。

### 五平台 MCP 服务与集成测试

`simulation/platform-mcp/server.mjs` 使用官方 SDK 注册工具并转发 HTTP 请求。运行 `npm run mcp:smoke` 可验证工具发现、实际 HTTP 调用、错误返回及插件启停。

独立性测试会复制源码到新临时目录，排除原来的依赖、运行数据、声明和编译缓存，再执行 `npm ci`、类型检查和全部功能 smoke 和仿真约束测试。它逐个核对 workspace 链接的真实目标是否位于副本内部，并在结束后删除自己创建的临时目录。这个验证不依赖真实模型 API Key。

## 7. 逐个读懂前端文件

### `web/index.html`：结构和语义

`head` 定义 UTF-8、移动视口、标题与外部资源；script 的 defer 保证 DOM 解析完成后再运行 app.js。`id` 用来让 JS 定位唯一节点，`class` 连接 CSS 样式，`data-prompt` 保存建议按钮对应的实际输入。

表单、label、textarea、button 使用原生 HTML 语义。`aria-label` 给只有图形的按钮命名，`aria-hidden` 隐藏纯装饰符号，`sr-only` 标签视觉隐藏但仍可被辅助技术读取。HTML 只创建初始结构，不直接保存 Agent 或调用模型。

### `web/style.css`：外观与响应式布局

`:root` 定义全局字体、颜色与变量；`.app` 用 flex 列布局固定为动态视口高度；`.main` 在剩余高度内独立滚动，页头和输入区保持原位。滚动到对话顶部或底部不会继续带动外层页面；流式回复在接近底部时自动跟随，向上翻阅时保留阅读位置。切换历史和发送新消息也只调整对话区域的滚动位置，右侧面板独立。窄屏保持上下布局，可在对话区域外向下浏览调试面板。`.main` 与输入页脚限制阅读宽度。消息根据 user/assistant/error 类调整外观，用户正文的 pre-wrap 保留换行，overflow-wrap 允许长字符串折行。助手正文的 `.markdown-body` 使用普通块级排版，分别为标题、列表、引用、行内代码、围栏代码和表格设置样式；长代码与宽表格在自己的容器中横向滚动。

输入页脚使用 sticky 靠近视口底部。`@media(max-width:600px)` 只覆盖窄屏需要变化的属性，不是复制第二份页面。颜色、边距和圆角均只影响呈现，不改变会话历史。每条属性旁的注释同时解释其值和 CSS 语法。

### `web/app.js`：网页状态、取消和流解码

sessionId 指向服务端 Agent；busy 控制页面能否重复提交；controller 取消当前网络工作；revision 标记当前对话版本。每次发送先把 revision 拍成 current，新对话再递增 revision。旧请求迟到时发现版本不符，就不能覆盖新页面或错误地解锁新请求。

fetch 收到 400/500 不一定抛错，所以 checked 显式检查 response.ok。首次发送先创建会话，再提交聊天。界面先创建本轮问题和等待提示，`turnNumber` 每次提交递增，工具调用和后续模型请求不会增加此编号。`run` / `trace` 同时交给 `chat-turns.js` 和右侧调试面板，`delta` 只作为助手正文交给轮次视图。

`web/files.js` 保存待发送附件队列，先上传再发送回执 ID。`app.js` 允许“文字或附件”任一非空；上传未完成或有失败项时禁止发送。消息失败时恢复本轮附件，开始新对话时取消未完成上传并清空队列；已保存原件保留在文件面板中。用户消息通过纯文本文件名和真实下载链接展示附件，不执行文件名中的 HTML。

助手 Markdown 支持标题、加粗、斜体、删除线、嵌套列表、引用、链接、表格、行内代码和围栏代码。用户输入、错误提示与调试面板继续通过 textContent 展示原文；渲染不会修改服务端会话历史、模型原始输出或 JSON 下载内容。

网络数据块不等于 SSE 事件，甚至可能把一个中文字符拆开。TextDecoder 的流模式先解决跨块 UTF-8 解码，buffer 再按两个换行拆完整事件。服务端使用的最小协议类似：

```text
event: delta
data: {"text":"你好"}

event: done
data: {}

```

这里有两种 done：reader.read() 的 done 表示网络正文结束，SSE 的 done 表示服务端确认本轮成功。只有后者到达，前者才被当成正常完成；提前断线不能冒充成功。

键盘处理尊重补全模块已经处理的事件，并检查 isComposing、组合输入状态和输入法兼容键码，避免中文输入法确认候选词时误发送。新对话和离页用 AbortController 中止读取，并尽力请求 DELETE。网络错误会显示 notice，已有部分回复保留，且在不覆盖用户下一条草稿的前提下恢复失败输入。

### `web/completion.js`：从命令到实际可用名称

`context()` 根据光标位置识别 `/`、`/skill`、`/mcp` 和名称片段；选区、文件路径和 JSON 不参与补全。`sync()` 筛选候选项，用 `textContent` 创建选项；焦点始终留在输入框，`aria-activedescendant` 指向当前候选项。

`accept()` 通过 `setRangeText` 只替换当前词，保留光标后已有内容，并触发 input 更新按钮。它不提交表单；聊天键盘监听器通过 `defaultPrevented` 判断本次 Enter 是否已经用于补全。`refresh()` 并行读取官方用户调用目录和实际连接的 MCP 服务工具，使用版本号丢弃管理操作前发出的旧响应。固定入口只有 `/skill` 与 `/mcp`，具体技能和工具不硬编码。

### `web/chat-turns.js`：一轮中的回答与工具结果

每轮创建独立的 `section.chat-turn`，用户问题、助手文字和工具卡片按实际到达顺序加入。`agent/frame` 的 start 帧携带 `attemptId` 和步骤信息，下一次模型调用因此拥有独立正文，不再把工具调用前后的 Markdown 强行拼成一段。

`session/tool/call` 提供调用 ID、工具名和参数；`session/tool/result` 的 `message.toolCallId` 将结果精确配回原卡片。实际调用工具的步骤已有模型文字时改标“助手说明”；最终答复保留“助手回答”。工具内容只经 `textContent` 展示，完整事件保留原有内容块、错误及元数据，短结果之外的大对象默认折叠。卡片更新只修改自己的节点，不会因其他步骤生成而自动收起。

每段助手文字独立累计，通过 requestAnimationFrame 每帧最多渲染一次完整 Markdown；完成和失败时同步刷新最后一版。正文只从 `delta` 添加，trace 中重复出现的相同文字不再追加，防止回复重复。工具明确返回 `isError` 才标记“执行失败”；轮次结束前尚未收到工具结果则标记“结果未确认”。

### `web/markdown.js`：Markdown 到 HTML

项目通过 npm 安装并锁定 `markdown-it`，Web 插件仅将它的浏览器构建映射为 `/markdown-it.js`，不会公开整个 node_modules，也不依赖外部 CDN。相关 defer 脚本依次执行：解析器 → `files.js` → `markdown.js` → `chat-turns.js` → `app.js`。

`markdown.js` 设置 `html:false`，因此模型返回的 `<script>`、`<iframe>` 和其他原始 HTML 会作为文字显示。只把解析器生成并转义后的 HTML 放进正文节点；危险链接使用解析器默认校验规则过滤。链接设置 `target="_blank"` 和 `rel="noopener noreferrer"`，表格增加独立横向滚动容器。配置方式参考 [markdown-it 官方文档](https://github.com/markdown-it/markdown-it)。以后若启用原始 HTML 或增加能输出 HTML 的插件，需要重新检查这些安全边界。

## 8. 验证脚本为什么存在

仿真相关的 `npm run simulation:test` 检查资源边界、真实串并行、取消/失败和脚本生成，详见 [仿真验证说明](simulation/README.md#8-验证)。

| 文件 | 主要验证 | 不宣称验证的内容 |
| --- | --- | --- |
| `scripts/smoke.mjs` | 实际插件树、两轮历史、空行、EOF、/exit、未知参数、缺密钥失败、SIGINT。 | 真实模型问答效果。 |
| `scripts/web-smoke.mjs` | 实际 HTTP 静态资源、SSE 事件、多轮历史、会话隔离、输入/来源检查、删除及错误后可继续请求。 | 完整浏览器布局或真实外部 API 回复。 |
| `scripts/standalone-smoke.mjs` | 无相邻仓库的全新目录安装、框架构建、类型检查及下面各项功能验证；内部链接真实路径检查。 | 其他平台和未复制的官方插件。 |
| `scripts/platform-mcp-smoke.mjs` | 五平台工具发现、stdio 与 HTTP 映射、工具错误、停用与恢复。 | 任意外部 MCP 服务的可用性。 |
| `scripts/mcp-management-smoke.mjs` | stdio/HTTP 注册、工具可见性、子进程退出、凭据隐藏和保留、并发互斥、重启恢复、删除和 YAML 不被改写。 | 外部服务的可用性和用户自行配置的启动命令。 |
| `scripts/bash-smoke.mjs` | 官方 Bash 实际执行、退出码、环境、超时、输出溢出、长命令取消、启停及恢复。 | 任意系统命令的可用性、通用后台 jobs 或文件沙箱。 |
| `scripts/sessions-smoke.mjs` | 保存与恢复、关闭保留、永久删除与重启不复活、跨进程写锁、活动命令清理和原件保留。 | 浏览器布局和外部模型回复质量。 |
| `scripts/files-smoke.mjs` | 真实文件上传、原样校验、官方 file 消息、工具读取、生成文件下载、重启与拒绝非法路径。 | 各种文档格式自动解析、OCR 或图片理解。 |
| `scripts/skills-smoke.mjs` | 格式校验、技能 CRUD、摘要与正文按需分离、官方工具/显式注入、调用权限、文件发现、依赖恢复、重启恢复和损坏配置保护。 | 真实模型是否正确理解或遵循用户编写的技能。 |
| `scripts/debug-smoke.mjs` | 根 include、真实 Group/嵌套 Include 的父子归属及容器只读权限；七核心启停、服务依赖/动态注入/隔离作用域与缺失恢复、完整事件、原生 HTTP 正文/字节、错误、取消与恢复。 | 外部真实模型效果；夹具内容明确为测试构造。 |

这些脚本都启动用户实际使用的命令，不用 testkit 代替配置加载。真实适配器的失败测试显式清空 API Key，并把地址限定为本机无效端点；不会继承真实凭据发出收费请求。assert 不满足就抛错，只有全部断言通过才会打印“通过”。

```bash
# 验证终端路径；无需 API Key。
npm run smoke
# 验证真实 HTTP 与 SSE；需要环境允许监听本机端口。
npm run web:smoke
# 用本机模型协议夹具验证真实插件控制与原始响应捕获，不调用外部模型。
npm run debug:smoke
# 从副本源码检查框架类型并生成声明。
npm run build
# 验证 MCP 服务真实执行、结果回传与网页开关，无需 API Key。
npm run mcp:smoke
# 验证网页 MCP 注册管理、持久化和重启恢复，使用隔离的本机配置文件。
npm run mcp:management:smoke
# 验证技能管理、模型摘要与官方 skill 加载与 /技能名 注入，不调用外部模型。
npm run skills:smoke
# 验证官方 Bash 前台执行与取消清理，无需模型密钥。
npm run bash:smoke
npm run files:smoke
npm run sessions:smoke
# 检查教学入口 TypeScript，不启动 Agent。
npm run typecheck
# 全新临时目录重新安装与运行全部验证；需要 npm 下载和本机端口权限。
npm run standalone:smoke
# 分别查看终端、Web 组合树，不执行对话。
npm run config -- --offline
npm run config:web -- --offline
```

配置打印可能保留 `!!js` 表达式原文，表达式在启动过程中才求值。运行 smoke 成功、类型检查通过和真实模型生成成功分别证明不同事情，不能相互替代。

## 9. JSON 文件的逐行解释

以下代码块使用 `jsonc`，允许放教学注释；磁盘中的真实文件仍是严格 JSON。对象的 `{}` 表示键值集合，数组的 `[]` 表示有序列表，逗号分隔成员；JSON 属性名和字符串都必须用双引号。

### `package.json`

```jsonc
// 开始根 JSON 对象。
{
  // 本地项目包名，不是模型名称或插件 ID。
  "name": "dsh-secondary-development-demo",
  // 本 demo 的版本号，与保存的框架版本分别管理。
  "version": "0.1.0",
  // 阻止意外发布到公共 npm。
  "private": true,
  // 让 Node 按 ESM 解释本包的 .js。
  "type": "module",
  // 项目说明，不参与组件注册。
  "description": "\u663e\u5f0f\u52a0\u8f7d\u4e03\u4e2a\u6838\u5fc3\u63d2\u4ef6\u7684\u6700\u5c0f\u7ec8\u7aef\u4e0e Web \u5bf9\u8bdd Agent",
  // 声明所需 Node 版本。
  "engines": {
    // 支持 Node 22.19 起的 22.x，或 Node 24 及以上。
    "node": "^22.19.0 || >=24.0.0"
  // 结束当前对象或数组；逗号表示后面还有同层成员。
  },
  // npm run 按下面键名执行命令。
  "scripts": {
    // 启动终端对话，接受 --offline。
    "demo": "node scripts/run.mjs demo",
    // 启动独立 Web 调试页面，接受 --offline 和 --port。
    "web": "node scripts/run.mjs web",
    // 验证 HTTP 静态资源、聊天与会话。
    "web:smoke": "node scripts/web-smoke.mjs",
    // 验证终端对话、组合树和退出。
    "smoke": "node scripts/smoke.mjs",
    // 打印终端模式配置。
    "config": "node scripts/run.mjs config",
    // 打印叠加 Web patch 后的配置。
    "config:web": "node scripts/run.mjs config-web",
    // 用本项目的 tsc 严格检查教学入口代码。
    "typecheck": "node scripts/run.mjs typecheck",
    // 通过本机模型协议夹具验证原始内容、插件启停与取消。
    "debug:smoke": "node scripts/debug-smoke.mjs",
    // 按项目引用检查保存的框架源码，生成类型声明。
    "build": "tsc -b vendor/harness/tsconfig.json",
    // npm install 和 npm ci 安装后自动执行构建。
    "prepare": "npm run build",
    // 复制到独立临时目录重新安装，检查构建与全部功能。
    "standalone:smoke": "node scripts/standalone-smoke.mjs",
    // 经过真实 AgentLoop 与本机 stdio 服务验证工具调用、错误和启停恢复。
    "mcp:smoke": "npm run platform:mcp:smoke",
    // 验证网页 MCP 服务注册、管理和重启恢复。
    "mcp:management:smoke": "node scripts/mcp-management-smoke.mjs",
    // 验证指令型技能管理、按需加载和重启恢复。
    "skills:smoke": "node scripts/skills-smoke.mjs",
    // 直接运行相同模板流程，参数可选规模和目标阶段。
    "simulation": "node scripts/simulation-workflow.mjs",
    // 真子进程验证 DAG、串行锁、资源边界、故障和回收。
    "simulation:test": "node --test simulation/workflow.spec.mjs",
    // 经官方 MCP 协议和真实 Agent/Web 验证任务交互。
    // 验证官方 Bash 执行、输出、超时、取消与依赖恢复。
    "bash:smoke": "node scripts/bash-smoke.mjs",
    "files:smoke": "node scripts/files-smoke.mjs",
    "sessions:smoke": "node scripts/sessions-smoke.mjs"
  // 结束当前对象或数组；逗号表示后面还有同层成员。
  },
  // 让 npm 将这些目录作为本项目的本地包链接，避免从相邻仓库读取。
  "workspaces": [
    // 匹配项目内部的一组框架包目录；npm 链接的是本目录下的真实副本。
    "vendor/harness/vendor/*",
    // 匹配项目内部的一组框架包目录；npm 链接的是本目录下的真实副本。
    "vendor/harness/packages/*/*",
    // 匹配项目内部的一组框架包目录；npm 链接的是本目录下的真实副本。
    "vendor/harness/apps/*"
  // 结束当前对象或数组；逗号表示后面还有同层成员。
  ],
  // 执行应用所需的根依赖；框架各包的通用依赖写在各自清单中。
  "dependencies": {
    // 执行 TypeScript 源码的加载器，本身不做严格类型检查。
    "tsx": "^4.23.13",
    // 本机示例使用官方 MCP Server SDK，不自行实现协议解析。
    "@modelcontextprotocol/server": "2.2.0",
    // 为示例工具的数字参数提供运行时校验和可发现的 JSON Schema。
    "zod": "4.4.3",
    // 将助手 Markdown 转换成安全配置下的 HTML，浏览器包由本机提供。
    "markdown-it": "15.0.3",
    // 安全解析 SKILL.md 的 YAML 元信息，拒绝自定义 JS 标签。
    "js-yaml": "4.3.2"
  // 结束当前对象或数组；逗号表示后面还有同层成员。
  },
  // 构建和类型检查所需依赖；此源码项目安装时应保留它们。
  "devDependencies": {
    // 提供 tsc，检查框架和入口并生成框架声明。
    "typescript": "^6.0.3",
    // 为引用的第三方库补充 TypeScript 类型声明。
    "@types/node": "^22.20.1",
    // 为引用的第三方库补充 TypeScript 类型声明。
    "@types/js-yaml": "^4.0.9",
    // 为引用的第三方库补充 TypeScript 类型声明。
    "@types/semver": "^7.8.0",
    // 为引用的第三方库补充 TypeScript 类型声明。
    "@types/babel__code-frame": "^7.27.0",
    // 为引用的第三方库补充 TypeScript 类型声明。
    "@types/picomatch": "^4.0.3",
    // 为引用的第三方库补充 TypeScript 类型声明。
    "@types/compression": "^1.8.1",
    // 为引用的第三方库补充 TypeScript 类型声明。
    "@types/negotiator": "^0.6.5",
    // 集成测试直接使用官方 MCP 客户端，避免依赖传递提升。
    "@modelcontextprotocol/client": "2.2.0"
  // 结束当前对象或数组；逗号表示后面还有同层成员。
  }
// 结束当前对象或数组；逗号表示后面还有同层成员。
}
```

### `tsconfig.json`

```jsonc
// 开始根 JSON 对象。
{
  // TypeScript 检查选项，不是插件运行配置。
  "compilerOptions": {
    // 按 ES2024 理解运行时能力。
    "target": "ES2024",
    // 按 NodeNext 模式理解模块格式。
    "module": "NodeNext",
    // 按 Node 的模块规则读取本项目 node_modules 中包的 exports。
    "moduleResolution": "NodeNext",
    // 启用严格类型检查，及早发现不合规的参数与空值使用。
    "strict": true,
    // 教学入口只检查，不生成 JavaScript，运行由 tsx 完成。
    "noEmit": true,
    // 跳过声明文件内部检查；框架源码由 build 单独检查。
    "skipLibCheck": true,
    // 允许相对 import 写出 .ts 后缀。
    "allowImportingTsExtensions": true,
    // 自动纳入 Node 全局类型。
    "types": [
      // 开始根 JSON 对象。
      "node"
    // 结束当前对象或数组；逗号表示后面还有同层成员。
    ]
  // 结束当前对象或数组；逗号表示后面还有同层成员。
  },
  // 只把教学 src 和 scripts 下的 .ts 纳入这个检查项目。
  "include": [
    // 开始根 JSON 对象。
    "src/**/*.ts",
    // 开始根 JSON 对象。
    "scripts/**/*.ts"
  // 结束当前对象或数组；逗号表示后面还有同层成员。
  ]
// 结束当前对象或数组；逗号表示后面还有同层成员。
}
```

## 10. `.gitignore` 的规则

`.dsh/` 忽略 profile、日志及本地验证截图；`node_modules/` 忽略安装产物；`.env` 忽略可能带凭据的本地部署文件；`*.tsbuildinfo` 忽略可以重建的类型检查缓存；`vendor/harness/**/lib/` 忽略可从副本源码重新生成的声明目录。规则只影响 Git 是否跟踪文件，不意味着浏览器可访问这些路径，也不会让程序自动读取 `.env`。

## 11. 阅读逐行注释时，先掌握这些语法

| 写法 | 在本项目中怎么理解 |
| --- | --- |
| `const` / `let` | const 不允许重新绑定变量，let 允许；const 数组或对象仍可能被修改。 |
| `import type` | 只给类型检查器看，执行前会移除；不等于真正启动某服务。 |
| `import type {}` | 引入库的类型扩展，使 Context 认识插件服务和事件。 |
| `export` | 把名字提供给其他模块或 Cordis 插件加载器。 |
| `value: Type` | 冒号后描述类型，调用函数时只传 value，不传类型名。 |
| `interface` / `type` | 描述合法数据或函数形式，不能代替运行时输入校验。 |
| `unknown` | 值的类型尚不明确，必须检查后才能读字段；比无条件放行更有帮助。 |
| `async` / `await` | async 函数返回 Promise；await 等待结果，不代表创建线程，也不保证结果一定成功。 |
| `async *` / `yield` | 异步生成器逐项产出结果；用于模型流，而不是一次 return 完整回复。 |
| `({ frame })` | 参数解构，从对象中取出 frame 变量。 |
| `({ article, content })` | 对象属性简写；括号在箭头函数返回对象时可避免把花括号误当函数体。 |
| `...array` / `...object` | 把数组元素或对象字段展开；后面的同名对象字段会覆盖前面字段。 |
| `?.` | 目标为 null/undefined 时停止本段访问，返回 undefined。 |
| `??` / `||` | ?? 只处理缺失值；|| 处理所有假值，包含空串、0 和 false，不能随意互换。 |
| `.filter()` / `.map()` | filter 筛选元素，map 转换每个元素；两者返回新数组。 |
| `try/catch/finally` | try 执行，catch 处理失败，finally 保证收尾；资源释放通常放在 finally。 |
| `void promise` | 明确丢弃表达式结果，不会自动处理拒绝；代码仍须安装 then/catch 失败处理。 |

一个尤其容易混淆的生命周期写法是：

```ts
// 外层函数在注册 effect 时执行；它返回的内层函数在清理时执行。
ctx.effect(() => () => input.close(), 'terminal-chat-input')
```

上面不是“创建输入后立即关闭”。同样，注册 `ctx.on(..., callback)` 不是立刻执行 callback，调用 `followup(...)` 才会唤醒 Agent 产生后续事件。

## 12. 可以亲手做的三次修改

1. 修改基础 YAML 的 personaPrefix，重启真实模式后观察模型回复风格；离线适配器不会理解系统提示词，所以不能用模拟回显评价这项变化。
2. 修改 index.html 的欢迎文案或 style.css 的 --green，重启 Web 并刷新；页面资源在插件启动时读取，没有自动热更新。
3. 修改 offline-adapter.ts 的回显文字，再运行终端、Web 和调试 smoke。若预期文字改变，相关断言可能失败；先确认实际历史仍正确，再更新测试预期，不要直接删除断言。

读懂后可在保留这套输入、事件和生命周期结构的基础上增加业务工具。不要仅因为暂时没有工具就删掉 dsh-tools：当前 AgentLoop 把它作为必需依赖。本示例已在 Web 接入官方持久化历史；登录或完整官方 Web 界面仍需要另行组合相应组件。

## 13. 常见问题

| 现象 | 检查与处理 |
| --- | --- |
| 提示缺少 tsx、MCP SDK 或类型声明 | 在 `dsh-demo` 根目录执行 `npm ci`，让依赖安装和 prepare 构建完成。若修改了框架源码，补跑 `npm run build` 与 `npm run typecheck`。 |
| `npm ci` 报 Node 版本不符合要求 | 用 `node --version` 确认满足 `package.json` 的 engines 范围，再使用对应环境安装。 |
| 默认端口无法监听或提示地址占用 | 使用 `npm run web -- --offline --port 3081`，或用 `--port 0` 后访问日志给出的地址。 |
| 网页提示从启动日志中的地址访问 | 使用相同的协议、主机和端口，例如 `http://127.0.0.1:3080`；不要把 `localhost` 和 `127.0.0.1` 混用。 |
| 发送按钮提示依赖未就绪 | 在插件面板检查七个核心服务和当前模式的模型适配器；恢复被停用的条目并等待依赖激活。MCP 单独停用不会阻止普通聊天。 |
| 离线模式没有 HTTP 原文或思考文本 | 模拟模型没有外部 HTTP 响应，也没有 reasoning 分片；可查看完整模型分片、请求和 MCP 工具调用记录。 |
| 启停插件后无法发送 | 插件切换会保存并释放当前 Agent，历史记录保留；依赖恢复后继续发送会从原会话恢复，也可通过“历史会话”重新打开。 |
| 改了 YAML、页面或工具实现，界面没有变化 | 停止服务后重新启动；此 demo 没有为教学入口配置自动热更新。页面资源在插件启动时读取。 |
| 想确认仍然可以独立运行 | 执行 `npm run standalone:smoke`，它会在全新目录重新安装与验证，需要 npm 下载权限和本机端口权限。 |
