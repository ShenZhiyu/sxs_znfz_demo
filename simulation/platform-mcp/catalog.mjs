import { z } from 'zod'

const id = z.string().min(1)
const fixtureId = id
const longitude = z.number().min(-180).max(180)
const latitude = z.number().min(-90).max(90)
const coordinates = { longitude, latitude }
const bounds = z.strictObject({ west: longitude, east: longitude, south: latitude, north: latitude })
  .refine(value => value.west <= value.east, { path: ['east'] })
  .refine(value => value.south <= value.north, { path: ['north'] })
const metadata = z.strictObject({
  category: z.string(), element: z.string(), name: z.string(), format: z.string(),
  generatedDate: z.iso.date(),
  producer: z.string().optional(), instrument: z.string().optional(), operator: z.string().optional(),
  surveyTopic: z.string().optional(), bounds: bounds.optional(),
})
const bits = z.array(z.union([z.literal(0), z.literal(1)]))
const modes = ['point_to_point', 'single_point_single_bearing', 'single_point_multi_bearing', 'multi_point_multi_bearing']

function endpoint(platform, name, title, description, method, path, fields = {}, options = {}) {
  const schema = z.strictObject({
    ...fields,
    requestId: z.string().min(1).optional().describe('跨调用请求追踪编号'),
    ...(options.write ? { idempotencyKey: z.string().min(1).optional().describe('幂等写入键，重试时沿用') } : {}),
  })
  return { platform, name, title, description, method, path, options, inputSchema: options.validate ? schema.refine(options.validate, {
    message: 'content 与 filePath 必须选择一项', path: ['filePath'],
  }) : schema }
}

