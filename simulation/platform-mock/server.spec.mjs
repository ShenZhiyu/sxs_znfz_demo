import assert from 'node:assert/strict'
import { once } from 'node:events'
import { after, before, test } from 'node:test'
import { createPlatformMock } from './server.mjs'

const server = createPlatformMock()
let root
before(async () => {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  root = `http://127.0.0.1:${server.address().port}/mock/v1`
})
after(async () => {
  if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
})

async function call(path, { method = 'GET', status = 200, body, headers, code } = {}) {
  const request = { method, headers: new Headers(headers) }
  if (body instanceof FormData) request.body = body
  else if (body !== undefined) {
    request.headers.set('Content-Type', 'application/json')
    request.body = JSON.stringify(body)
  }
  const res = await fetch(root + path, request)
  const response = await res.json()
  assert.equal(res.status, status, JSON.stringify(response))
  assert.ok(response.requestId)
  assert.equal(response.requestId, res.headers.get('x-request-id'))
  if (code) assert.equal(response.error.code, code)
  return response
}

const post = (path, body, options) => call(path, { ...options, method: 'POST', body })
const patch = (path, body, options) => call(path, { ...options, method: 'PATCH', body })
const datasetPath = '/env/datasets'
const metadata = {
  category: 'test', element: 'water-column', name: '合成环境', format: 'json', generatedDate: '2026-01-01',
}
const fieldInput = { fixtureId: 'demo-field', mode: 'single_point_single_bearing' }
const demoSignal = { fixtureId: 'demo-signal' }

test('P1 环境数据导入、查询和发布，P2 使用同一个数据 ID', async () => {
  const content = { rows: [1, 2], location: { longitude: 120, latitude: 30 } }
  const headers = { 'Idempotency-Key': 'json-import-1' }
  const [first, repeated] = await Promise.all([
    post(datasetPath, { metadata, content }, { status: 201, headers }),
    post(datasetPath, { content, metadata }, { status: 201, headers }),
  ])
  assert.deepEqual(repeated.data, first.data)
  assert.notEqual(repeated.requestId, first.requestId)
  await post(datasetPath, { metadata, content: { rows: [] } }, { status: 409, headers, code: 'CONFLICT' })
  const { datasetId } = first.data
  const listed = await call(datasetPath + '?category=test&element=water-column&published=false')
  assert.deepEqual(listed.data.items, [{ datasetId, metadata, published: false }])
  assert.deepEqual((await call(datasetPath + '?category=missing')).data.items, [])
  const resource = `${datasetPath}/${datasetId}`
  assert.deepEqual((await call(resource + '/content')).data, { content })
  const patchOptions = { headers: { 'Idempotency-Key': 'publish-demo' } }
  assert.deepEqual((await patch(resource, { published: true }, patchOptions)).data, { datasetId, published: true })
  await patch(resource, { published: true }, patchOptions)
  await patch(resource, { published: false }, { ...patchOptions, status: 409, code: 'CONFLICT' })
  assert.equal((await call(datasetPath + '?category=test&published=true')).data.items.length, 1)
  assert.ok((await call('/env/config')).data.elements.includes('water-column'))
  const location = 'longitude=120&latitude=30'
  assert.equal((await call('/env/history?' + location + '&month=1')).data.environment.longitude, 120)
  assert.equal((await call('/env/observations?' + location)).data.environment.latitude, 30)
  assert.ok((await call('/env/noise-records/demo-noise')).data.samples.length)
  const channel = (await call('/env/channel-records/demo-channel')).data
  assert.equal(channel.response.length, channel.delaysS.length)

  for (const [mode, count] of Object.entries({
    point_to_point: 1, single_point_single_bearing: 1, single_point_multi_bearing: 2, multi_point_multi_bearing: 4,
  })) {
    const input = { ...fieldInput, mode, environmentRef: datasetId }
    const { data } = await post('/field/simulations', input)
    assert.deepEqual((await post('/field/simulations', input)).data, data)
    assert.equal(data.slices.length, count)
    for (const slice of data.slices) {
      assert.ok(data.axes.sourceIds[slice.sourceIndex])
      assert.ok(data.axes.sourceDepthsM[slice.sourceDepthIndex])
      assert.ok(data.axes.frequenciesHz[slice.frequencyIndex])
      assert.ok(Number.isFinite(data.axes.bearingsDeg[slice.bearingIndex]))
      for (const matrix of [slice.transmissionLossDb, slice.pressure]) {
        assert.equal(matrix.length, data.axes.receiverDepthsM.length)
        assert.ok(matrix.every(row => row.length === data.axes.receiverRangesKm.length))
      }
    }
  }
})

