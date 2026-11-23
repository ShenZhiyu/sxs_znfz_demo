# 仿真平台接口清单与离线 Mock 约定

本文基于五份平台技术方案，用于在没有真实服务的环境中模拟五个平台的调用，验证请求校验、任务调度、结果交接和异常处理。范围限于通用数据接口、合成数值结果和离线记录回放。涉及实装控制、实际发信或面向作战场景的参数优化的能力，仅在平台目录中保留功能名称。第 4、5 平台的 Mock 通过预置结果验证软件流程。

本文使用 **方案依据** 标注技术方案描述的能力和数据类别，使用 **Mock 约定** 定义可直接实现的本地路由、JSON 字段和返回行为。本文所有英文路由、字段名、样例值和 HTTP 状态码均为 Mock 约定。正文的接口编号可作为用例标识。

## 1 五个平台的能力与 Mock 入口

| 编号 | 平台 | 技术方案描述的能力 | 离线 Mock 入口 |
| --- | --- | --- | --- |
| P1 | SYH 水声环境数据支持平台 | 环境数据导入、查询、管理及导出，提供水文、海底、实测噪声及信道数据 | ENV-01 至 ENV-09 |
| P2 | SH 声波能量覆盖机理数值仿真平台 | 独立声场计算服务，支持点对点、单点单方向、单点多方向、多点多方向 | FIELD-01 |
| P3 | DYSSKSQX 编解码技术仿真平台 | 对外独立提供信道和背景噪声计算服务。平台内部及模块复用涉及编码、解码、信号生成和统计 | SIG-01 至 SIG-06 |
| P4 | 复杂环境下 XXWJ 传输 LL 技术半实物仿真平台 | 数据综合管理、方案管理、链路分析与回放，以及设备交互 | REPLAY-01 至 REPLAY-04 |
| P5 | 全区域 TX 性能预估与 LL 控制平台 | 声学计算、可靠性分析、参数优化、链路控制与状态监控 | EVAL-01 至 EVAL-04 |

## 2 共用约定

- 路径统一加前缀 `/mock/v1`。JSON 请求使用 `application/json`。表格中 `field?` 表示可省略，其余列出的请求字段均为必填。 `number` 可含小数，`integer` 为整数，`*` 表示引用本文定义的对象。
- JSON 成功响应统一包含 `requestId: string` 和 `data: object`。文件和 PNG 以字节流返回，通过 `X-Request-Id` 响应头追踪。
- `fixtureId` 指向固定的合成数据或预置结果。同一个已知 `fixtureId` 和相同业务输入返回相同结果。只有请求编号和任务标识等追踪信息可变化。初始 fixture 可使用 `demo-field`、`demo-signal`、`demo-replay` 和 `demo-eval`。另设 `demo-eval-insufficient` 返回证据不足，`demo-eval-failed` 返回任务失败。
- JSON 结果使用可序列化的有限数值。空查询返回 `items: []`。结果尚未生成时省略 `resultId`。数据缺失规约使用 `null` 或错误码，数值 0 保留其数值含义。
- 对可重复执行的写入和建任务请求，可传 `Idempotency-Key`。同一路径上，相同键与相同业务载荷返回原资源。相同键与不同业务载荷返回 `409 CONFLICT`。
- Mock 故障注入使用请求头 `X-Mock-Fault`，支持 `unavailable` 和 `timeout`。普通请求默认成功或按参数校验返回相应结果。可选 `X-Request-Id` 用于贯穿一次调度调用。

| HTTP 状态 | 错误码或含义 | 触发条件 |
| --- | --- | --- |
| 200 / 201 / 202 | 查询或计算成功 / 资源已创建 / 任务已受理 | 按接口表执行 |
| 400 | `INVALID_ARGUMENT` | 缺必填字段、类型错误、枚举非法或范围反向 |
| 404 | `NOT_FOUND` | 指定 ID、fixture 或结果资源不存在 |
| 409 | `CONFLICT` | 幂等键与已有请求冲突 |
| 422 | `INPUT_INCOMPATIBLE` | 数组维度、样本数或依赖类型不匹配 |
| 503 | `SERVICE_UNAVAILABLE` | 故障注入 `unavailable` |
| 504 | `TIMEOUT` | 故障注入 `timeout` |

