/** 历史会话列表、选择与删除；Agent 的创建和恢复由 app.js 驱动。 */
window.dshHistory = (() => {
  const panel = document.querySelector('#session-history')
  const list = document.querySelector('#sessions-list')
  const state = document.querySelector('#sessions-state')
  const search = document.querySelector('#sessions-search')
  const current = document.querySelector('#session-current')
  const toggle = document.querySelector('#history-toggle')
  const backdrop = document.querySelector('#history-backdrop')
  const closeButton = document.querySelector('#history-close')
  const workspace = document.querySelector('.workspace')
  const narrow = matchMedia('(max-width:1199px)')
  const storageKey = 'dsh:last-session'
  let rows = [], selected = null, version = 0, deleting = null
  // 同源标签页同步删除通知，防止另一个页面仍拿已删除 ID 继续对话。
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('dsh:session-history') : null
  const element = (tag, text, className) => {
    const node = document.createElement(tag)
    node.textContent = text
    if (className) node.className = className
    return node
  }
  const format = time => new Date(time).toLocaleString('zh-CN', { hour12: false })
  function render() {
    const query = search.value.trim().toLowerCase()
    const matches = rows.filter(row => row.title.toLowerCase().includes(query) || row.id.includes(query))
    list.replaceChildren(...matches.map(row => {
      const item = element('div', '', 'session-row')
      const button = element('button', '', 'session-item')
      button.type = 'button'
      button.dataset.sessionId = row.id
      button.setAttribute('aria-pressed', String(row.id === selected))
      button.append(element('strong', row.title), element('span', `${format(row.updatedAt)} · ${row.turns} 轮`))
      button.addEventListener('click', () => window.dispatchEvent(new CustomEvent('dsh:open-session', { detail: { id: row.id } })))
      button.disabled = deleting === row.id
      const remove = element('button', deleting === row.id ? '删除中…' : '删除', 'session-delete')
      remove.type = 'button'
      remove.setAttribute('aria-label', `删除会话：${row.title}`)
      remove.disabled = deleting !== null
      remove.addEventListener('click', () => { void removeSession(row) })
      item.append(button, remove)
      return item
    }))
    if (!matches.length) list.append(element('p', rows.length ? '没有匹配的会话。' : '还没有保存的会话。', 'control-hint'))
    current.textContent = rows.find(row => row.id === selected)?.title ?? (selected ? '已保存的会话' : '新对话')
  }
  async function refresh() {
    const request = ++version
    try {
      const response = await fetch('/api/sessions', { cache: 'no-store', signal: AbortSignal.timeout(15000) })
      const value = await response.json()
      if (!response.ok) throw new Error(value.error || '读取历史失败。')
      if (request !== version || deleting) return
      // 其他浏览器删除的会话在重新读取列表时同样退出当前页面。
      const missing = selected && rows.some(row => row.id === selected) && !value.sessions.some(row => row.id === selected) ? selected : null
      rows = value.sessions
      if (missing) removed(missing)
      render()
      state.textContent = `共 ${rows.length} 个会话。${value.errors.length ? `其中另有 ${value.errors.length} 条记录读取失败，磁盘文件已保留。` : ''}`
    } catch (error) { if (request === version) state.textContent = error.message }
  }
  function select(id) {
    selected = id
    // sessionStorage 按标签页隔离，只记录 ID；实际聊天内容始终来自后端磁盘。
    try { if (id) sessionStorage.setItem(storageKey, id); else sessionStorage.removeItem(storageKey) } catch {}
    render()
  }
  function removed(id) {
    version++
    rows = rows.filter(row => row.id !== id)
    if (selected === id) select(null)
    else render()
    window.dispatchEvent(new CustomEvent('dsh:session-deleted', { detail: { id } }))
  }
  async function removeSession(row) {
    if (deleting || !window.confirm(`删除会话“${row.title}”？\n会话记录将永久删除，无法恢复。上传文件和仿真结果会保留。`)) return
    deleting = row.id
    version++
    render()
    state.textContent = '正在停止会话并删除历史…'
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(row.id)}/history`, { method: 'DELETE' })
      if (!response.ok && response.status !== 404) {
        const value = await response.json().catch(() => ({}))
        throw new Error(value.error || `删除失败（${response.status}）`)
      }
      removed(row.id)
      channel?.postMessage({ type: 'deleted', id: row.id })
      state.textContent = `会话已删除，共 ${rows.length} 个会话。`
    } catch (error) { state.textContent = error.message }
    finally {
      deleting = null
      render()
      // 被删除按钮退出 DOM 后，把焦点留在侧栏，窄屏下也能继续操作。
      const target = [...list.querySelectorAll('.session-item')].find(node => node.dataset.sessionId === selected) ?? list.querySelector('.session-item') ?? search
      target.focus({ preventScroll: true })
    }
  }
  channel?.addEventListener('message', event => {
    if (event.data?.type === 'deleted' && typeof event.data.id === 'string') removed(event.data.id)
  })
  let initial = null
  try { initial = sessionStorage.getItem(storageKey) } catch {}
  // 每次加载页面都默认展开；标签页只记住会话 ID，不记住手动收起状态。
  function syncSidebar() {
    const open = !panel.hidden
    const modal = open && narrow.matches
    toggle.setAttribute('aria-expanded', String(open))
    toggle.title = open ? '历史会话侧栏已展开' : '展开历史会话侧栏'
    backdrop.hidden = !modal
    workspace.inert = modal
    document.body.classList.toggle('history-open', open)
    if (modal) { panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true') }
    else { panel.removeAttribute('role'); panel.removeAttribute('aria-modal') }
    // 从宽屏切到窄屏时，焦点不能留在已经 inert 的聊天区域。
    if (modal && workspace.contains(document.activeElement)) search.focus()
  }
  function setOpen(open) {
    const restoreFocus = !open && (panel.contains(document.activeElement) || document.activeElement === backdrop)
    panel.hidden = !open
    syncSidebar()
    if (open) { search.focus(); void refresh() }
    else if (restoreFocus) toggle.focus()
  }
  // 展开与收起使用各自按钮，选择会话、Esc 或点击遮罩均不改变展开状态。
  toggle.addEventListener('click', () => setOpen(true))
  closeButton.addEventListener('click', () => setOpen(false))
  document.addEventListener('keydown', event => {
    if (panel.hidden) return
    // 窄屏抽屉展开时保持键盘焦点在侧栏内，避免 Tab 跳到遮罩后的页面。
    if (event.key === 'Tab' && narrow.matches) {
      const controls = [...panel.querySelectorAll('button:not(:disabled), input:not(:disabled)')].filter(control => control.getClientRects().length)
      const first = controls[0], last = controls.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
  })
  narrow.addEventListener('change', syncSidebar)
  syncSidebar()
  // 窄屏默认打开的是模态抽屉，初始焦点应在抽屉内，避免落到被遮罩的聊天区。
  if (narrow.matches && !panel.hidden) search.focus()
  search.addEventListener('input', render)
  document.querySelector('#sessions-refresh').addEventListener('click', refresh)
  window.addEventListener('dsh:sessions-refresh', () => { void refresh() })
  return { refresh, select, initial }
})()
