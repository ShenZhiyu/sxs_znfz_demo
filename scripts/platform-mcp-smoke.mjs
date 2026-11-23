import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { createPlatformMock } from '../simulation/platform-mock/server.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const directory = await mkdtemp(join(tmpdir(), 'dsh-platform-mcp-'))
const mock = createPlatformMock()
const requests = []
mock.prependListener('request', req => requests.push({ method: req.method, url: req.url, headers: req.headers }))
const client = new Client({ name: 'platform-smoke', version: '1.0.0' })
const metadata = { category: '契约验证', element: 'water-column', name: '平台测试', format: 'json', generatedDate: '2026-01-01' }
const signalFixture = { fixtureId: 'demo-signal' }

async function listen(server) {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return 'http://127.0.0.1:' + server.address().port
}

async function stop(server) {
  if (server.listening) await new Promise(resolve => server.close(resolve))
}

async function raw(name, args = {}, options) {
  return client.callTool({ name, arguments: args }, options)
}

async function call(name, args, method, path, status = 200, errorCode) {
  const count = requests.length
  const result = await raw(name, args)
  const resultValue = JSON.parse(result.content[0].text)
  assert.equal(!!result.isError, !!errorCode, JSON.stringify(resultValue))
  assert.equal(resultValue.httpStatus, status, JSON.stringify(resultValue))
  assert.equal(requests.length, count + 1)
  const request = requests.at(-1)
  assert.equal(request.method, method)
  assert.equal(request.url, '/mock/v1' + path)
  if (args.requestId !== undefined) {
    assert.equal(request.headers['x-request-id'], args.requestId)
    assert.equal(resultValue.requestId, args.requestId)
  } else {
    assert.ok(resultValue.requestId)
  }
  if (args.idempotencyKey !== undefined) assert.equal(request.headers['idempotency-key'], args.idempotencyKey)
  if (errorCode) {
    assert.equal(resultValue.error.code, errorCode)
    return resultValue.error
  }
  return resultValue.data
}

function startAgent(mode, env) {
  const args = mode === 'web' ? ['--port', '0'] : []
  const child = spawn(process.execPath, ['scripts/run.mjs', mode, '--offline', ...args], {
    cwd: root, env,
  })
  let output = '', errors = ''
  child.stdout.setEncoding('utf8').on('data', text => { output += text })
  child.stderr.setEncoding('utf8').on('data', text => { errors += text })
  const closed = once(child, 'close').then(([code]) => ({ code, output, errors }))
  const ready = pattern => new Promise((resolve, reject) => {
    const onData = () => {
      const match = output.match(pattern)
      if (match) { cleanup(); resolve(match[1]) }
    }
    const onClose = () => { cleanup(); reject(new Error('Agent 提前退出：' + errors)) }
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('Agent 启动超时：' + errors))
    }, 15000)
    const cleanup = () => {
      clearTimeout(timer)
      child.stdout.off('data', onData)
      child.off('close', onClose)
      child.off('error', onClose)
    }
    child.stdout.on('data', onData)
    child.once('close', onClose)
    child.once('error', onClose)
    onData()
  })
  return {
    child, ready, closed,
    async stop() {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
      const result = await closed
      assert.equal(result.code, 0, result.errors)
    },
  }
}

async function chat(origin, message = '/mcp__environment__get_environment_config') {
  const request = async (path, body) => {
    const response = await fetch(origin + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    })
    assert.ok(response.ok, response.status)
    return response
  }
  assert.doesNotMatch(await (await request('/')).text(), /id="tab-simulation"/)
  const { sessionId } = await (await request('/api/sessions', {})).json()
  const response = await request('/api/chat', { sessionId, message })
  const events = (await response.text()).trim().split('\n\n').map(block => {
    const [event, data] = block.split('\n')
    return { type: event.slice(7), data: JSON.parse(data.slice(6)) }
  })
  assert.equal(events.at(-1).type, 'done', JSON.stringify(events))
  const { id } = events.find(event => event.type === 'run').data
  const run = await (await request('/api/runs/' + id)).json()
  return run.events
}

