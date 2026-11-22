/** 调试记录属于 Web 进程；完整保存已观察到的请求、分片和 HTTP 响应，不改写模型消息。 */
// AsyncLocalStorage 将一次模型调用与其异步 fetch 关联，避免混入其他会话的网络活动。
import { AsyncLocalStorage } from 'node:async_hooks'
// 随机 ID 将页面轮次与底层模型调用区分开；一轮可能包含多次模型请求。
import { randomUUID } from 'node:crypto'
// 调试器只依赖 Cordis 的上下文类型，生命周期仍由 Web 插件拥有。
import type { Context } from '@deepseek-ai/cordis'
// 导入类型扩展，让 ctx.on 认识模型请求的 waterfall 事件。
import type {} from '@deepseek-ai/dsh-llm'

// 一条不可变快照包含顺序、时间、类型和完整数据；seq 用于核对 SSE 是否漏项。
export interface TraceEvent { seq: number; time: number; kind: string; data: unknown }
// Run 是一次网页发送；events 可能包含多次模型调用、工具请求与失败记录。
export interface ModelRun {
  // id 可用来获取详情和下载完整 JSON，sessionId 用于关联所属会话。
  id: string; sessionId: string; prompt: string; startedAt: number; endedAt?: number
  // 状态由 Web 入口在整轮停稳后结算，不把 HTTP 200 等同于生成成功。
  status: 'running' | 'completed' | 'error' | 'cancelled'; events: TraceEvent[]
// 结束一次网页发送记录的结构定义。
}

/** 去掉不可序列化的运行时对象；模型数据本身不按长度截断。 */
function snapshot(value: unknown): unknown {
  // 序列化失败不能破坏模型调用，调试页面会明确显示捕获错误。
  try {
    // AbortSignal 不属于模型正文；错误保留可展示的类型、原因与错误码。
    return JSON.parse(JSON.stringify(value, (_key, item: unknown) => {
      // 不把控制信号误当成模型请求字段，控制信息单独表示。
      if (item instanceof AbortSignal) return { aborted: item.aborted }
      // Error 的 message 默认不可枚举，因此主动提取，避免 JSON 只显示空对象。
      if (item instanceof Error) return { name: item.name, message: item.message, ...('code' in item ? { code: item.code } : {}) }
      // JSON 不支持 bigint，转为字符串以保留其完整数值表示。
      return typeof item === 'bigint' ? item.toString() : item
    // 闭合快照转换回调、JSON.stringify 和 JSON.parse，得到独立的 JSON 数据副本。
    }))
  // 明确标记捕获失败，而不是静默丢掉整个调试流程。
  } catch (error) { return { captureError: String(error) } }
// 结束快照函数。
}

/** 一份调试仓库同时负责原始记录、实时推送及模型调用与 HTTP 的异步关联。 */
export class Debugger {
  // 所有运行记录只保存在当前进程；页面可显式删除完成的记录。
  readonly runs = new Map<string, ModelRun>()
  // 每个会话只允许一个活动网页轮次，调用中间件通过它查找所属 run。
  readonly current = new Map<string, string>()
  // 用独立计数区分一轮中的模型调用，而不是假定一轮只请求模型一次。
  private calls = new Map<string, number>()
  // 实时推送回调属于当前 SSE 请求；结束请求时移除，历史记录继续保留。
  private listeners = new Map<string, (event: TraceEvent) => void>()
  // 仅当 fetch 位于这个异步上下文内时才捕获；普通页面资源请求不受影响。
  readonly scope = new AsyncLocalStorage<{ runId: string; callId: string }>()

  // 创建网页轮次，并在任何模型工作开始前建立关联。
  start(sessionId: string, prompt: string, listener: (event: TraceEvent) => void): ModelRun {
    // 新建状态对象；真正的模型请求内容稍后从 llm/stream 取得。
    const run: ModelRun = { id: randomUUID(), sessionId, prompt, startedAt: Date.now(), status: 'running', events: [] }
    // 保存轮次、会话关联和推送器；三者由 finish 统一结算。
    this.runs.set(run.id, run)
    // 会话 ID 来自框架消息，可将后续 LLM 事件定位到本次网页操作。
    this.current.set(sessionId, run.id)
    // 先登记监听器，确保第一条 run/start 也能实时显示。
    this.listeners.set(run.id, listener)
    // 创建第一条事件；数据不含凭据或服务端环境变量。
    // run/start 由入口在发出 run 元数据后追加，保证浏览器先知道轮次 ID。
    // 把同一对象返回给入口，入口在 finally 中使用其 ID 完成结算。
    return run
  // 结束轮次创建。
  }