错误示例

```json
{
  "requestId": "req-demo-01",
  "error": {
    "code": "INVALID_ARGUMENT",
    "message": "month 必须在 1 到 12 之间",
    "field": "month"
  }
}
```

## 3 P1 环境数据支持平台

**方案依据**。方案 1 的外部接口涵盖文件流和 JSON 导入，环境内容、图层、配置和属性导出。方案 4、5 的外部接口章节进一步描述历史环境、实测环境、实测噪声和实测信道的查询与返回结构。统一的接口归属为 P1，调用方引用该入口。

| 编号与功能 | Mock 方法与路径 | 请求 | 成功响应 `data` |
| --- | --- | --- | --- |
| ENV-01 导入数据 | `POST /env/datasets` | JSON `metadata: DatasetMetadata*`、`content: object`，或 multipart `metadata` JSON 部件与 `file` 文件部件 | 201，`datasetId: string`、`metadata: DatasetMetadata*` |
| ENV-02 按条件查询目录 | `GET /env/datasets` | 查询参数 `category?: string`、`element?: string`、`published?: boolean` | 200，`items: DatasetSummary[]` |
| ENV-03 读取数据或下载 | `GET /env/datasets/{datasetId}/content` | `view?: json/file/layer`，默认 `json` | JSON `content: object`、原文件字节流或 `image/png` |
| ENV-04 获取基础配置 | `GET /env/config` | 无 | 200，`categories: string[]`、`elements: string[]`、`analysisDefaults: object` |
| ENV-05 查询历史环境 | `GET /env/history` | `longitude: number`、`latitude: number`、`month: integer` | 200，`environment: EnvironmentProfile*` |
| ENV-06 查询实测环境 | `GET /env/observations` | `longitude: number`、`latitude: number` | 200，`environment: EnvironmentProfile*` |
| ENV-07 读取预置噪声记录 | `GET /env/noise-records/{recordId}` | `recordId: string` | 200，`samples: number[]`、`durationS: number`、`levelDb: number` |
| ENV-08 读取预置信道记录 | `GET /env/channel-records/{recordId}` | `recordId: string` | 200，`response: number[]`、`delaysS: number[]`、`durationS: number`、`dopplerHz: number` |
| ENV-09 更新发布状态 | `PATCH /env/datasets/{datasetId}` | `published: boolean` | 200，`datasetId: string`、`published: boolean` |

**Mock 数据结构**

| 对象 | 字段 | 类型与单位 |
| --- | --- | --- |
| DatasetMetadata | `category`、`element`、`name`、`format`、`generatedDate` | 字符串，日期使用 `YYYY-MM-DD` |
| DatasetMetadata | `producer?`、`instrument?`、`operator?`、`surveyTopic?` | 字符串 |
| DatasetMetadata | `bounds?` | 对象 `{west, east, south, north}`，经纬度为十进制度 |
| DatasetSummary | `datasetId`、`metadata`、`published` | 字符串、DatasetMetadata、布尔值 |
| EnvironmentProfile | `longitude`、`latitude` | number，度 |
| EnvironmentProfile | `waterColumn` | 数组 `{depthM, temperatureC, salinityPsu, soundSpeedMps}` |
| EnvironmentProfile | `seabed` | 对象 `{kind, soundSpeedMps, densityGcm3, attenuationDbPerWavelength}` |
| EnvironmentProfile | `bathymetry` | 数组 `{distanceKm, waterDepthM}` |

经度范围为 ±180°，纬度范围为 ±90°，月份为 1–12。ENV-07 和 ENV-08 根据本地 `recordId` 查表，方案中的查询 URL 在离线实现中对应预置记录标识。ENV-08 的 `response` 和 `delaysS` 等长。ENV-01 支持 JSON 与文件两种输入方式，每次选择一种。部署 Mock 时填充合成记录和测试图层即可。

## 4 P2 声场与 P3 信号处理平台

### 4.1 P2 声场计算

