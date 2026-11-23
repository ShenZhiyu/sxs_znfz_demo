# 五平台离线 HTTP Mock

在项目根目录运行：

```bash
npm run mock:platforms
npm run mock:platforms:test
```

默认地址为 `http://127.0.0.1:3081/mock/v1`。可以用 `npm run mock:platforms -- --port 3082` 指定端口，或传 `--port 0` 让系统分配。启动后可直接调用接口。

```bash
curl 'http://127.0.0.1:3081/mock/v1/env/datasets?published=true'

curl 'http://127.0.0.1:3081/mock/v1/field/simulations' \
  -H 'Content-Type: application/json' \
  -d '{"fixtureId":"demo-field","mode":"point_to_point","environmentRef":"demo-environment"}'
```

接口字段与联调用例见[仿真平台接口清单与离线 Mock 约定](../../仿真平台接口清单与离线Mock约定.md)。

| 平台 | 接口 | 预置标识 |
| --- | --- | --- |
| P1 环境数据 | ENV-01 至 ENV-09 | 数据集 `demo-environment`、噪声 `demo-noise`、信道 `demo-channel` |
| P2 声场 | FIELD-01 | `demo-field` |
| P3 信号处理 | SIG-01 至 SIG-06 | `demo-signal` |
| P4 回放 | REPLAY-01 至 REPLAY-04 | fixture `demo-replay`、记录 `demo-record` |
| P5 评估 | EVAL-01 至 EVAL-04 | `demo-eval`、`demo-eval-fail`、`demo-eval-insufficient`、`demo-eval-failed` |

- 五组路由在同一进程运行。导入的数据集、编码与信号引用、回放和评估任务以及幂等记录保存在内存，重启后恢复初始数据。任务提交后为 `queued`，第一次查询返回 `running`，第二次起返回终态。
- `demo-eval-fail` 的任务终态为 `succeeded`，报告结论为 `fail`。`demo-eval-failed` 的任务终态为 `failed`，返回 `failureCode`。`demo-eval-insufficient` 的任务终态为 `succeeded`，报告结论为 `insufficient_evidence`。
- 导入数据默认未发布。文件导入可按原字节下载，内容是 JSON 对象时还能用 JSON 视图读取。图层视图返回固定测试 PNG。请求体上限为 4 MiB，SIG-02 单次最多生成 100,000 个噪声样本。
- `X-Request-Id` 可跨调用传递。可用 `X-Mock-Fault: timeout` 或 `X-Mock-Fault: unavailable` 验证失败和重试流程。数据导入、发布状态更新、回放建任务和评估建任务支持 `Idempotency-Key`。
- Agent 编排可使用 P1 → P2、P3 内部处理、P4 → P5 三条已有的引用路径。P2、P3 的结果与 P4、P5 的衔接待编排阶段定义。

## 接入终端和 Web Agent

保持 HTTP Mock 运行，在另一个终端执行 `npm run demo -- --offline` 或 `npm run web -- --offline`。五组 MCP 客户端通过独立的 stdio 连接加载相应平台的工具。可在聊天中发送：

```text
/mcp__environment__get_environment_config
/mcp__signal_processing__calculate_bit_error_rate {"expectedBits":[0,1,1,0],"actualBits":[0,1,0,0]}
```

MCP 工具名由服务组和功能组成，形如 `mcp__<服务组>__<功能>`。五个服务可以分别启停。

| 平台 | MCP 服务组 | 工具数 |
| --- | --- | --- |
| P1 环境数据 | `environment` | 9 |
| P2 声场 | `acoustic_field` | 1 |
| P3 信号处理 | `signal_processing` | 6 |
| P4 回放 | `replay` | 4 |
| P5 评估 | `evaluation` | 4 |

Web 的「MCP 服务」列出工具和参数。真实模型模式可按自然语言选用工具。

| HTTP 接口编号 | MCP 工具 |
| --- | --- |
| ENV-01 | `mcp__environment__import_environment_dataset` |
| ENV-02 | `mcp__environment__list_environment_datasets` |
| ENV-03 | `mcp__environment__get_environment_dataset_content` |
| ENV-04 | `mcp__environment__get_environment_config` |
| ENV-05 | `mcp__environment__query_environment_history` |
| ENV-06 | `mcp__environment__query_environment_observations` |
| ENV-07 | `mcp__environment__get_noise_record` |
| ENV-08 | `mcp__environment__get_channel_record` |
| ENV-09 | `mcp__environment__set_environment_dataset_published` |
| FIELD-01 | `mcp__acoustic_field__get_acoustic_field_result` |
| SIG-01 | `mcp__signal_processing__get_synthetic_channel_response` |
| SIG-02 | `mcp__signal_processing__get_synthetic_background_noise` |
| SIG-03 | `mcp__signal_processing__encode_bits` |
| SIG-04 | `mcp__signal_processing__synthesize_signal` |
| SIG-05 | `mcp__signal_processing__decode_signal` |
| SIG-06 | `mcp__signal_processing__calculate_bit_error_rate` |
| REPLAY-01 | `mcp__replay__list_replay_records` |
| REPLAY-02 | `mcp__replay__submit_replay_job` |
| REPLAY-03 | `mcp__replay__get_replay_job_status` |
| REPLAY-04 | `mcp__replay__get_replay_result` |
| EVAL-01 | `mcp__evaluation__submit_evaluation_job` |
| EVAL-02 | `mcp__evaluation__get_evaluation_job_status` |
| EVAL-03 | `mcp__evaluation__get_evaluation_result` |
| EVAL-04 | `mcp__evaluation__get_evaluation_node_status` |

- `DSH_PLATFORM_BASE_URL` 设置共享 HTTP 基础地址，默认 `http://127.0.0.1:3081/mock/v1`。用 `DSH_PLATFORM_P1_BASE_URL` 到 `DSH_PLATFORM_P5_BASE_URL` 覆盖对应平台。基础地址须包含服务的 API 前缀，例如 `/mock/v1`。
- 所有工具接受可选的 `requestId`。环境数据导入、发布状态更新、回放和评估建任务另接受 `idempotencyKey`。HTTP 超时为 8 秒，回放和评估由调用方查询状态。Mock 未启动时，MCP 工具仍可被发现，调用会报告连接失败。
- `import_environment_dataset` 的文件输入使用工作目录相对路径 `filePath`，与 JSON 字段 `content` 二选一。可从 Web 文件面板上传原件并使用其工作目录相对路径。`get_environment_dataset_content` 的文件和图层保存在 `platform-artifacts/`，可从文件面板下载。上传须满足 Mock 的 4 MiB 请求限制，包含 multipart 元数据和封装开销。

运行 `npm run platform:mcp:smoke` 可验证 HTTP 映射、真实 MCP 调用以及终端与 Web Agent 的接入。

使用真实模型时，在 Web 聊天中发送 `/communication-link-simulation`。Skill 会逐节点确认参数，支持用用户自有算法替换声场和信号处理步骤。[调用顺序与算法输入输出](../../skills/communication-link-simulation/SKILL.md)