test('P1 multipart 原文件和 PNG 图层按字节返回', async () => {
  const bytes = Buffer.from([0, 1, 2, 255])
  const form = new FormData()
  form.set('metadata', new Blob([JSON.stringify({ ...metadata, format: 'bin' })], { type: 'application/json' }))
  form.set('file', new Blob([bytes], { type: 'application/octet-stream' }), 'demo.bin')
  const options = { status: 201, headers: { 'Idempotency-Key': 'file-import-1' } }
  const { data } = await post(datasetPath, form, options)
  assert.deepEqual((await post(datasetPath, form, options)).data, data)
  const path = datasetPath + '/' + data.datasetId + '/content'
  const res = await fetch(root + path + '?view=file', { headers: { 'X-Request-Id': 'file-request' } })
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('x-request-id'), 'file-request')
  assert.equal(res.headers.get('content-type'), 'application/octet-stream')
  assert.equal(res.headers.get('content-disposition'), 'attachment')
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), bytes)
  const image = await fetch(root + path + '?view=layer')
  assert.equal(image.status, 200)
  assert.equal(image.headers.get('content-type'), 'image/png')
  assert.equal(Buffer.from(await image.arrayBuffer()).subarray(1, 4).toString(), 'PNG')
  await call(path, { status: 422, code: 'INPUT_INCOMPATIBLE' })
  const incomplete = new FormData()
  incomplete.set('metadata', JSON.stringify(metadata))
  await post(datasetPath, incomplete, { status: 400, code: 'INVALID_ARGUMENT' })
})

test('P3 合成信号处理完成引用交接和逐位统计', async () => {
  const { data: channel } = await post('/signals/channel', demoSignal)
  assert.equal(channel.dopplerHz, 0)
  const { data: noise } = await post('/signals/noise', { ...demoSignal, sampleCount: 7 })
  assert.equal(noise.samples.length, noise.sampleCount)
  assert.equal(noise.samples[0], noise.samples[4])
  const expectedBits = [0, 1, 1, 0]
  const { data: encoding } = await post('/signals/encode', { ...demoSignal, bits: expectedBits })
  assert.equal(encoding.bitCount, expectedBits.length)
  assert.deepEqual((await post('/signals/encode', { bits: expectedBits, ...demoSignal })).data, encoding)
  const { data: signal } = await post('/signals/synthesize', { ...demoSignal, encodedRef: encoding.encodedRef })
  assert.ok(signal.samples.length)
  const { data: decoded } = await post('/signals/decode', { ...demoSignal, signalRef: signal.signalRef })
  assert.equal(decoded.bitCount, decoded.bits.length)
  const { data: stats } = await post('/signals/statistics', { expectedBits, actualBits: decoded.bits })
  assert.deepEqual(stats, { comparedBits: 4, bitErrors: 1, bitErrorRate: 0.25 })
  await post('/signals/decode', { ...demoSignal, signalRef: encoding.encodedRef },
    { status: 422, code: 'INPUT_INCOMPATIBLE' })
  await post('/signals/decode', { ...demoSignal, signalRef: 'signal:' + '0'.repeat(64) },
    { status: 404, code: 'NOT_FOUND' })
})

async function finish(path, jobId) {
  const jobPath = `/${path}/jobs/${jobId}`
  assert.deepEqual((await call(jobPath)).data, { jobId, status: 'running' })
  const { data } = await call(jobPath)
  assert.deepEqual((await call(jobPath)).data, data)
  return data
}