export const endpoints = [
  endpoint('P1', 'import_environment_dataset', '导入环境数据', '导入 JSON 对象或工作目录内的文件，返回 datasetId，可交给 mcp__acoustic_field__get_acoustic_field_result。', 'POST', '/env/datasets', {
    metadata, content: z.record(z.string(), z.json()).optional(), filePath: z.string().min(1).optional().describe('工作目录内的相对文件路径'),
  }, { write: true, multipart: true, validate: ({ content, filePath }) => (content === undefined) !== (filePath === undefined) }),
  endpoint('P1', 'list_environment_datasets', '查询环境数据目录', '按类别、要素和发布状态查询数据集，返回 datasetId 列表。', 'GET', '/env/datasets', {
    category: z.string().optional(), element: z.string().optional(), published: z.boolean().optional(),
  }),
  endpoint('P1', 'get_environment_dataset_content', '读取或下载环境数据', '按 datasetId 读取 JSON，或将原文件、PNG 图层下载到工作目录。', 'GET', '/env/datasets/:datasetId/content', {
    datasetId: id, view: z.enum(['json', 'file', 'layer']).default('json'),
  }, { binary: true }),
  endpoint('P1', 'get_environment_config', '获取环境配置', '读取可用类别、要素和分析默认值。', 'GET', '/env/config'),
  endpoint('P1', 'query_environment_history', '查询历史环境', '以经纬度（度）和月份查询历史环境剖面。', 'GET', '/env/history', { ...coordinates, month: z.int().min(1).max(12) }),
  endpoint('P1', 'query_environment_observations', '查询实测环境', '以经纬度（度）查询实测环境剖面。', 'GET', '/env/observations', coordinates),
  endpoint('P1', 'get_noise_record', '读取噪声记录', '按 recordId 读取噪声样本、时长和级别。Mock 记录为 demo-noise。', 'GET', '/env/noise-records/:recordId', { recordId: id }),
  endpoint('P1', 'get_channel_record', '读取信道记录', '按 recordId 读取信道响应、时延和多普勒。Mock 记录为 demo-channel。', 'GET', '/env/channel-records/:recordId', { recordId: id }),
  endpoint('P1', 'set_environment_dataset_published', '更新环境数据发布状态', '按 datasetId 设置发布状态。', 'PATCH', '/env/datasets/:datasetId', { datasetId: id, published: z.boolean() }, { write: true }),
  endpoint('P2', 'get_acoustic_field_result', '读取声场仿真结果', '按 mode 返回声场轴和切片。可将 mcp__environment__import_environment_dataset 返回的 datasetId 用作 environmentRef。Mock fixture 为 demo-field。', 'POST', '/field/simulations', {
    fixtureId, mode: z.enum(modes), environmentRef: id.optional(),
  }),
  endpoint('P3', 'get_synthetic_channel_response', '读取信道响应', '返回信道响应、采样率及多普勒。Mock fixture 为 demo-signal。', 'POST', '/signals/channel', { fixtureId }),
  endpoint('P3', 'get_synthetic_background_noise', '读取背景噪声', '返回指定数量的噪声样本，Mock fixture 为 demo-signal。', 'POST', '/signals/noise', { fixtureId, sampleCount: z.int().positive().max(100_000) }),
  endpoint('P3', 'encode_bits', '编码比特', '输入 0 或 1 的数组，返回 encodedRef 供 mcp__signal_processing__synthesize_signal 使用。Mock fixture 为 demo-signal。', 'POST', '/signals/encode', { fixtureId, bits }, { createsRef: true }),
  endpoint('P3', 'synthesize_signal', '生成信号', '可传入 mcp__signal_processing__encode_bits 返回的 encodedRef，生成信号样本并返回 signalRef。Mock fixture 为 demo-signal。', 'POST', '/signals/synthesize', { fixtureId, encodedRef: id.optional() }, { createsRef: true }),
  endpoint('P3', 'decode_signal', '解码信号', '使用 mcp__signal_processing__synthesize_signal 返回的 signalRef 读取解码比特。Mock fixture 为 demo-signal。', 'POST', '/signals/decode', { fixtureId, signalRef: id }),
  endpoint('P3', 'calculate_bit_error_rate', '统计误码', '对两组非空、等长的 0 或 1 数组逐位比较，返回误码数和误码率。', 'POST', '/signals/statistics', { expectedBits: bits.min(1), actualBits: bits.min(1) }),
  endpoint('P4', 'list_replay_records', '列出回放记录', '列出可回放记录和 recordId。', 'GET', '/replay/records'),
  endpoint('P4', 'submit_replay_job', '提交回放任务', '传入 recordId，返回 jobId 供 mcp__replay__get_replay_job_status 查询。Mock fixture 为 demo-replay。', 'POST', '/replay/jobs', { fixtureId, recordId: id }, { write: true }),
  endpoint('P4', 'get_replay_job_status', '查询回放任务', '按 jobId 查询任务，成功终态返回 resultId。', 'GET', '/replay/jobs/:jobId', { jobId: id }, { polls: true }),
  endpoint('P4', 'get_replay_result', '读取回放结果', '按 resultId 读取回放事件。可将其作为 replay:<resultId> 交给 mcp__evaluation__submit_evaluation_job。', 'GET', '/replay/results/:resultId', { resultId: id }),
  endpoint('P5', 'submit_evaluation_job', '提交评估任务', '可传入 replay:<resultId> 等证据引用，返回 jobId 供 mcp__evaluation__get_evaluation_job_status 查询。Mock fixture 为 demo-eval。', 'POST', '/eval/jobs', { fixtureId, inputRefs: z.array(id).optional() }, { write: true }),
  endpoint('P5', 'get_evaluation_job_status', '查询评估任务', '按 jobId 查询任务，成功终态返回 resultId，失败终态返回 failureCode。', 'GET', '/eval/jobs/:jobId', { jobId: id }, { polls: true }),
  endpoint('P5', 'get_evaluation_result', '读取评估结果', '按 resultId 读取评估结论、摘要和证据引用。', 'GET', '/eval/results/:resultId', { resultId: id }),
  endpoint('P5', 'get_evaluation_node_status', '读取平台节点状态', '按评估 fixtureId 读取节点 online、offline 或 busy 状态。', 'GET', '/eval/status-fixtures/:fixtureId', { fixtureId }),
]