  // 对数据取快照后再保存，避免框架后续修改对象导致过去记录变动。
  append(runId: string, kind: string, data: unknown): void {
    // 已被显式删除的历史不再接收新事件。
    const run = this.runs.get(runId)
    // 找不到记录时保持观察器无副作用，不让调试器中断业务。
    if (!run) return
    // seq 连续递增；时间使用毫秒，页面可计算每步相对耗时。
    const entry: TraceEvent = { seq: run.events.length, time: Date.now(), kind, data: snapshot(data) }
    // 先存后推，因此即使浏览器断线，稍后查询也能看到已观察到的事件。
    run.events.push(entry)
    // 观察器失败不能破坏模型迭代；历史数据已保存，可通过详情 API 补读。
    try { this.listeners.get(runId)?.(entry) } catch { this.listeners.delete(runId) }
  // 结束事件记录。
  }

  // 整个 Agent 轮次停稳后，统一写入成功、错误或取消结果。
  finish(runId: string, status: ModelRun['status']): void {
    // 忽略不存在或已结束的记录，防止断线和关闭插件同时重复结算。
    const run = this.runs.get(runId)
    // completed/error/cancelled 是终态，不再重复追加 run/end。
    if (!run || run.status !== 'running') return
    // 记录终态和结束时间，便于列表展示总耗时。
    run.status = status
    // 总时间包括框架调度、适配器准备、网络与流处理。
    run.endedAt = Date.now()
    // 结束事件仍会被推送，之后才断开该轮的监听器。
    this.append(runId, 'run/end', { status, durationMs: run.endedAt - run.startedAt })
    // 只移除仍然指向自己的关联，避免影响同会话将来的新轮次。
    if (this.current.get(run.sessionId) === runId) this.current.delete(run.sessionId)
    // 完成后的历史仍在 runs，只有实时发送回调和计数需要释放。
    this.listeners.delete(runId)
    // 不为已结束轮次保留额外计数器。
    this.calls.delete(runId)
  // 结束轮次结算。
  }

