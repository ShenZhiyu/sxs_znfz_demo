import { createHash, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'

const errorCodes = {
  400: 'INVALID_ARGUMENT',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'INPUT_INCOMPATIBLE',
  503: 'SERVICE_UNAVAILABLE',
  504: 'TIMEOUT',
}
const bodyLimit = 4 * 1024 * 1024

export class MockError extends Error {
  constructor(status, message, field) {
    super(message)
    this.status = status
    this.field = field
  }
}

// Sort object keys without changing array order or losing JSON keys such as "__proto__".
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  }
  return value
}

export function fingerprint(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
}

function decodeJson(text, field) {
  try { return JSON.parse(text) } catch { throw new MockError(400, 'JSON 格式无效', field) }
}

async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size <= bodyLimit) chunks.push(chunk)
  }
  if (size > bodyLimit) throw new MockError(400, '请求体超过 4 MiB')
  return Buffer.concat(chunks)
}

async function parseBody(req, allowFile) {
  const contentType = req.headers['content-type'] ?? ''
  const mediaType = contentType.split(';')[0].trim().toLowerCase()
  if (mediaType === 'application/json') return decodeJson((await readBody(req)).toString('utf8'))
  if (!allowFile || mediaType !== 'multipart/form-data') {
    req.resume()
    throw new MockError(400, allowFile ? '请提交 JSON 或 multipart/form-data' : '请提交 application/json')
  }

  const body = await readBody(req)
  let form
  try {
    form = await new Response(body, { headers: { 'Content-Type': contentType } }).formData()
  } catch {
    throw new MockError(400, 'multipart 格式无效')
  }
  const metadata = form.get('metadata')
  const file = form.get('file')
  if (form.getAll('metadata').length !== 1 || form.getAll('file').length !== 1 ||
      [...form.keys()].some(key => key !== 'metadata' && key !== 'file') ||
      typeof file?.arrayBuffer !== 'function') {
    throw new MockError(400, 'multipart 需要唯一的 metadata 和 file 部件')
  }
  const metadataText = typeof metadata === 'string' ? metadata : await metadata.text()
  const bytes = Buffer.from(await file.arrayBuffer())
  return {
    metadata: decodeJson(metadataText, 'metadata'),
    file: { bytes, type: file.type, digest: createHash('sha256').update(bytes).digest('hex') },
  }
}

function validate(schema, value) {
  const result = schema.safeParse(value)
  if (!result.success) {
    const issue = result.error.issues[0]
    const field = issue.path.join('.') || issue.keys?.[0]
    throw new MockError(400, field ? `字段 ${field} 无效` : '请求参数无效', field)
  }
  return result.data
}

function sendJson(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(value))
}

export function createMockHttp(register) {
  const routes = []
  const idempotency = new Map()
  register((method, path, schema, handle, options = {}) => {
    const segments = ('/mock/v1' + path).split('/')
    routes.push({ method, segments, schema, handle, options })
  })

  return createServer(async (req, res) => {
    const requestId = req.headers['x-request-id'] || randomUUID()
    res.setHeader('X-Request-Id', requestId)
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    try {
      const url = new URL(req.url, 'http://localhost')
      let segments
      try { segments = url.pathname.split('/').map(decodeURIComponent) } catch {
        throw new MockError(400, '路径编码无效')
      }
      const route = routes.find(candidate => candidate.method === req.method &&
        candidate.segments.length === segments.length && candidate.segments.every((part, index) =>
          part.startsWith(':') ? segments[index].length > 0 : part === segments[index]))
      if (!route) throw new MockError(404, '接口不存在')
      const params = Object.fromEntries(route.segments.flatMap((part, index) =>
        part.startsWith(':') ? [[part.slice(1), segments[index]]] : []))
      const fault = req.headers['x-mock-fault']
      if (fault === 'timeout') throw new MockError(504, '模拟上游超时')
      if (fault === 'unavailable') throw new MockError(503, '模拟上游不可用')
      if (fault !== undefined) throw new MockError(400, '未知的故障模式', 'X-Mock-Fault')

      let raw
      if (req.method === 'GET') {
        raw = Object.fromEntries(url.searchParams)
        if (Object.keys(raw).length !== url.searchParams.size) throw new MockError(400, '查询参数重复')
      } else {
        raw = await parseBody(req, route.options.file)
      }
      let input
      if (raw?.file?.bytes instanceof Buffer) {
        input = { metadata: validate(route.options.file, raw.metadata), file: raw.file }
      } else {
        input = validate(route.schema, raw)
      }

      const key = route.options.write && req.headers['idempotency-key']
      const cacheKey = key && JSON.stringify([req.method, segments, key])
      let signature
      if (cacheKey) {
        const payload = input.file
          ? { metadata: input.metadata, file: { digest: input.file.digest, type: input.file.type } }
          : input
        signature = fingerprint(payload)
        const cached = idempotency.get(cacheKey)
        if (cached) {
          if (cached.signature !== signature) throw new MockError(409, '幂等键已用于其他载荷')
          return sendJson(res, route.options.status ?? 200, { requestId, data: cached.data })
        }
      }

      // Handlers are synchronous, so writes and their idempotency records are committed together.
      const data = route.handle(input, params)
      if (cacheKey) idempotency.set(cacheKey, { signature, data })
      if (route.options.binary && data.bytes) {
        if (data.download) res.setHeader('Content-Disposition', 'attachment')
        res.writeHead(200, { 'Content-Type': data.type, 'Content-Length': data.bytes.length })
        return res.end(data.bytes)
      }
      sendJson(res, route.options.status ?? 200, { requestId, data })
    } catch (error) {
      req.resume()
      if (!(error instanceof MockError)) {
        console.error(error)
        return sendJson(res, 500, { requestId, error: { code: 'INTERNAL_ERROR', message: 'Mock 服务内部错误' } })
      }
      sendJson(res, error.status, {
        requestId,
        error: { code: errorCodes[error.status], message: error.message, field: error.field },
      })
    }
  })
}
