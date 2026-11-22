/** 独立调试面板：所有原始内容只按文本显示，不执行模型返回的 HTML 或脚本。 */
// 用立即执行函数隔离变量，避免与 app.js 的经典脚本顶层变量冲突。
(() => {
  // 缓存需要更新的节点；HTML 中的 ID 是两个文件之间的稳定连接。
  const $ = id => document.getElementById(id)
  // 运行记录按 ID 缓存；events 的 seq 用于与实时 SSE 合并，不覆盖新到的数据。
  const runs = new Map()
  const deletedSessions = new Set()
  // 默认展示插件状态；用户切换标签时不会清空聊天或调试记录。
  let tab = 'plugins', selected = '', pluginRevision = null, changing = false, rendering = null, loading = false
  // 运行状态与中文展示分开，接口和导出始终保留原始英文枚举。
  const phases = { active: '运行中', pending: '等待依赖', stopped: '已停止', loading: '加载中', unloading: '卸载中', disposed: '已释放', failed: '加载失败' }
  // 原始事件种类显示名称只用于时间线摘要，不改写数据内容。
  const labels = { 'run/start': '接收用户消息', 'llm/request': '组装模型请求', 'http/request': '发送 HTTP 请求', 'http/response': '收到 HTTP 响应头', 'http/end': 'HTTP 正文结束', 'http/error': 'HTTP 传输失败', 'llm/end': '本次模型调用结束', 'llm/error': '模型调用异常', 'run/error': '轮次失败', 'run/end': '轮次结算', 'session/turn/start': '开始对话轮次', 'session/step/start': '开始 Agent 步骤', 'session/step/end': 'Agent 步骤结束', 'session/turn/end': '对话轮次结束', 'session/tool/call': '调用工具', 'session/tool/result': '返回工具结果' }

  // 把 HTTP 错误转换为可读异常，控制按钮和普通查询使用相同处理规则。
  async function api(path, options) {
    // fetch 遇到 HTTP 4xx/5xx 不会自动失败，需要检查状态。
    const response = await fetch(path, options)
    // 先读取错误正文；JSON 解析失败时仍保留状态码说明。
    if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || `请求失败（${response.status}）`) }
    // DELETE/清理成功可以没有正文，不能强行 response.json()。
    return response.status === 204 ? null : response.json()
  // 结束 API 封装。
  }
  // 所有修改操作显式声明 JSON，不给外站简单表单提供控制接口。
  const post = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  // 状态文字只使用 textContent，异常中的 HTML 也不会执行。
  const fail = error => { $('debug-notice').textContent = error instanceof Error ? error.message : String(error) }

  // 合并快照与实时流：同一 seq 只保留一份，晚到的旧快照不能丢掉较新的事件。
  function merge(data) {
    // 删除通知后到达的旧快照或 SSE 不能把记录重新放回页面。
    if (deletedSessions.has(data.sessionId)) return
    // 已存在记录可能来自 SSE，也可能来自刷新页面后的详情请求。
    const old = runs.get(data.id)
    // 以事件序号去重，时间只用于展示，不作为唯一键。
    const events = new Map((old?.events ?? []).map(event => [event.seq, event]))
    // 服务器详情可能补上本页断连时错过的事件。
    for (const event of data.events ?? []) events.set(event.seq, event)
    // 已经结算的状态不能被一个更早的 running 快照倒退覆盖。
    const status = old?.endedAt && !data.endedAt ? old.status : data.status
    // 保留完整事件，界面过滤不会修改底层数组。
    runs.set(data.id, { ...old, ...data, status, endedAt: data.endedAt ?? old?.endedAt, events: [...events.values()].sort((a, b) => a.seq - b.seq) })
  // 结束记录合并。
  }

  // 下拉框按新到旧排列，但尽量保持用户正在查看的记录。
  function renderChoices() {
    // 只重建 option，不重建数据仓库。
    const select = $('run-select')
    // 日期和短提示词用于区分轮次；摘要缩短不会影响原始内容或下载。
    const all = [...runs.values()].sort((a, b) => b.startedAt - a.startedAt)
    // 若选择已清理，自动落到最新记录；没有记录时回到空状态。
    if (!runs.has(selected)) selected = all[0]?.id ?? ''
    // 清理旧选项，防止已删除记录还出现在菜单中。
    select.replaceChildren()
    // 每个选项使用稳定 ID，显示文字用 textContent 而不是拼 HTML。
    for (const run of all) {
      // JS 构造 DOM 不会把提示词里的标签当成页面结构。
      const option = document.createElement('option')
      // ID 只用于向详情接口请求这份记录。
      option.value = run.id
      // 显示状态、时间和提示词摘要，方便定位失败或取消的调用。
      option.textContent = `${new Date(run.startedAt).toLocaleTimeString('zh-CN', { hour12: false })} · ${run.status} · ${run.prompt.slice(0, 22)}`
      // 保留手动选择，而不是每次分片到达都跳回最新记录。
      option.selected = run.id === selected
      // 选项加入之后才能供用户选择。
      select.append(option)
    // 结束选项构建。
    }
    // 空列表也显示明确提示，避免看起来像资源加载失败。
    if (!all.length) { const option = document.createElement('option'); option.textContent = '尚无调用记录'; option.value = ''; select.append(option) }
    // 没有选中记录时禁用导出按钮。
    $('download-run').disabled = !selected
  // 结束选择器绘制。
  }

  // 原始输出按不同来源展示，不把框架转换过的分片冒称为 HTTP 原文。
  function renderRaw(run) {
    // 没有轮次时保留简单空状态。
    if (!run) { $('raw-content').textContent = '尚无调用记录。'; return }
    // 每次从完整事件仓库派生显示内容，不在读取时截断字段或文字。
    const events = run.events ?? []
    // 用户选择的是展示投影，JSON 导出永远包含全部事件。
    const kind = $('raw-kind').value
    // 默认显示适配器层的全部标准分片，离线与真实模式都支持。
    if (kind === 'chunks') {
      // 分片包括 reasoning、工具调用、用量、结束原因和附带元数据。
      $('raw-content').textContent = JSON.stringify(events.filter(event => event.kind === 'llm/chunk').map(event => event.data), null, 2)
      // 明确这层数据经过框架标准化，不是上游原生 HTTP 报文。
      $('raw-description').textContent = '适配器返回的完整框架分片，包含文本、思考、工具调用、用量与结束信息；不按长度截断。'
    // HTTP 视图连接真实收到的正文块，不重新生成 SSE。
    } else if (kind === 'http') {
      // 每个请求的响应头和正文用 httpId 关联；一轮可能有多个请求。
      const responses = events.filter(event => event.kind === 'http/response')
      // 分隔标题是界面标识，标题后是原始响应正文；精确字节另在 JSON 中以 base64 保存。
      $('raw-content').textContent = responses.map(event => `── ${event.data.callId} · HTTP ${event.data.status} ──\n${JSON.stringify(event.data.headers, null, 2)}\n\n` + events.filter(item => ['http/chunk', 'http/tail'].includes(item.kind) && item.data.httpId === event.data.httpId).map(item => item.data.text).join('')).join('\n\n') || '尚未捕获到 HTTP 响应。离线模拟不会访问真实模型；请求在鉴权阶段失败时也没有 HTTP 响应。'
      // 不谎称这里包含认证头或尚未收到的网络数据。
      $('raw-description').textContent = '实际收到的 HTTP/SSE 响应正文原文。认证头不记录；导出包含每块响应字节的 base64，可精确还原。'
    // 请求视图同时保留框架结构与适配器实际序列化的 HTTP 正文。
    } else if (kind === 'request') {
      // HTTP 请求头中的 Key、Cookie 不进入记录；正文保留用户实际发送给模型的内容。
      $('raw-content').textContent = JSON.stringify(events.filter(event => ['llm/request', 'http/request'].includes(event.kind)).map(event => ({ kind: event.kind, ...event.data })), null, 2)
      // signal 是控制对象，不应被误当作发送给模型的业务字段。
      $('raw-description').textContent = '包含系统提示词、历史、工具与生成参数；HTTP 请求正文单独保留。API Key、Cookie 等认证信息不记录。'
    // 思考文本只展示模型实际返回的 reasoning 分片，不能推断或补造隐藏内容。
    } else {
      // 按调用区分思考增量，避免把多次模型请求的文本混为一段。
      $('raw-content').textContent = events.filter(event => event.kind === 'llm/chunk' && event.data.chunk.type === 'reasoning-delta').map(event => event.data.chunk.text).join('') || '本次调用没有返回思考文本。当前配置默认关闭 thinking；未返回的内部内容无法查看。'
      // 完整分片选项仍可查看其他可见 reasoning 元数据。
      $('raw-description').textContent = '只显示模型通过接口返回的思考文本，不推测未返回的内部过程。'
    // 结束展示分支。
    }
  // 结束原始数据绘制。
  }

  // 同一轮次按事件 seq 复用 DOM，流式增量和定时刷新不会重建用户正在阅读的详情。
  const timelineNodes = new Map()
  // 切换轮次时只保存展开的事件序号；不同轮次的同序号事件互不影响。
  const expandedTimeline = new Map()
  // 标记当前 DOM 对应的轮次，不能只根据事件序号识别跨轮次的事件。
  let timelineRunId = null

  // 时间线显示事件边界和相对耗时；详情可展开查看完整 payload。
  function renderTimeline(run) {
    // 只重绘选择的记录，不改变其事件数组。
    const list = $('timeline')
    // 直接读取 open 属性，用户刚点击而 toggle 事件尚未派发时也能保存准确状态。
    if (timelineRunId && runs.has(timelineRunId)) expandedTimeline.set(timelineRunId, new Set([...timelineNodes].filter(([, node]) => node.item.open).map(([seq]) => seq)))
    // 已清空的调用不再保留展开记录，防止本页长时间使用后积累失效状态。
    for (const id of expandedTimeline.keys()) if (!runs.has(id)) expandedTimeline.delete(id)
    // 只有切换轮次或清空记录才移除整份 DOM，避免混入另一轮次的事件。
    if ((run?.id ?? null) !== timelineRunId) {
      list.replaceChildren()
      timelineNodes.clear()
      timelineRunId = run?.id ?? null
    }
    // 空状态不使用 HTML 模板插入外部数据。
    if (!run) { list.textContent = '发送消息后查看模型调用过程。'; return }
    // 全部事件包含逐分片记录，默认关键步骤避免刷屏。
    const all = $('timeline-filter').value === 'all'
    // 关键视图保留框架请求、HTTP 边界、工具与步骤事件，忽略高频内容帧。
    const entries = (run.events ?? []).filter(event => all || (!['llm/chunk', 'agent/frame', 'http/chunk', 'http/tail', 'session/assistant/message', 'session/assistant/attempt'].includes(event.kind)))
    // 过滤只移除当前不显示的节点，缓存引用保留其展开状态和详情内部滚动位置。
    const visible = new Set(entries.map(event => event.seq))
    for (const item of [...list.children]) if (!visible.has(Number(item.dataset.seq))) item.remove()
    // 使用游标按事件顺序插入缺失节点；已经排在正确位置的节点保持原位。
    let cursor = list.firstElementChild
    // 每个事件一个 details，让用户主动展开大体积请求或会话记录。
    for (const event of entries) {
      // 同一 seq 的事件继续使用原来的 details，不重新设置它的 open 属性。
      let node = timelineNodes.get(event.seq)
      if (!node) {
        // 原生 details/summary 继续提供点击、键盘和无障碍语义。
        const item = document.createElement('details')
        const summary = document.createElement('summary')
        const content = document.createElement('pre')
        // 稳定标识用于过滤和浏览器检查，不把事件内容拼成 HTML。
        item.dataset.seq = String(event.seq)
        // 从其他轮次切回来时恢复本页先前的展开状态。
        item.open = expandedTimeline.get(run.id)?.has(event.seq) ?? false
        item.append(summary, content)
        node = { item, summary, content, event: null }
        timelineNodes.set(event.seq, node)
      }
      // seq 是原始事件顺序，毫秒偏移用于理解网络与框架阶段耗时。
      const title = `+${event.time - run.startedAt} ms  ·  ${labels[event.kind] ?? event.kind}`
      if (node.summary.textContent !== title) node.summary.textContent = title
      // 新快照可能创建新对象；正文没变化就不写 textContent，保留文字选择和滚动位置。
      if (node.event !== event) {
        const text = JSON.stringify(event, null, 2)
        if (node.content.textContent !== text) node.content.textContent = text
        node.event = event
      }
      // 新事件追加到末尾；切换过滤时按原始顺序放回已缓存的节点。
      if (node.item !== cursor) list.insertBefore(node.item, cursor)
      cursor = node.item.nextElementSibling
    // 结束时间线绘制。
    }
  // 结束时间线函数。
  }

  // 高频模型分片最多每 120 ms 更新一次大段 JSON，避免每个字符都触发整页重排。
  function schedule() {
    // 已有更新排队时不再创建多个定时器，数据仍会完整累计到 runs。
    if (rendering !== null) return
    // 延迟只影响展示刷新，不影响网络接收、原始记录或导出内容。
    rendering = setTimeout(() => { rendering = null; renderRaw(runs.get(selected)); renderTimeline(runs.get(selected)) }, 120)
  // 结束节流调度。
  }

  // 详情 API 可补齐浏览器断线或刷新之前的事件。
  async function detail() {
    // 读取前保留 ID，等待期间用户可能改选另一条记录。
    const id = selected
    const sessionId = runs.get(id)?.sessionId
    // 无选中记录时只更新空状态。
    if (!id) { renderRaw(); renderTimeline(); return }
    // 合并完整数据，但不要把旧请求结果强制切回到先前的选择。
    try { merge(await api(`/api/runs/${encodeURIComponent(id)}`)) }
    catch (error) { if (deletedSessions.has(sessionId)) return; throw error }
    // 用户仍查看相同记录时才刷新内容。
    if (selected === id) { renderRaw(runs.get(id)); renderTimeline(runs.get(id)) }
  // 结束详情加载。
  }

  // 刷新摘要列表，供首次打开或查看其他网页发起的调用。
  async function refreshRuns() {
    // 服务端只传摘要，完整数据按选择读取。
    const summaries = await api('/api/runs')
    // 已显式清理的记录不继续留在本地菜单里。
    for (const id of runs.keys()) if (!summaries.some(run => run.id === id)) runs.delete(id)
    // 合并列表元数据，但保留本页已接收的完整事件。
    for (const run of summaries) merge(run)
    // 更新菜单并读选中项完整内容。
    renderChoices()
    // 详情能修复本页错过的 SSE 事件。
    await detail()
  // 结束列表刷新。
  }

  // 折叠只改变本页的展示；保存完整 ID，让轮询和切换标签后仍保留展开状态。
  const collapsedPlugins = new Set()

  // 默认按实际服务依赖构建森林；需要时切换为原来的配置归属。
  function renderPluginTree(state) {
    // 根元素是语义化列表，子容器也使用 ul/li；不声明缺少完整方向键行为的 ARIA tree。
    const list = $('plugin-list')
    // 轮询会重建节点，先记住键盘焦点的条目和动作，稍后恢复到同一控件。
    const focused = list.contains(document.activeElement) ? document.activeElement : null
    // 完整 ID 能区分不同 include 子树中名称相同的插件。
    const focusId = focused?.closest('[data-tree-key]')?.dataset.treeKey
    // 展开按钮与启停按钮分别记录，刷新后不会把两种动作混为一谈。
    const focusAction = focused?.dataset.action
    const roots = window.dshPluginTree.build(state, $('plugin-tree-mode').value)
    // 折叠键包含当前展示方式和分支，切换两种树不会混用折叠状态。
    const keys = new Set()
    const collect = items => { for (const item of items) { keys.add(item.treeKey); collect(item.children) } }
    collect(roots)
    for (const key of collapsedPlugins) if (!keys.has(key)) collapsedPlugins.delete(key)
    // 收集新控件，以便恢复重绘前的键盘焦点；不把外部 ID 拼成 CSS 选择器。
    const controls = new Map()
    // 每次递归生成一个 li，容器的子列表嵌套在该 li 内。
    function renderNode(model) {
      const { entry, children, treeKey } = model
      if (model.missing) {
        const missing = document.createElement('li')
        missing.className = 'plugin-missing'
        missing.textContent = `缺少服务：${model.relation}；未找到提供者。`
        return missing
      }
      if (model.reference) {
        const reference = document.createElement('li')
        reference.className = 'plugin-reference'
        reference.dataset.treeKey = treeKey
        const button = document.createElement('button')
        button.type = 'button'
        button.dataset.action = 'reference'
        controls.set(`${treeKey}/reference`, button)
        button.textContent = `↪ ${entry.key} · ${model.reference}`
        button.addEventListener('click', () => {
          const target = [...list.querySelectorAll('[data-plugin-id]')].find(item => item.dataset.pluginId === entry.id)
          if (!target) return
          // 定位共享节点时展开所有祖先，并同步既有折叠按钮的状态。
          for (let parent = target.parentElement.closest('.plugin-node'); parent; parent = parent.parentElement.closest('.plugin-node')) {
            const disclosure = parent.querySelector(':scope > .plugin-row > .plugin-disclosure')
            if (disclosure?.getAttribute('aria-expanded') === 'false') disclosure.click()
          }
          target.scrollIntoView({ block: 'center' })
          target.querySelector(':scope > .plugin-row > .plugin-inspect')?.focus({ preventScroll: true })
        })
        const detail = document.createElement('small')
        detail.textContent = model.relation
        reference.append(button, detail)
        return reference
      }
      // li 是一项配置条目，容器和普通插件都使用真实 ID。
      const item = document.createElement('li')
      // 保留数据标识供焦点恢复、浏览器检查和自动化验证使用。
      if (!model.scope) item.dataset.pluginId = entry.id
      item.dataset.treeKey = treeKey
      // 通用节点类负责列表布局，不依靠推算深度伪造缩进。
      item.className = 'plugin-node'
      // 每个节点的第一行包含展开按钮、名称、状态和启停动作。
      const row = document.createElement('div')
      // 容器增加浅色背景，树的连接线由子列表样式提供。
      row.className = `plugin-row${entry.container ? ' plugin-container' : ''}`
      // 子列表先创建，展开按钮随后只切换它的可见性，不改变插件运行状态。
      const branch = document.createElement('ul')
      // 缩进和连接线随真实嵌套层级自然增加。
      branch.className = 'plugin-children'
      // 显式列表角色保留去掉默认圆点后的列表语义。
      branch.setAttribute('role', 'list')
      // 根据之前的用户操作恢复展开状态；首次访问默认展开。
      branch.hidden = collapsedPlugins.has(treeKey)
      // 有实际子条目的节点才提供折叠按钮，空容器只显示占位。
      if (children.length) {
        // 原生按钮默认支持 Tab 聚焦以及 Enter/空格操作。
        const disclosure = document.createElement('button')
        // 避免浏览器把按钮解释为任何外层表单的提交。
        disclosure.type = 'button'
        // 专门的样式区分“折叠展示”与“停用插件”。
        disclosure.className = 'plugin-disclosure'
        // 记录焦点动作类型，定时刷新后恢复键盘位置。
        disclosure.dataset.action = 'disclosure'
        // 同步图标和辅助技术读到的展开状态。
        const updateDisclosure = () => {
          // 箭头只表达当前层是否打开，不代表插件是否 active。
          disclosure.textContent = branch.hidden ? '▸' : '▾'
          // 完整 ID 作为操作对象，避免多个同名子树的无障碍名称冲突。
          disclosure.setAttribute('aria-label', `${branch.hidden ? '展开' : '折叠'} ${entry.id}`)
          // aria-expanded 与真实子列表可见性保持一致。
          disclosure.setAttribute('aria-expanded', String(!branch.hidden))
        // 结束展开按钮状态更新。
        }
        // 首次绘制就设置图标及无障碍状态。
        updateDisclosure()
        // 展开操作只修改页面，不发送插件控制请求或结束当前会话。
        disclosure.addEventListener('click', () => {
          // hidden 是 DOM 布尔属性，true 会隐藏整个后代列表。
          branch.hidden = !branch.hidden
          // 把用户选择存入页面状态，以免下一次轮询又自动展开。
          if (branch.hidden) collapsedPlugins.add(treeKey)
          // 重新展开时删除折叠标记。
          else collapsedPlugins.delete(treeKey)
          // 更新屏幕上和辅助技术读到的同一状态。
          updateDisclosure()
        // 结束折叠点击处理。
        })
        // 记住该控件供轮询重绘后恢复焦点。
        controls.set(`${treeKey}/disclosure`, disclosure)
        // 折叠控件位于名称之前，视觉顺序与键盘顺序一致。
        row.append(disclosure)
      // 叶节点留出箭头位置，保持同层名称对齐。
      } else {
        // 装饰占位不创建无意义的可聚焦按钮。
        const spacer = document.createElement('span')
        // 宽度与展开按钮一致。
        spacer.className = 'plugin-disclosure-space'
        // 占位没有可供辅助技术朗读的含义。
        spacer.setAttribute('aria-hidden', 'true')
        // 与容器节点使用相同的行结构。
        row.append(spacer)
      // 结束展开控件分支。
      }
      // 信息块允许收缩与换行，避免长模块名挤走启停按钮。
      const info = document.createElement('div')
      // 样式仅影响布局，不影响插件状态。
      info.className = 'plugin-info'
      // 树内显示局部名称，完整 ID 仍用于控制接口与工具提示。
      const name = document.createElement('strong')
      // 外部值只写入文本，不作为 HTML 执行。
      name.textContent = entry.key
      // 悬停可以对照完整定位路径与模块来源。
      name.title = `${entry.id}\n${entry.module}`
      // 用可读职责与实际状态解释这个节点。
      const description = document.createElement('small')
      // 职责与实际运行状态分开，避免把“配置允许启动”误认为插件正在运行。
      description.textContent = `${entry.container ? '配置容器 · ' : ''}${entry.description}`
      const running = entry.enabled && entry.phase === 'active'
      const waiting = entry.enabled && entry.phase === 'pending'
      const status = document.createElement('span')
      status.className = 'plugin-status'
      status.dataset.state = !entry.enabled ? 'disabled' : entry.phase
      status.textContent = !entry.enabled ? (['active', 'loading', 'unloading'].includes(entry.phase) ? '停用中' : '已停用')
        : waiting ? '未运行 · 等待依赖' : phases[entry.phase] ?? entry.phase
      // 信息只读；操作由独立按钮承担。
      info.append(name, status, description)
      if (model.relation || model.unknown) {
        const relation = document.createElement('small')
        relation.className = 'plugin-service-relation'
        relation.textContent = model.unknown ? '尚未加载，依赖声明未知。' : `依赖服务：${model.relation}`
        info.append(relation)
      }
      if (waiting) {
        const hint = document.createElement('small')
        hint.className = 'plugin-waiting-hint'
        hint.textContent = '当前未运行；依赖满足后自动启动。'
        info.append(hint)
      }
      // 每个开关都操作真实插件，折叠不会改变这个 enabled 状态。
      const toggle = document.createElement('button')
      // 明确不提交表单。
      toggle.type = 'button'
      // 保留已有开关视觉与状态表达。
      toggle.className = `plugin-toggle ${running ? 'enabled' : ''}`
      // 焦点恢复可以区分同一个条目的两类按钮。
      toggle.dataset.action = 'toggle'
      // 配置容器与控制入口保持只读，其余按钮说明实际动作。
      const action = !entry.enabled ? '启用' : running ? '停用' : '取消启用'
      toggle.textContent = entry.switchable ? action : '固定'
      // 无障碍名称与可见动作一致；“取消启用”仍调用既有的关闭配置接口。
      toggle.setAttribute('aria-label', `${action} ${entry.id}`)
      // 修改过程中只禁用启停动作；折叠始终可以操作。
      toggle.disabled = !entry.switchable || changing || state.changing
      // 固定节点的原因由服务端返回，不让界面自行猜测权限。
      toggle.title = entry.reason ?? `${waiting ? '取消后，依赖恢复时也不会自动启动。' : ''}${entry.persisted ? '会结束当前会话；网页 MCP 配置会保存。' : '会结束当前会话；仅在当前进程生效。'}`
      // 启停行为与旧列表一致，成功或失败后都重新查询真实状态。
      toggle.addEventListener('click', async () => {
        // 串行处理本页发起的修改，避免重复请求。
        changing = true
        // 修改期间只锁定插件开关，不锁定树的展开控件。
        list.querySelectorAll('.plugin-toggle').forEach(button => { button.disabled = true })
        // 清除旧的控制错误，显示本次请求的结果。
        $('debug-notice').textContent = ''
        // 参数依然使用完整条目 ID，不能把局部显示名称用于精确定位。
        try { await api('/api/plugins/toggle', post({ id: entry.id, enabled: !entry.enabled })) }
        // 失败不伪造服务端状态，交给下一次快照恢复界面。
        catch (error) { fail(error) }
        // 解除修改锁并刷新插件树与模型就绪信息。
        finally { changing = false; await refreshPlugins().catch(fail) }
      // 结束启停点击处理。
      })
      // 收集新开关供焦点恢复。
      controls.set(`${treeKey}/toggle`, toggle)
      // 展开控件已经在行首，后面追加信息和实际控制按钮。
      // 查看依赖只导航；容器和已停用条目也可检查已知声明。
      const inspect = document.createElement('button')
      inspect.type = 'button'
      inspect.className = 'plugin-inspect'
      inspect.dataset.action = 'dependencies'
      inspect.textContent = '依赖'
      inspect.setAttribute('aria-label', `查看 ${entry.id} 的依赖关系`)
      inspect.addEventListener('click', () => model.dependencyNodeId ? window.dshDependencies.selectNode(model.dependencyNodeId) : window.dshDependencies.selectEntry(entry.id))
      controls.set(`${treeKey}/dependencies`, inspect)
      if (model.scope) row.append(info)
      else row.append(info, inspect, toggle)
      // 无论是否存在子节点，这一行都先加入所属 li。
      item.append(row)
      // 只有真实存在孩子时才添加子列表，叶节点没有虚假空分支。
      if (children.length) {
        // 递归生成孩子，后代层级由嵌套列表表达。
        branch.append(...children.map(renderNode))
        // 子列表归属当前 li，而不是平铺到根列表。
        item.append(branch)
      // 结束子列表添加。
      }
      // 返回当前配置条目的完整 DOM 子树。
      return item
    // 结束单节点绘制。
    }
    // 一次替换完整树，避免读到半棵旧树、半棵新树。
    list.replaceChildren(...roots.map(renderNode))
    // 如果用户正在树里操作键盘，恢复到同一条目的同一动作；刷新按钮不会被抢焦点。
    const restore = controls.get(`${focusId}/${focusAction}`)
    // 控件仍存在且可操作时才恢复，隐藏或禁用元素不强行聚焦。
    if (restore && !restore.disabled) restore.focus({ preventScroll: true })
  // 结束插件树绘制。
  }

  $('plugin-tree-mode').addEventListener('change', () => { if (pluginState) renderPluginTree(pluginState) })
  let pluginState = null

  // 从真实 Loader 状态绘制插件开关，不自行维护另一份“已启动”真相。
  async function refreshPlugins() {
    // 防止轮询与按钮刷新产生交叠读取。
    if (loading) return
    // 即使查询失败也要释放 loading 锁。
    loading = true
    // 网络或解析错误交给上层状态区域处理。
    try {
      // modelReady 还检查当前 provider 是否存在，而不仅仅检查核心组件。
      const state = await api('/api/plugins')
      // 用全局版本识别其他页面发起的启停；第一次读取不清空现有聊天。
      const changed = pluginRevision !== null && pluginRevision !== state.revision
      // 保存当前版本，避免下一轮刷新重复重置。
      pluginRevision = state.revision
      // 把可用性桥接给聊天脚本，核心服务停止后禁用发送。
      window.dispatchEvent(new CustomEvent('dsh:plugin-state', { detail: { changed, ready: state.modelReady } }))
      // 控制页面可用不代表模型可用，分别展示状态。
      $('debug-state').textContent = state.changing ? '正在切换' : state.modelReady ? '模型就绪' : '依赖未就绪'
      // 层级只由服务端的真实 parentId 决定，前端不按插件 ID 的冒号推断。
      pluginState = state
      renderPluginTree(state)
      // 同一份响应也更新实际依赖，启停后的缺失服务会反映在视图中。
      window.dshDependencies.update(state.dependencies)
    // 查询异常也释放读取锁，让下一次刷新可以重试。
    } finally { loading = false }
  // 结束插件状态刷新。
  }

  // 标签只切换视图，不改变模型调用状态或删记录。
  for (const name of ['plugins', 'raw', 'timeline', 'simulation', 'mcp', 'skills', 'files']) $('tab-' + name).addEventListener('click', () => {
    // 保存当前视图，用于轮询时决定是否读取历史详情。
    tab = name
    // 同步标签的视觉状态和无障碍按下状态。
    for (const other of ['plugins', 'raw', 'timeline', 'simulation', 'mcp', 'skills', 'files']) {
      // hidden 从布局移除非当前面板。
      $('panel-' + other).hidden = other !== name
      // selected 只控制样式。
      $('tab-' + other).classList.toggle('selected', other === name)
      // aria-pressed 让屏幕阅读器知道当前选择。
      $('tab-' + other).setAttribute('aria-pressed', String(other === name))
    // 结束标签同步。
    }
    // 插件视图不需要记录工具栏，其他视图共用它。
    $('run-toolbar').hidden = !['raw', 'timeline'].includes(name)
    // 第一次查看记录时拉取旧轮次，支持页面刷新后继续检查。
    if (['raw', 'timeline'].includes(name)) void refreshRuns().catch(fail)
  // 结束标签绑定。
  })
  // 实时模型数据由 app.js 的 SSE 读取器转发，不建立重复的模型调用。
  window.addEventListener('dsh:mcp-change', () => { void refreshPlugins().catch(fail) })
  window.addEventListener('dsh:skills-change', () => { void refreshPlugins().catch(fail) })
  window.addEventListener('dsh:session-deleted', event => {
    deletedSessions.add(event.detail.id)
    for (const [id, run] of runs) if (run.sessionId === event.detail.id) runs.delete(id)
    renderChoices()
    renderRaw(runs.get(selected))
    renderTimeline(runs.get(selected))
  })
  window.addEventListener('dsh:debug', event => {
    // 区分轮次元数据与详细事件。
    const { type, data } = event.detail
    // 先取得 run ID 并选中最新轮次，随后保留按序到来的所有事件。
    if (type === 'run') { if (deletedSessions.has(data.sessionId)) return; merge({ ...data, events: [] }); selected = data.id; renderChoices() }
    // 详细事件带所属 runId，不能放入当前恰好选中的另一段记录。
    else if (data.runId && runs.has(data.runId)) {
      // 取得所属记录后按 seq 合并。
      const run = runs.get(data.runId)
      // 结算事件同时更新摘要状态与结束时间。
      merge({ ...run, events: [data.event], ...(data.event.kind === 'run/end' ? { status: data.event.data.status, endedAt: data.event.time } : {}) })
    // 结束实时事件分支。
    }
    // 更新节流不丢数据，只减少 JSON 和时间线的重绘次数。
    schedule()
  // 结束 SSE 事件桥接。
  })
  // 手动选择旧记录时加载完整详情，避免只看到本页缓存的一部分。
  $('run-select').addEventListener('change', () => { selected = $('run-select').value; void detail().catch(fail) })
  // 仅改变当前数据投影，不重新发模型请求。
  $('raw-kind').addEventListener('change', () => renderRaw(runs.get(selected)))
  // 关键步骤/全部事件是显示过滤，原始 events 保持完整。
  $('timeline-filter').addEventListener('change', () => renderTimeline(runs.get(selected)))
  // 刷新按钮供其他页面修改插件时立即查看。
  $('refresh-plugins').addEventListener('click', () => { void refreshPlugins().catch(fail) })
  // 读取服务端记录列表，不清理已有数据。
  $('refresh-runs').addEventListener('click', () => { void refreshRuns().catch(fail) })
  // 下载先重新读取完整快照，避免导出只有摘要或断连前的部分内容。
  $('download-run').addEventListener('click', async () => {
    // 浏览器下载失败也显示在面板，不影响聊天。
    try {
      // 没有记录时不构造无效下载路径。
      if (!selected) return
      // 以服务器保存的完整 JSON 为准，而不是界面上的某一种投影。
      const run = await api(`/api/runs/${encodeURIComponent(selected)}`)
      // Blob 是本地数据，不上传到第三方。
      const url = URL.createObjectURL(new Blob([JSON.stringify(run, null, 2)], { type: 'application/json' }))
      // 临时链接触发用户刚刚请求的下载。
      const link = document.createElement('a')
      // URL 指向本地 Blob，不包含凭据查询参数。
      link.href = url
      // 文件名包含稳定 run ID，方便多次实验比较。
      link.download = `链路仿真Agent-调用记录-${run.id}.json`
      // 通过真实用户点击处理器触发下载。
      link.click()
      // 给下载留出取得 Blob 的机会，随后释放对象 URL。
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    // 无网络或记录已清理时给出明确提示。
    } catch (error) { fail(error) }
  // 结束下载处理。
  })
  // 清空只删除服务端已结束记录，活动轮次仍可继续捕获。
  $('clear-runs').addEventListener('click', async () => { try { await api('/api/runs/clear', post({})); await refreshRuns() } catch (error) { fail(error) } })
  // 初次打开页面即读取实际状态与已有历史。
  void refreshPlugins().catch(fail)
  // 历史在服务端内存，刷新网页后可以重新取得。
  void refreshRuns().catch(fail)
  // 轮询让其他网页发起的插件修改最终反映到当前页面。
  setInterval(() => { if (!changing) void refreshPlugins().catch(fail); if (['raw', 'timeline'].includes(tab)) void refreshRuns().catch(fail) }, 4000)
// 立即执行，安装事件监听器但不创建任何 Agent 或模型请求。
})()