  /** 安装全量模型流观察器与受异步作用域约束的原始 HTTP 捕获。 */
  install(ctx: Context): void {
    // 这里必须调用 next，完整透传所有分片；调试器不替换或隐藏 reasoning/tool/usage 等内容。
    const debug = this
    // 模型中间件记录实际经过 LLM 运行时的请求，包含完整历史和工具定义。
    ctx.on('llm/stream', async function* (options, next) {
      // 没有网页轮次关联时只透传，不捕获其他宿主的模型活动。
      const runId = options.sessionId === undefined ? undefined : debug.current.get(String(options.sessionId))
      // 非本 Web 入口的请求不进入调试记录。
      if (!runId) { yield* next(); return }
      // 为本次底层请求分配序号；一个 Agent 轮次可能多步请求模型。
      const count = (debug.calls.get(runId) ?? 0) + 1
      // 保存递增计数，供下一次实际请求使用。
      debug.calls.set(runId, count)
      // callId 将 HTTP、标准分片与请求选项关联起来。
      const callId = `${runId}/call-${count}`
      // signal 是本地控制对象，不是模型输入；单独记录是否已取消。
      const { signal, ...request } = options
      // 完整保留框架请求结构，不把它伪称为已序列化的 HTTP 请求。
      debug.append(runId, 'llm/request', { callId, request, aborted: signal?.aborted ?? false })
      // next 返回的异步迭代器会延迟执行，必须在每次 next/return 时进入作用域。
      const iterator = next()[Symbol.asyncIterator]()
      // 让 fetch 观察器只记录属于这次调用的网络流量。
      const scope = { runId, callId }
      // 成功、失败和取消都要关闭内层迭代器。
      try {
        // 逐条读取，不收集完才交给框架，因此不会把流式响应变成一次性响应。
        for (;;) {
          // AsyncLocalStorage 会传播到适配器内部的 await 与 fetch。
          const item = await debug.scope.run(scope, () => iterator.next())
          // 模型流结束时停止迭代。
          if (item.done) break
          // 保留每一种分片的完整 JSON，包括结束元数据和适配器返回的 replayState。
          debug.append(runId, 'llm/chunk', { callId, chunk: item.value })
          // 原样返回给框架，不丢弃推理、工具调用或用量字段。
          yield item.value
        // 结束流循环。
        }
      // 中间件异常也要进入过程记录，再原样交给框架处理。
      } catch (error) { debug.append(runId, 'llm/error', { callId, error }); throw error }
      // 释放内部流，并记录这次实际模型请求的边界。
      finally {
        // 取消也须保留异步作用域，否则适配器收尾网络活动会失去归属。
        await debug.scope.run(scope, () => iterator.return?.())
        // 这是底层请求结束，不等于整个 Agent 轮次结束。
        debug.append(runId, 'llm/end', { callId })
      // 结束请求清理。
      }
    // 结束 waterfall 观察器注册。
    })

    // 上游适配器目前没有原始 HTTP 响应 hook，因此在本进程用作用域化 fetch 包装捕获。
    const original = globalThis.fetch
    // 包装只记录有当前模型调用归属的 fetch，其他调用完全走原函数。
    const wrapped: typeof fetch = async (input, init) => {
      // 没有 LLM 异步作用域，就不检查请求正文或响应内容。
      const scope = debug.scope.getStore()
      // 直接透传普通 fetch，避免混入前端资源或其他会话。
      if (!scope) return original(input, init)
      // 只显示 URL 的非凭据部分；认证头、Cookie 不进入调试数据。
      const url = new URL(input instanceof Request ? input.url : String(input))
      // URL 中也可能带凭据，删除用户名和密码。
      url.username = ''; url.password = ''
      // 常见凭据查询参数隐藏；模型请求/响应正文仍按实际内容完整保存。
      for (const key of url.searchParams.keys()) if (/key|token|secret|auth/i.test(key)) url.searchParams.set(key, '[REDACTED]')
      // HTTP ID 区分同一调用内可能出现的重试或附加请求。
      const httpId = randomUUID()
      // 当前上游模型 POST 以字符串传入序列化 JSON，这里保留它的原文。
      debug.append(scope.runId, 'http/request', { callId: scope.callId, httpId, url: url.href, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? init.body : null })
      // 把网络错误与 HTTP 错误状态区分开。
      try {
        // 不改变认证、body、signal 或原 fetch 的调用参数。
        const response = await original(input, init)
        // 仅收集可用于定位的非凭据响应头，不导出 Set-Cookie 等认证数据。
        const headers = Object.fromEntries([...response.headers].filter(([key]) => /^(content-type|request-id|x-request-id|x-deepseek-request-id|retry-after)$/i.test(key)))
        // 保存真实状态码和请求 ID，HTTP 非 2xx 也继续捕获其完整错误正文。
        debug.append(scope.runId, 'http/response', { callId: scope.callId, httpId, status: response.status, statusText: response.statusText, headers })
        // 无正文的响应不构造新流，也不编造空的模型内容。
        if (!response.body) return response
        // 流式 UTF-8 解码保留跨数据块的中文字符，base64 另存每块字节以支持精确还原。
        const decoder = new TextDecoder()
        // 使用透传 TransformStream，不 clone 整个响应或提前读取完毕。
        const capture = new TransformStream<Uint8Array, Uint8Array>({
          // 框架读取一块时才捕获一块，保留流的背压与取消传播。
          transform(bytes, controller) {
            // 同时保存可读原文与原始字节，不把 SSE 事件翻译后的字段冒充完整 HTTP 响应。
            debug.append(scope.runId, 'http/chunk', { callId: scope.callId, httpId, text: decoder.decode(bytes, { stream: true }), base64: Buffer.from(bytes).toString('base64') })
            // 把同一字节块原样交给上游适配器的解析器。
            controller.enqueue(bytes)
          // 结束单块透传处理。
          },
          // 正常 EOF 时刷新解码器尾部，并记录响应结束；断线不会被伪称为完整响应。
          flush() {
            // UTF-8 尾部不为空时也保留，避免最后几个字节被静默忽略。
            const tail = decoder.decode()
            // 尾部是解码器状态，不是新的网络字节块，因此不附加伪造 base64。
            if (tail) debug.append(scope.runId, 'http/tail', { callId: scope.callId, httpId, text: tail })
            // HTTP 正文读取完成不等于模型业务成功，后面仍可能是框架错误。
            debug.append(scope.runId, 'http/end', { callId: scope.callId, httpId })
          // 结束流刷新函数。
          },
        // 完成透传流配置。
        })
        // 保留状态和响应头，把捕获后的原字节流交回适配器；取消会向原流传播。
        return new Response(response.body.pipeThrough(capture), { status: response.status, statusText: response.statusText, headers: response.headers })
      // 网络层异常原样上抛，并保留发生位置。
      } catch (error) { debug.append(scope.runId, 'http/error', { callId: scope.callId, httpId, error }); throw error }
    // 结束 fetch 包装函数。
    }
    // 包装由插件生命周期拥有，不把它遗留到下次热加载。
    ctx.effect(() => {
      // 此包装不是更改模型参数，只为记录本次异步调用内的 HTTP 传输。
      globalThis.fetch = wrapped
      // 只有当前仍是自己的包装时才还原，避免覆盖其他模块后来安装的包装。
      return () => { if (globalThis.fetch === wrapped) globalThis.fetch = original }
    // 给 effect 命名，便于查找卸载归属。
    }, 'debug-http-capture')
  // 结束调试器安装方法。
  }
// 结束调试仓库类。
}
