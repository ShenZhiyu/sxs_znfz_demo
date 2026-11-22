/** 一轮对话的展示：用户问题、助手文本和工具结果各自拥有独立的 DOM。 */
window.dshChatTurns = (() => {
  // 纯文本节点用于标签、参数和工具返回值；只有助手正文交给 Markdown 解析器。
  const node = (tag, text, className) => {
    const element = document.createElement(tag)
    if (text !== undefined) element.textContent = text
    if (className) element.className = className
    return element
  }
  // JSON 参数与结果尽量格式化；非 JSON 文本保留原文，不按 HTML 执行。
  const pretty = value => {
    if (typeof value !== 'string') return JSON.stringify(value, null, 2) ?? ''
    try { return JSON.stringify(JSON.parse(value), null, 2) } catch { return value }
  }

  function create(container, number, prompt, onUpdate = () => {}, attachments = []) {
    const root = node('section', undefined, 'chat-turn')
    root.dataset.turnNumber = String(number)
    root.dataset.status = 'running'
    root.setAttribute('aria-label', `第 ${number} 轮对话`)
    const heading = node('header', undefined, 'turn-heading')
    const state = node('span', '进行中', 'turn-state')
    heading.append(node('h2', `第 ${number} 轮`), state)
    const entries = node('div', undefined, 'turn-entries')
    const user = node('article', undefined, 'message user')
    user.append(node('div', '你的问题', 'message-label'), node('div', prompt, 'message-content'))
    if (attachments.length) {
      const files = node('div', undefined, 'message-attachments')
      for (const file of attachments) files.append(file.downloadUrl ? window.dshFiles.link(file) : node('span', `${file.name}（原文件不可用）`))
      user.append(files)
    }
    entries.append(user)
    const waiting = node('p', '正在生成回答…', 'turn-waiting')
    root.append(heading, entries, waiting)
    container.append(root)

    // attemptId 区分同轮中的多次模型输出；callId 配对工具调用与结果，支持乱序返回。
    const answers = new Map(), tools = new Map(), seen = new Set(), dirty = new Set()
    let attempt = null, frame = null, finished = false, callNumber = 0

    const flush = () => {
      if (frame !== null) cancelAnimationFrame(frame)
      frame = null
      if (!root.isConnected) { dirty.clear(); return }
      for (const answer of dirty) window.dshMarkdown.render(answer.content, answer.text)
      dirty.clear()
      onUpdate()
    }
    const schedule = () => {
      // 同帧的多个文本增量合并处理；不同步骤的正文始终分别累计。
      if (frame === null) frame = requestAnimationFrame(flush)
    }

    function answer() {
      const key = attempt?.attemptId ?? 'text-only'
      let value = answers.get(key)
      if (!value) {
        const article = node('article', undefined, 'message assistant')
        const label = node('div', undefined, 'message-label')
        const title = node('span', '助手回答')
        label.append(title)
        if (attempt?.step !== undefined) label.append(node('span', `步骤 ${attempt.step}`, 'chat-step'))
        const content = node('div', '', 'message-content')
        article.append(label, content)
        // 正文首次到达时才插入，避免在工具执行前放一条空白的助手回答。
        entries.append(article)
        value = { article, title, content, text: '', step: attempt?.step }
        answers.set(key, value)
      }
      return value
    }

    function tool(callId, step) {
      let value = tools.get(callId)
      if (value) return value
      const article = node('article', undefined, 'message tool')
      article.dataset.callId = callId
      article.dataset.status = 'running'
      const label = node('div', '工具调用与结果', 'message-label')
      label.append(node('span', `${step !== undefined ? `步骤 ${step} · ` : ''}调用 ${++callNumber}`, 'chat-step'))
      const details = node('details', undefined, 'chat-tool-card')
      const summary = node('summary')
      const name = node('code', '工具')
      const status = node('span', '执行中', 'chat-tool-state')
      summary.append(name, status)
      const body = node('div', undefined, 'chat-tool-body')
      const args = node('pre', '尚未收到参数。')
      const result = node('pre', '正在等待工具返回…')
      const raw = node('details', undefined, 'chat-tool-raw')
      const original = node('pre', '尚未收到返回事件。')
      raw.append(node('summary', '完整结果事件 JSON'), original)
      body.append(node('h3', '调用参数'), args, node('h3', '工具返回结果'), result, raw)
      details.append(summary, body)
      const preview = node('p', '正在等待工具返回…', 'chat-tool-preview')
      article.append(label, details, preview)
      entries.append(article)
      value = { article, name, status, args, result, original, preview, completed: false }
      tools.set(callId, value)
      return value
    }

    function receive(type, data) {
      if (finished) return
      if (type === 'run') { root.dataset.runId = data.id; return }
      if (type === 'delta') {
        // 只接收正文 delta；trace 中重复出现的模型分片不会再追加一次。
        const value = answer()
        value.text += data.text
        dirty.add(value)
        waiting.textContent = '助手正在回答…'
        schedule()
        return
      }
      if (type !== 'trace') return
      // 旧轮次或重复补发的事件不能污染当前轮次。
      if (data.runId && root.dataset.runId && data.runId !== root.dataset.runId) return
      const event = data.event
      if (!event || seen.has(event.seq)) return
      seen.add(event.seq)
      if (event.kind === 'agent/frame' && event.data.type === 'start') {
        // 工具执行后的再次模型调用从新的步骤开始，不与上一段 Markdown 拼接。
        attempt = event.data
        return
      }
      const payload = event.data?.data
      if (event.kind === 'session/tool/call') {
        const value = tool(payload.callId, payload.step)
        value.name.textContent = payload.name
        value.args.textContent = pretty(payload.arguments)
        // 工具调用前的模型文字明确标成说明，最后的回答仍保留自己的正文块。
        for (const answer of answers.values()) if (answer.step === payload.step) answer.title.textContent = '助手说明'
        waiting.textContent = '正在执行工具…'
        onUpdate()
      } else if (event.kind === 'session/tool/result') {
        const message = payload.message
        const callId = message.toolCallId ?? message.source?.callId
        const value = tool(callId, payload.step)
        const content = message.content ?? []
        const textOnly = content.every(block => block.type === 'text')
        const text = textOnly ? content.map(block => block.text).join('\n') : JSON.stringify(content, null, 2)
        value.completed = true
        value.article.dataset.status = message.isError ? 'error' : 'completed'
        value.status.textContent = message.isError ? '执行失败' : '已返回'
        value.result.textContent = pretty(text)
        value.original.textContent = JSON.stringify(event.data, null, 2)
        // 短结果直接展示；大对象保留在详情中，避免查询状态的 JSON 淹没助手回答。
        let structured = false
        try { const parsed = JSON.parse(text); structured = parsed !== null && typeof parsed === 'object' } catch {}
        value.preview.textContent = message.isError ? '工具返回了错误，展开查看完整结果。'
          : !textOnly ? '工具返回了多个内容块，展开查看完整结果。'
            : structured ? '工具已返回结构化结果，展开查看完整内容。'
              : text.length > 160 ? `工具已返回文本（${text.length} 字），展开查看完整内容。` : `返回结果：${text || '（空内容）'}`
        waiting.textContent = '正在整理回答…'
        onUpdate()
      }
    }

    function finish(status, error = '') {
      if (finished) return
      finished = true
      flush()
      root.dataset.status = status
      state.textContent = { completed: '已完成', error: '未完成', cancelled: '已中止' }[status] ?? status
      // 断线只表示本页没收到结果，不能把仍在后台执行的工具误标为执行失败。
      for (const value of tools.values()) if (!value.completed) {
        value.article.dataset.status = 'unknown'
        value.status.textContent = '结果未确认'
        value.result.textContent = '本轮结束前未收到工具结果，请到调用过程或仿真任务中查询。'
        value.preview.textContent = '未收到返回结果，后台任务可能仍在执行。'
      }
      if (status !== 'completed') {
        waiting.textContent = error || '本轮已中止。'
        waiting.classList.add('turn-error')
      } else if (!answers.size) waiting.textContent = tools.size ? '本轮仅返回工具结果，未生成助手回答。' : '本轮没有返回文字。'
      else waiting.hidden = true
    }

    // dispose 只释放渲染任务，不取消后台工具；取消 Agent 仍由聊天入口统一处理。
    const dispose = () => { flush(); if (!finished && root.isConnected) finish('cancelled') }
    return { receive, finish, dispose }
  }
  /** 从官方事件日志重建历史；只渲染，不发送消息、不执行工具。 */
  function replay(container, events, attachments = {}) {
    const groups = []
    let current
    for (const event of events) {
      if (event.type === 'turn/start') { current = []; groups.push(current) }
      if (current) current.push(event)
    }
    let number = 0
    for (const group of groups) {
      const prompts = group.filter(event => event.type === 'user/message' && (!event.data.source || event.data.source.kind === 'user'))
      if (!prompts.length) continue
      const text = prompts.flatMap(event => event.data.content).filter(block => block.type === 'text').map(block => block.text).join('\n')
      const files = prompts.flatMap(event => event.data.content).filter(block => block.type === 'file').map(block => attachments[block.attachment.attachmentId] ?? { name: block.attachment.name })
      const turn = create(container, ++number, text || '请查看上传的附件。', () => {}, files)
      let ending
      for (const event of group) {
        if (event.type === 'assistant/message' || event.type === 'assistant/attempt') {
          turn.receive('trace', { event: { seq: 'attempt-' + event.seq, kind: 'agent/frame', data: { type: 'start', attemptId: 'history-' + event.seq, step: event.data.step } } })
          const text = event.type === 'assistant/message'
            ? event.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('')
            : (event.data.stream ?? []).map(record => record.type === 'text-chunks' ? record.texts.join('') : record.type === 'chunk' && record.chunk.type === 'text-delta' ? record.chunk.text : '').join('')
          if (text) turn.receive('delta', { text })
        } else if (event.type === 'tool/call' || event.type === 'tool/result') {
          turn.receive('trace', { event: { seq: event.seq, kind: 'session/' + event.type, data: event } })
        } else if (event.type === 'turn/end') ending = event.data.reason
      }
      const status = ending?.kind === 'completed' ? 'completed' : ['error', 'max-tokens'].includes(ending?.kind) ? 'error' : 'cancelled'
      const error = ending?.kind === 'error' ? ending.error?.message : ending?.kind === 'max-tokens' ? '本轮达到模型输出上限。' : status === 'cancelled' ? '本轮已中断；已保存内容保留，可以继续发送消息。' : ''
      turn.finish(status, error)
    }
    return number
  }
  return { create, replay }
})()