**方案依据**。方案 2 的表 15、16 定义声场计算服务的输入输出。输入分声源、仿真控制、模型和环境四组。输出包括计算坐标向量、传播损失、复声压，以及依模型产生的声线、到达结构、本征声线或模态信息。

| 编号与功能 | Mock 方法与路径 | 请求 | 成功响应 `data` |
| --- | --- | --- | --- |
| FIELD-01 取预置声场结果 | `POST /field/simulations` | `fixtureId: string`、`mode: FieldMode`、`environmentRef?: string` | 200，`axes: object`、`slices: FieldSlice[]` |

- `FieldMode` 取 `point_to_point`、`single_point_single_bearing`、`single_point_multi_bearing` 或 `multi_point_multi_bearing`。预置数据可按模式返回不同数量的切片。
- `axes` 包含 `sourceDepthsM`、`frequenciesHz`、`bearingsDeg`、`receiverDepthsM`、`receiverRangesKm` 五个数值数组，以及 `sourceIds: string[]`。每个 `FieldSlice` 含索引 `sourceIndex`、`sourceDepthIndex`、`frequencyIndex`、`bearingIndex`，以及 `transmissionLossDb: number[][]`。索引从 0 开始，分别对应 `sourceIds`、`sourceDepthsM`、`frequenciesHz` 和 `bearingsDeg`。可选 `pressure: Complex[][]` 和 `detailsRef: string`，后者可标识附属的合成诊断记录。
- 矩阵行索引对应接收深度，列索引对应接收距离。每个元素可用固定测试值，`Complex` 采用 `{real: number, imag: number}`。例如 2 个接收深度、3 个距离点应返回 2×3 的矩阵。轴顺序和复数编码均为 Mock 约定。

### 4.2 P3 信道、噪声与信号处理

**方案依据**。方案 3 表 29–32 明确了独立对外服务中的信道和背景噪声 I/O。编码、信号生成、解码和统计原见方案 3 内部接口章节。方案 4、5 描述对 P3 模块复用的情况。SIG-03 至 SIG-06 用于模拟模块调用的边界。

| 编号与功能 | Mock 方法与路径 | 请求 | 成功响应 `data` |
| --- | --- | --- | --- |
| SIG-01 取合成信道响应 | `POST /signals/channel` | `fixtureId: string` | 200，`response: number[]`、`delaySampleRateHz: integer`、`dopplerHz: number` |
| SIG-02 取合成背景噪声 | `POST /signals/noise` | `fixtureId: string`、`sampleCount: integer` | 200，`samples: number[]`、`sampleCount: integer`、`levelDb: number` |
| SIG-03 编码模块占位 | `POST /signals/encode` | `fixtureId: string`、`bits: integer[]` | 200，`encodedRef: string`、`bitCount: integer` |
| SIG-04 信号生成模块占位 | `POST /signals/synthesize` | `fixtureId: string`、`encodedRef?: string` | 200，`signalRef: string`、`samples: number[]`、`sampleRateHz: integer` |
| SIG-05 解码模块占位 | `POST /signals/decode` | `fixtureId: string`、`signalRef: string` | 200，`bits: integer[]`、`bitCount: integer` |
| SIG-06 结果统计 | `POST /signals/statistics` | `expectedBits: integer[]`、`actualBits: integer[]` | 200，`comparedBits: integer`、`bitErrors: integer`、`bitErrorRate: number` |

`bits` 类数组只接受 0 和 1。SIG-06 对非空、等长数组逐位比较，`bitErrorRate = bitErrors / comparedBits`，空数组返回 400，长度不同返回 422。SIG-02 的返回长度等于请求的 `sampleCount`，可截取预置样本或重复填充。SIG-03 至 SIG-05 返回预设内容并检查引用类型。用同一个 fixture 贯通编码、生成和解码即可覆盖交接流程。SIG-02 要求 `sampleCount > 0`，信号数组和 `bitCount` 按响应字段的实际内容填写。

## 5 P4 半实物仿真与 P5 性能预估

### 5.1 P4 离线回放接口

**方案依据**。方案 4 表 5–12 描述数据管理、方案管理、链路分析回放及显控模块的接口。离线 Mock 表达数据登记、回放任务及回放结果的交接。

