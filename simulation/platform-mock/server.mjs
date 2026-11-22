import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { createMockHttp } from './http.mjs'
import { registerEnvironment } from './environment.mjs'
import { registerSignal } from './signal.mjs'
import { registerReplayAndEval } from './jobs.mjs'

export function createPlatformMock() {
  return createMockHttp(add => {
    registerEnvironment(add)
    registerSignal(add)
    registerReplayAndEval(add)
  })
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const { values } = parseArgs({ options: { port: { type: 'string', default: '3081' } } })
  const port = Number(values.port)
  if (!/^\d+$/.test(values.port) || !Number.isInteger(port) || port > 65535) {
    throw new Error('--port 必须是 0 至 65535 的整数')
  }
  const server = createPlatformMock()
  server.listen(port, '127.0.0.1', () => {
    console.log(`仿真平台 Mock 服务 http://127.0.0.1:${server.address().port}/mock/v1`)
  })
}