test('P4 回放结果关联 P5 证据，任务终态和评估结论各自独立', async () => {
  const { items } = (await call('/replay/records')).data
  const { recordId } = items[0]
  const replayInput = { fixtureId: 'demo-replay', recordId }
  const replayOptions = { status: 202, headers: { 'Idempotency-Key': 'replay-demo' } }
  const { data: replay } = await post('/replay/jobs', replayInput, replayOptions)
  assert.equal(replay.status, 'queued')
  const replayDone = await finish('replay', replay.jobId)
  assert.equal(replayDone.status, 'succeeded')
  assert.deepEqual((await post('/replay/jobs', replayInput, replayOptions)).data, replay)
  const events = (await call('/replay/results/' + replayDone.resultId)).data
  assert.equal(events.recordId, recordId)
  assert.deepEqual(events.events.map(event => event.offsetMs), [0, 100, 200])
  const evidenceRefs = ['replay:' + replayDone.resultId]

  for (const [fixtureId, verdict] of [
    ['demo-eval', 'pass'], ['demo-eval-fail', 'fail'], ['demo-eval-insufficient', 'insufficient_evidence'],
  ]) {
    const { data: evaluation } = await post('/eval/jobs', { fixtureId, inputRefs: evidenceRefs }, { status: 202 })
    assert.equal(evaluation.status, 'queued')
    const evaluationDone = await finish('eval', evaluation.jobId)
    assert.equal(evaluationDone.status, 'succeeded')
    const { data: report } = await call('/eval/results/' + evaluationDone.resultId)
    assert.equal(report.verdict, verdict)
    assert.deepEqual(report.evidenceRefs, evidenceRefs)
  }
  const { data: failed } = await post('/eval/jobs', { fixtureId: 'demo-eval-failed' }, { status: 202 })
  assert.deepEqual(await finish('eval', failed.jobId), {
    jobId: failed.jobId, status: 'failed', failureCode: 'MOCK_EVAL_FAILED',
  })
  assert.equal((await call('/eval/status-fixtures/demo-eval-failed')).data.items[0].status, 'offline')
  await post('/eval/jobs', { fixtureId: 'demo-eval', inputRefs: ['replay:missing'] },
    { status: 404, code: 'NOT_FOUND' })
})

test('校验错误、找不到资源、故障注入和重试保留请求编号', async () => {
  const headers = { 'X-Request-Id': 'request-demo' }
  const { requestId, error } = await call('/env/history?longitude=120&latitude=30&month=13',
    { status: 400, headers, code: 'INVALID_ARGUMENT' })
  assert.equal(requestId, 'request-demo')
  assert.equal(error.field, 'month')
  await call('/env/observations?longitude=&latitude=30', { status: 400, code: 'INVALID_ARGUMENT' })
  await call('/env/datasets?published=true&published=false', { status: 400, code: 'INVALID_ARGUMENT' })
  await post('/signals/noise', { ...demoSignal, sampleCount: 0 }, { status: 400, code: 'INVALID_ARGUMENT' })
  await post('/signals/encode', { ...demoSignal, bits: [2] }, { status: 400, code: 'INVALID_ARGUMENT' })
  await post('/signals/statistics', { expectedBits: [], actualBits: [] }, { status: 400, code: 'INVALID_ARGUMENT' })
  await post('/signals/statistics', { expectedBits: [1], actualBits: [0, 1] },
    { status: 422, code: 'INPUT_INCOMPATIBLE', headers })
  await post('/field/simulations', { ...fieldInput, environmentRef: 'missing' }, { status: 404, code: 'NOT_FOUND' })
  await post('/field/simulations', { ...fieldInput, fixtureId: 'missing' }, { status: 404, code: 'NOT_FOUND' })
  for (const [fault, status, code] of [['timeout', 504, 'TIMEOUT'], ['unavailable', 503, 'SERVICE_UNAVAILABLE']]) {
    const response = await post('/field/simulations', fieldInput, {
      headers: { ...headers, 'X-Mock-Fault': fault }, status, code,
    })
    assert.equal(response.requestId, 'request-demo')
  }
  const recovered = await post('/field/simulations', fieldInput, { headers })
  assert.equal(recovered.requestId, 'request-demo')
  assert.equal(recovered.data.slices.length, 1)
})