const stalledRequests = []
const faultServer = createServer((req, res) => {
  if (req.headers['x-request-id'] === 'bad-json') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'X-Request-Id': 'bad-json' })
    res.end('{')
    return
  }
  if (req.headers['x-request-id'] === 'upstream-timeout') {
    res.writeHead(504, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ requestId: 'upstream-timeout', error: { code: 'TIMEOUT', message: '测试平台超时' } }))
    return
  }
  const closed = once(res, 'close')
  stalledRequests.push({ url: req.url, closed })
})
try {
  const base = await listen(mock) + '/mock/v1'
  const faultBase = await listen(faultServer) + '/override'
  const env = {
    ...process.env,
    DSH_PLATFORM_BASE_URL: base,
    DSH_PLATFORM_P1_BASE_URL: '', DSH_PLATFORM_P2_BASE_URL: faultBase, DSH_PLATFORM_P3_BASE_URL: '',
    DSH_PLATFORM_P4_BASE_URL: '', DSH_PLATFORM_P5_BASE_URL: '',
    DSH_DEMO_WORK_DIR: directory,
    DSH_DEMO_SESSION_DIR: join(directory, 'sessions'),
    DSH_DEMO_MCP_CONFIG: join(directory, 'mcp.json'),
  }
  await client.connect(new StdioClientTransport({
    command: process.execPath, args: ['simulation/platform-mcp/server.mjs'], cwd: root,
    env: { ...env, DSH_PLATFORM_P2_BASE_URL: '' },
  }))
  const groups = {
    environment: [
      'import_environment_dataset', 'list_environment_datasets', 'get_environment_dataset_content',
      'get_environment_config', 'query_environment_history', 'query_environment_observations',
      'get_noise_record', 'get_channel_record', 'set_environment_dataset_published',
    ],
    acoustic_field: ['get_acoustic_field_result'],
    signal_processing: [
      'get_synthetic_channel_response', 'get_synthetic_background_noise', 'encode_bits',
      'synthesize_signal', 'decode_signal', 'calculate_bit_error_rate',
    ],
    replay: ['list_replay_records', 'submit_replay_job', 'get_replay_job_status', 'get_replay_result'],
    evaluation: ['submit_evaluation_job', 'get_evaluation_job_status', 'get_evaluation_result', 'get_evaluation_node_status'],
  }
  const expected = Object.values(groups).flat().sort()
  const publicNames = (group, names) => names.map(name => `mcp__${group}__${name}`).sort()
  const expectedPublic = Object.entries(groups).flatMap(([group, names]) => publicNames(group, names)).sort()
  const tools = (await client.listTools()).tools
  assert.deepEqual(tools.map(tool => tool.name).sort(), expected)
  assert.ok(tools.every(tool => tool.title && tool.description && tool.inputSchema.type === 'object'))

  const content = { label: '合成环境' }
  const input = { metadata, content, requestId: 'trace-1', idempotencyKey: 'env-key' }
  const dataset = await call('import_environment_dataset', input, 'POST', '/env/datasets', 201)
  assert.deepEqual(await call('import_environment_dataset', input, 'POST', '/env/datasets', 201), dataset)
  await call('import_environment_dataset', { ...input, content: {} }, 'POST', '/env/datasets', 409, 'CONFLICT')
  const { datasetId } = dataset
  const datasetPath = '/env/datasets/' + datasetId
  assert.equal((await call('list_environment_datasets', { category: metadata.category, published: false }, 'GET',
    '/env/datasets?category=' + encodeURIComponent(metadata.category) + '&published=false')).items[0].datasetId, datasetId)
  assert.deepEqual((await call('get_environment_dataset_content', { datasetId }, 'GET', datasetPath + '/content?view=json')).content, content)
  await call('get_environment_config', {}, 'GET', '/env/config')
  await call('query_environment_history', { longitude: 120, latitude: 30, month: 1 }, 'GET', '/env/history?longitude=120&latitude=30&month=1')
  await call('query_environment_observations', { longitude: 120, latitude: 30 }, 'GET', '/env/observations?longitude=120&latitude=30')
  await call('get_noise_record', { recordId: 'demo-noise' }, 'GET', '/env/noise-records/demo-noise')
  await call('get_channel_record', { recordId: 'demo-channel' }, 'GET', '/env/channel-records/demo-channel')
  await call('get_channel_record', { recordId: 'unknown/id' }, 'GET', '/env/channel-records/unknown%2Fid', 404, 'NOT_FOUND')
  await call('set_environment_dataset_published', { datasetId, published: true, idempotencyKey: 'publish-key' }, 'PATCH', datasetPath)
  const fieldArgs = { fixtureId: 'demo-field', mode: 'point_to_point', environmentRef: datasetId }
  const field = await call('get_acoustic_field_result', fieldArgs, 'POST', '/field/simulations')
  assert.equal(field.slices[0].transmissionLossDb.length, field.axes.receiverDepthsM.length)

  const bytes = Buffer.from([1, 2, 255, 0])
  await writeFile(join(directory, 'samples.bin'), bytes)
  const fileDataset = await call('import_environment_dataset', { metadata, filePath: 'samples.bin' }, 'POST', '/env/datasets', 201)
  const filePath = '/env/datasets/' + fileDataset.datasetId + '/content'
  const binary = await call('get_environment_dataset_content', { datasetId: fileDataset.datasetId, view: 'file' }, 'GET', filePath + '?view=file')
  assert.equal(binary.bytes, bytes.length)
  assert.deepEqual(await readFile(join(directory, binary.path)), bytes)
  const png = await call('get_environment_dataset_content', { datasetId, view: 'layer' }, 'GET', datasetPath + '/content?view=layer')
  assert.equal(png.mediaType, 'image/png')
  assert.equal((await readFile(join(directory, png.path))).subarray(1, 4).toString(), 'PNG')
  await symlink(join(directory, 'samples.bin'), join(directory, 'link.bin'))
  const count = requests.length
  for (const filePath of ['../outside', '/tmp/outside', 'link.bin', 'missing.bin']) {
    const result = await raw('import_environment_dataset', { metadata, filePath })
    assert.equal(result.isError, true)
    assert.equal(JSON.parse(result.content[0].text).error.code, 'INVALID_WORKSPACE_FILE')
  }
  assert.equal(requests.length, count)

  await call('get_synthetic_channel_response', signalFixture, 'POST', '/signals/channel')
  const noise = await call('get_synthetic_background_noise', { ...signalFixture, sampleCount: 6 }, 'POST', '/signals/noise')
  assert.equal(noise.samples.length, 6)
  const expectedBits = [0, 1, 1, 0]
  const { encodedRef } = await call('encode_bits', { ...signalFixture, bits: expectedBits }, 'POST', '/signals/encode')
  const { signalRef } = await call('synthesize_signal', { ...signalFixture, encodedRef }, 'POST', '/signals/synthesize')
  const decoded = await call('decode_signal', { ...signalFixture, signalRef }, 'POST', '/signals/decode')
  const stats = await call('calculate_bit_error_rate', { expectedBits, actualBits: decoded.bits }, 'POST', '/signals/statistics')
  assert.equal(stats.bitErrorRate, 0.25)
  const mismatch = await call('calculate_bit_error_rate', { expectedBits, actualBits: [1] }, 'POST', '/signals/statistics', 422, 'INPUT_INCOMPATIBLE')
  assert.equal(mismatch.field, 'actualBits')

  const { items } = await call('list_replay_records', {}, 'GET', '/replay/records')
  const replay = await call('submit_replay_job', { fixtureId: 'demo-replay', recordId: items[0].recordId }, 'POST', '/replay/jobs', 202)
  assert.equal(replay.status, 'queued')
  const pollReplay = () => call('get_replay_job_status', { jobId: replay.jobId }, 'GET', '/replay/jobs/' + replay.jobId)
  assert.equal((await pollReplay()).status, 'running')
  const replayDone = await pollReplay()
  assert.equal(replayDone.status, 'succeeded')
  await call('get_replay_result', { resultId: replayDone.resultId }, 'GET', '/replay/results/' + replayDone.resultId)
  const inputRefs = ['replay:' + replayDone.resultId]
  const evalJob = await call('submit_evaluation_job', { fixtureId: 'demo-eval', inputRefs }, 'POST', '/eval/jobs', 202)
  const pollEvaluation = () => call('get_evaluation_job_status', { jobId: evalJob.jobId }, 'GET', '/eval/jobs/' + evalJob.jobId)
  assert.equal((await pollEvaluation()).status, 'running')
  const evalDone = await pollEvaluation()
  const report = await call('get_evaluation_result', { resultId: evalDone.resultId }, 'GET', '/eval/results/' + evalDone.resultId)
  assert.deepEqual(report.evidenceRefs, inputRefs)
  assert.equal(report.verdict, 'pass')
  await call('get_evaluation_node_status', { fixtureId: 'demo-eval' }, 'GET', '/eval/status-fixtures/demo-eval')
  await client.close()
  console.log('24 个 MCP 工具及 HTTP 映射、跨平台引用、文件和幂等通过。')

  const faultClient = new Client({ name: 'platform-fault-smoke', version: '1.0.0' })
  try {
    await faultClient.connect(new StdioClientTransport({
      command: process.execPath, args: ['simulation/platform-mcp/server.mjs'], cwd: root, env,
    }))
    const checkFault = async (requestId, code) => {
      const result = await faultClient.callTool({ name: 'get_acoustic_field_result', arguments: { ...fieldArgs, requestId } })
      assert.equal(result.isError, true)
      const value = JSON.parse(result.content[0].text)
      assert.equal(value.error.code, code)
      return value
    }
    assert.equal((await checkFault('bad-json', 'INVALID_RESPONSE')).httpStatus, 200)
    const upstream = await checkFault('upstream-timeout', 'TIMEOUT')
    assert.equal(upstream.httpStatus, 504)
    assert.equal(upstream.requestId, 'upstream-timeout')
    await checkFault('slow', 'TIMEOUT')
    assert.equal(stalledRequests[0].url, '/override/field/simulations')
    await stalledRequests[0].closed

    const cancel = new AbortController()
    const pending = faultClient.callTool({ name: 'get_acoustic_field_result', arguments: fieldArgs }, { signal: cancel.signal })
    const rejected = assert.rejects(pending)
    for (let attempt = 0; attempt < 100 && stalledRequests.length < 2; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    assert.equal(stalledRequests.length, 2)
    cancel.abort()
    await rejected
    await Promise.race([
      stalledRequests[1].closed, new Promise((_, reject) => {
        const timer = setTimeout(() => reject(new Error('取消后上游连接未关闭')), 2000)
        timer.unref()
      }),
    ])
  } finally { await faultClient.close() }
  console.log('分平台地址覆盖、错误映射、HTTP 超时和取消通过。')

  const terminal = startAgent('demo', env)
  try {
    await terminal.ready(/每行是一轮对话/)
    terminal.child.stdin.end('/mcp__environment__get_environment_config\n/exit\n')
    const result = await terminal.closed
    assert.equal(result.code, 0, result.errors)
    assert.match(result.output, /MCP 调用完成/)
    assert.match(result.output, /analysisDefaults/)
  } finally { await terminal.stop() }

  const web = startAgent('web', env)
  try {
    const origin = await web.ready(/dsh demo web: (http:\/\/127\.0\.0\.1:\d+)/)
    const directoryResponse = await fetch(origin + '/api/mcp/services', { signal: AbortSignal.timeout(15000) })
    assert.ok(directoryResponse.ok)
    const { services } = await directoryResponse.json()
    assert.deepEqual(services.map(service => service.config.serverName).sort(), Object.keys(groups).sort())
    for (const service of services) {
      const group = service.config.serverName
      assert.deepEqual(service.tools.map(tool => tool.name).sort(), publicNames(group, groups[group]))
    }
    const platform = services.find(service => service.config.serverName === 'environment')
    const setEnabled = async enabled => {
      const response = await fetch(origin + '/api/plugins/toggle', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: platform.entryId, enabled }),
        signal: AbortSignal.timeout(15000),
      })
      assert.equal(response.status, 200, await response.text())
    }
    const downloadResponse = await fetch(origin + '/api/files/download?path=' + encodeURIComponent(binary.path), {
      signal: AbortSignal.timeout(15000),
    })
    assert.ok(downloadResponse.ok)
    assert.deepEqual(Buffer.from(await downloadResponse.arrayBuffer()), bytes)
    const events = await chat(origin)
    const tools = events.find(event => event.kind === 'llm/request').data.request.tools
    assert.deepEqual(tools.filter(tool => tool.name.startsWith('mcp__')).map(tool => tool.name).sort(), expectedPublic)
    assert.ok(events.some(event => event.kind === 'session/tool/result' && JSON.stringify(event).includes('analysisDefaults')))
    await chat(origin, '/mcp__environment__list_environment_datasets {"published":true}')
    assert.equal(requests.at(-1).url, '/mock/v1/env/datasets?published=true')
    await setEnabled(false)
    const disabled = await chat(origin)
    const remaining = disabled.find(event => event.kind === 'llm/request').data.request.tools
    assert.deepEqual(remaining.filter(tool => tool.name.startsWith('mcp__')).map(tool => tool.name).sort(),
      expectedPublic.filter(name => !name.startsWith('mcp__environment__')))
    assert.ok(!disabled.some(event => event.kind === 'session/tool/call'))
    await setEnabled(true)
    const restored = await chat(origin, '/mcp mcp__environment__get_environment_config')
    assert.ok(restored.some(event => event.kind === 'session/tool/result' && JSON.stringify(event).includes('analysisDefaults')))
    await stop(mock)
    const failed = await chat(origin)
    assert.ok(failed.some(event => event.kind === 'session/tool/result' && JSON.stringify(event).includes('UPSTREAM_UNAVAILABLE')))
  } finally { await web.stop() }
  console.log('终端与 Web Agent 实际工具调用、默认工具目录及 Mock 停止后的反馈通过。')
} finally {
  await client.close()
  await Promise.all([stop(mock), stop(faultServer)])
  await rm(directory, { recursive: true, force: true })
}
