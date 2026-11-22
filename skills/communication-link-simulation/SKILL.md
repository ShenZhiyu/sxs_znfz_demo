---
name: communication-link-simulation
description: 分阶段确认参数，调用五个平台的 MCP 工具执行离线模拟通信链路仿真，并支持在声场及信号处理节点使用用户自有算法。
---

# 模拟通信链路仿真

适用于合成数据、预置记录和用户提供的本地算法。工具通过 P1 环境、P2 声场、P3 信号处理、P4 回放、P5 评估五组服务执行。一次会话内逐阶段推进。

## 确认与记录

- 首轮只说明流程并询问目标和 P1 参数。每到一个标有“确认”的关口，先汇总已知参数、拟采用的默认值、缺失项和计划使用的算法，然后结束本轮，等待用户明确确认或修订。用户直接给出的参数要带入确认，避免要求重复填写。用户可暂停或跳过可选分支，跳过项记入报告。
- 用户修改已确认的参数或替换算法时，标记受影响的步骤和产物，确认最早需要重跑的节点后再执行。用户要求停止时停止提交和查询，已有回放或评估任务的状态保留最后一次查询结果。
- 从工具成功返回的 `data` 提取引用，记录服务的 `requestId`、任务的 `jobId`、`resultId`、算法来源及产物路径。遇到工具不可用、引用缺失或任务失败时暂停，展示节点和错误信息。重试已提交的写操作时沿用同一业务载荷和幂等键。

## 调用顺序

1. **确认环境来源（P1）**。确认本次目标、使用已有数据集还是导入，以及对应的 `datasetId`、文件相对路径或 JSON 数据。默认已有数据集为 `demo-environment`。可以先用 `mcp__environment__list_environment_datasets` 查选项；若选择按地点查询，确认经纬度和历史月份，再调用 `mcp__environment__query_environment_history` 或 `mcp__environment__query_environment_observations`。查询返回环境对象，若需把该对象作为 P2 的平台输入，先确认导入元数据并登记为数据集取得 `datasetId`。确认导入后才调用 `mcp__environment__import_environment_dataset`，文件和 JSON 二选一；需要完整数据时用 `mcp__environment__get_environment_dataset_content`。
2. **确认声场模式与算法（P2）**。确认 `environmentRef`、声场模式和预置结果或自定义算法。Mock 示例为 `fixtureId: "demo-field"`、`mode: "point_to_point"`。使用平台时调用 `mcp__acoustic_field__get_acoustic_field_result`。使用自定义声场时按下节执行并保存声场坐标轴与切片，供报告或后续本地信号处理使用。
3. **确认信号参数与替换节点（P3）**。确认原始比特、是否采集信道和噪声、需要的噪声样本数、每个处理节点的算法。Mock 示例为 `fixtureId: "demo-signal"`、原始比特 `[0,1,1,0]`。按需调用 `mcp__signal_processing__get_synthetic_channel_response` 和 `mcp__signal_processing__get_synthetic_background_noise`。平台处理链依次调用 `mcp__signal_processing__encode_bits`、`mcp__signal_processing__synthesize_signal`、`mcp__signal_processing__decode_signal`，依次传递 `encodedRef`、`signalRef`。用 `mcp__signal_processing__calculate_bit_error_rate` 对比原始和解码比特，确保两组数组均为非空、等长的 0/1 数组。默认 Mock 示例预期有 1 个误码，误码率为 0.25。
4. **确认回放记录（P4）**。可先用 `mcp__replay__list_replay_records` 查选项，再请用户确认 `recordId` 及 `fixtureId`，示例为 `demo-record`、`demo-replay`。确认后调用 `mcp__replay__submit_replay_job`，用 `mcp__replay__get_replay_job_status` 查询。成功时用 `mcp__replay__get_replay_result` 读取结果，并构造 `replay:<resultId>`。本接口回放预置记录，声场和信号处理产物只在本次报告中关联。
5. **确认评估输入（P5）**。确认 `fixtureId` 和 `inputRefs`。默认 `demo-eval`，证据使用本次 `replay:<resultId>`；也可以选择证据不足的 `demo-eval-insufficient`。确认后依次调用 `mcp__evaluation__submit_evaluation_job`、`mcp__evaluation__get_evaluation_job_status` 和 `mcp__evaluation__get_evaluation_result`。回放或评估处于 `queued` 或 `running` 时可继续查询。同一轮查询三次仍未到终态时报告当前状态，等待用户继续。失败时记录 `failureCode`。任务状态与报告 `verdict` 分别记录，Mock 的判定来自预置结果。

## 接入用户自有算法

在 P2 或 P3 的确认环节，用户可提供结果 JSON 文件，或指定已准备好的本地程序。展示入口文件、工作目录内相对路径、运行时、完整命令与参数、输入输出文件以及预定替换的节点，取得本轮明确确认后才调用 Bash。只执行用户指定且经确认的本地程序。算法失败、输出缺失或校验失败时等待用户修正或确认回退到平台工具。

将本次算法输入和结果分别放在工作目录相对路径 `link-runs/<运行ID>/`。约定每次调用从输入 JSON 文件读取参数并向单独的输出 JSON 文件写结果。若算法使用不同的调用约定，先确认字段映射和文件路径。替换范围与交接规则如下：

| 替换节点 | 输入 JSON | 输出 JSON 与交接 |
| --- | --- | --- |
| P2 声场 | `{environment, mode}`，其中 `environment` 来自用户确认的 P1 数据 | `{axes, slices}`，切片索引需对应各坐标轴，传播损失矩阵的行列分别对应接收深度和距离。记录产物，可传给本地 P3 算法。 |
| P3 编码 | `{bits}` | `{encodedBits}`，传给本地信号生成算法。平台生成工具只接受平台生成的 `encodedRef`，替换编码需同时确定后续本地生成和解码。 |
| P3 信号生成 | `{encodedBits?, field?, channel?, noise?}`，只传已确认要消费的产物 | `{samples, sampleRateHz}`，样本均为有限数字，采样率为正整数。传给本地解码。跳过编码时，需确认算法是否可直接生成。 |
| P3 解码 | `{samples, sampleRateHz}`，可直接使用平台生成工具返回的样本 | `{bits}`，比特为 0/1，长度与原始比特一致。通过平台误码统计工具或用户确认的本地统计输出结果。 |
| P3 误码统计 | `{expectedBits, actualBits}` | `{comparedBits, bitErrors, bitErrorRate}`，核对比较长度、误码数范围以及比值。 |

本地生成的样本没有平台发放的 `signalRef`，应继续由本地解码。结果 JSON 可作为已完成节点的输入，但需校验字段、维度与当前确认参数。记录用户提供的文件、实际运行的程序及平台返回分别对应哪些结果。

## 交付

汇总各节点的确认参数、所用算法、结果、文件与请求追踪编号。分别报告本次计算的误码指标、回放证据以及 P5 预置结论。列出跨阶段实际传递了哪些数据，并注明 P2、P3 的本次产物未被 P4 回放或 P5 评分消费。失败或跳过的步骤按实际状态标明。
