import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { McpServer } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { endpoints } from './catalog.mjs'
import { readWorkspaceFile, saveWorkspaceFile } from './files.mjs'

const defaultBaseUrl = 'http://127.0.0.1:3081/mock/v1'
const timeoutMs = 8000
const platformIds = [...new Set(endpoints.map(endpoint => endpoint.platform))]

function platformUrls(env, platforms) {
  return Object.fromEntries(platforms.map(platform => {
    const key = 'DSH_PLATFORM_' + platform + '_BASE_URL'
    const value = env[key] || env.DSH_PLATFORM_BASE_URL || defaultBaseUrl
    let url
    try { url = new URL(value) } catch {}
    if (!url || !['http:', 'https:'].includes(url.protocol) ||
        url.username || url.password || url.search || url.hash) {
      throw new Error(`${key} 或 DSH_PLATFORM_BASE_URL 必须是无查询、片段和凭据的 HTTP(S) 基础地址。`)
    }
    return [platform, url.href.replace(/\/+$/, '')]
  }))
}

function reply(value, isError = false) {
  return { content: [{ type: 'text', text: JSON.stringify(value) }], ...(isError ? { isError: true } : {}) }
}

function failure(code, message, context = {}) {
  return reply({ ...context, error: { code, message } }, true)
}

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)

async function forward(endpoint, input, bases, workDir, cancelSignal) {
  const { requestId, idempotencyKey, ...fields } = input
  const headers = new Headers()
  if (requestId !== undefined) headers.set('X-Request-Id', requestId)
  if (idempotencyKey !== undefined) headers.set('Idempotency-Key', idempotencyKey)

  const path = endpoint.path.replace(/:([A-Za-z]+)\b/g, (_, key) => {
    const value = fields[key]
    if (value === '.' || value === '..') throw new Error('资源 ID 无效。')
    delete fields[key]
    return encodeURIComponent(value)
  })
  const url = new URL(bases[endpoint.platform] + path)
  let body
  if (endpoint.method === 'GET') {
    for (const [key, value] of Object.entries(fields)) if (value !== undefined) url.searchParams.set(key, String(value))
  } else if (endpoint.options.multipart && fields.filePath !== undefined) {
    let file
    try { file = await readWorkspaceFile(workDir, fields.filePath) } catch {
      return failure('INVALID_WORKSPACE_FILE', '请选择工作目录内 4 MiB 以内的普通文件。路径不可使用符号链接。', { requestId })
    }
    body = new FormData()
    body.set('metadata', new Blob([JSON.stringify(fields.metadata)], { type: 'application/json' }), 'metadata.json')
    body.set('file', new Blob([file.bytes], { type: 'application/octet-stream' }), file.name)
  } else {
    headers.set('Content-Type', 'application/json')
    body = JSON.stringify(fields)
  }

  const timeout = AbortSignal.timeout(timeoutMs)
  const signal = cancelSignal ? AbortSignal.any([cancelSignal, timeout]) : timeout
  let response
  let context = { requestId }
  try {
    response = await fetch(url, { method: endpoint.method, headers, body, signal, redirect: 'manual' })
    context = { requestId: response.headers.get('x-request-id') ?? requestId, httpStatus: response.status }
    const contentType = response.headers.get('content-type') ?? ''
    const mediaType = contentType.split(';')[0].trim().toLowerCase()
    if (response.ok && endpoint.options.binary && fields.view !== 'json') {
      if (!response.body || (fields.view === 'layer' && mediaType !== 'image/png')) {
        await response.body?.cancel()
        return failure('INVALID_RESPONSE', '平台未返回所请求的文件类型。', context)
      }
      try {
        const file = await saveWorkspaceFile(workDir, response.body, fields.view === 'layer' ? '.png' : '.bin', signal)
        return reply({ ...context, data: { ...file, mediaType: mediaType || 'application/octet-stream' } })
      } catch (error) {
        if (signal.aborted) throw error
        return failure('FILE_DOWNLOAD_FAILED', '无法下载并保存平台文件。', context)
      }
    }
    if (mediaType !== 'application/json' && !mediaType.endsWith('+json')) {
      await response.body?.cancel()
      return failure(response.ok ? 'INVALID_RESPONSE' : 'HTTP_ERROR', '平台未返回 JSON 响应。', context)
    }
    let payload
    try { payload = await response.json() } catch (error) {
      if (signal.aborted) throw error
      return failure('INVALID_RESPONSE', '平台返回的 JSON 无效。', context)
    }
    if (isObject(payload) && typeof payload.requestId === 'string') context.requestId = payload.requestId
    if (!response.ok) {
      const error = payload?.error
      if (isObject(error) && typeof error.code === 'string' && typeof error.message === 'string') {
        return reply({ ...context, error }, true)
      }
      return failure('HTTP_ERROR', '平台拒绝了本次 HTTP 请求。', context)
    }
    if (!isObject(payload?.data) || typeof payload.requestId !== 'string') {
      return failure('INVALID_RESPONSE', '平台响应缺少 requestId 或 data 对象。', context)
    }
    return reply({ ...context, data: payload.data })
  } catch {
    if (cancelSignal?.aborted) return failure('CANCELLED', '已取消平台请求。', context)
    if (timeout.aborted) return failure('TIMEOUT', '平台 HTTP 请求超时。', context)
    return failure('UPSTREAM_UNAVAILABLE', '无法连接平台或读取 HTTP 响应，请检查平台服务。', context)
  } finally {
    if (response?.body && !response.bodyUsed && !response.body.locked) {
      await response.body.cancel().catch(() => {})
    }
  }
}

export function createPlatformMcp({ env = process.env, platform } = {}) {
  if (platform !== undefined && !platformIds.includes(platform)) throw new Error('平台须为 P1 至 P5。')
  const bases = platformUrls(env, platform === undefined ? platformIds : [platform])
  const workDir = resolve(env.DSH_DEMO_WORK_DIR || 'work')
  const server = new McpServer({ name: platform ? 'dsh-platform-' + platform.toLowerCase() : 'dsh-platforms', version: '1.0.0' })
  for (const endpoint of endpoints) {
    if (platform !== undefined && endpoint.platform !== platform) continue
    server.registerTool(endpoint.name, {
      title: endpoint.title,
      description: endpoint.description,
      inputSchema: endpoint.inputSchema,
      annotations: {
        readOnlyHint: !endpoint.options.write && !endpoint.options.polls && !endpoint.options.binary && !endpoint.options.createsRef,
        destructiveHint: false,
        openWorldHint: true,
      },
    }, async (input, context) => {
      try { return await forward(endpoint, input, bases, workDir, context.mcpReq.signal) } catch {
        return failure('INVALID_ARGUMENT', '请求编号、幂等键或资源标识无效。', { requestId: input.requestId })
      }
    })
  }
  return server
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const { values } = parseArgs({ options: { platform: { type: 'string' } } })
  serveStdio(() => createPlatformMcp({ platform: values.platform }))
}