| 编号与功能 | Mock 方法与路径 | 请求 | 成功响应 `data` |
| --- | --- | --- | --- |
| REPLAY-01 列出可回放记录 | `GET /replay/records` | 无 | 200，`items: array<{recordId, title}>` |
| REPLAY-02 创建回放任务 | `POST /replay/jobs` | `fixtureId: string`、`recordId: string` | 202，`jobId: string`、`status: queued` |
| REPLAY-03 查询回放任务 | `GET /replay/jobs/{jobId}` | `jobId: string` | 200，`jobId: string`、`status: JobStatus`，完成后含 `resultId: string` |
| REPLAY-04 读取回放结果 | `GET /replay/results/{resultId}` | `resultId: string` | 200，`recordId: string`、`events: array<{offsetMs, label}>`、`artifactRef?: string` |

### 5.2 P5 离线评估接口

**方案依据**。方案 5 表 8–16 描述计算、分析、控制和监控等模块。离线 Mock 返回预置评估报告及合成状态，用于测试任务编排和界面展示。

| 编号与功能 | Mock 方法与路径 | 请求 | 成功响应 `data` |
| --- | --- | --- | --- |
| EVAL-01 创建离线评估 | `POST /eval/jobs` | `fixtureId: string`、`inputRefs?: string[]` | 202，`jobId: string`、`status: queued` |
| EVAL-02 查询评估任务 | `GET /eval/jobs/{jobId}` | `jobId: string` | 200，`jobId: string`、`status: JobStatus`，完成后含 `resultId: string` |
| EVAL-03 读取评估结果 | `GET /eval/results/{resultId}` | `resultId: string` | 200，`verdict: pass/fail/insufficient_evidence`、`summary: string`、`evidenceRefs: string[]` |
| EVAL-04 读取预置节点状态 | `GET /eval/status-fixtures/{fixtureId}` | `fixtureId: string` | 200，`items: array<{nodeId, status}>`，状态为 `online/offline/busy` |

`offsetMs` 为非负整数，`label`、`recordId`、`title` 和 `nodeId` 均为字符串。回放事件按 `offsetMs` 升序返回。EVAL-01 可用 `replay:<resultId>` 引用已生成的回放结果，EVAL-03 将该引用写入 `evidenceRefs`。

`JobStatus` 取 `queued`、`running`、`succeeded` 或 `failed`。为使测试可复现，可用轮询次数驱动转换。提交后返回 `queued`，第一次查询返回 `running`，第二次查询起保持同一终态。失败任务返回 `failureCode: string`，成功任务返回 `resultId`。报告判定由预置结果给出，`succeeded` 表示任务执行结束，判定在 `verdict` 中读取。

## 6 跨平台联调用例

| 用例 | 调用步骤 | 期望 |
| --- | --- | --- |
| 环境数据查询与声场返回 | ENV-01 导入合成环境 → ENV-02 查到资源 → ENV-03 读取 JSON → FIELD-01 的 `environmentRef` 使用 ENV-01 返回的 `datasetId` | 目录与资源 ID 一致。矩阵维度与返回轴长度相符 |
| 合成信号处理 | SIG-03 取编码引用 → SIG-04 取信号引用 → SIG-05 取预置解码结果 → SIG-06 逐位比较 | `[0,1,1,0]` 与 `[0,1,0,0]` 的统计为 1 个误码、误码率 0.25 |
| 回放与证据引用 | REPLAY-01 选记录 → REPLAY-02 提交 → REPLAY-03 查询终态 → REPLAY-04 读取事件 → EVAL-01 携带结果引用 → EVAL-02、03 查询 | 两个任务各自维护状态。评估报告关联回放证据 |
| 参数校验 | ENV-05 使用 `month=13`，或 SIG-06 提交两个长度不同的数组 | 分别得到 400、422，并保留请求编号 |
| 上游异常与恢复 | 调用 FIELD-01 注入 `timeout` → 记录错误 → 去掉故障头后重试 | 首次返回 504，重试成功后调度器才使用新结果 |
| 执行完成但证据不足 | EVAL-01 选择证据不足的 fixture → 轮询并取结果 | 任务终态为 `succeeded`，结果为 `insufficient_evidence` |
