/** MCP 服务管理页：只通过同源 API 操作服务端的真实 MCP 客户端。 */
(() => {
  // 局部状态与聊天分开；轮询不会覆盖正在编辑的表单。
  const $ = id => document.getElementById(id)
  let snapshot = null, editing = null, busy = false, reading = false
  // 以服务 ID、工具名保存展开状态，列表刷新后仍可继续阅读参数。
  const opened = new Set()
  const phases = { active: '客户端运行中', pending: '等待依赖', loading: '连接中', stopped: '已停止', failed: '连接失败', disposed: '已释放', unloading: '正在断开' }

  async function api(path, body) {
    const response = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const value = await response.json()
    if (!response.ok) throw new Error(value.error || `请求失败（${response.status}）`)
    return value
  }
  // 外部服务名称、错误和工具说明始终用文本展示，不能注入页面 HTML。
  const notice = (value, error = false) => { $('mcp-notice').textContent = value; $('mcp-notice').classList.toggle('error', error) }
  const node = (tag, text, className) => {
    const element = document.createElement(tag)
    if (text !== undefined) element.textContent = text
    if (className) element.className = className
    return element
  }

  // 只有操作按钮参与锁定；用户仍可填写表单并展开工具定义。
  function lockButtons() {
    const locked = busy || snapshot?.changing
    $('panel-mcp').querySelectorAll('button').forEach(button => { button.disabled = !!locked })
    $('mcp-submit').textContent = busy ? '正在处理连接…' : '保存服务'
  }

  function details(key, title) {
    const element = node('details')
    element.dataset.key = key
    element.open = opened.has(key)
    element.append(node('summary', title))
    // toggle 使用最终的 open 状态记录，不从按钮文字推断展开状态。
    element.addEventListener('toggle', () => {
      if (!element.isConnected) return
      if (element.open) opened.add(key)
      else opened.delete(key)
    })
    return element
  }

  function render() {
    if (!snapshot) return
    const list = $('mcp-list')
    // 轮询重建列表后恢复焦点，避免键盘用户每两秒失去当前操作位置。
    const focused = list.contains(document.activeElement) ? document.activeElement : null
    const focusId = focused?.dataset.focus
    list.replaceChildren()
    for (const service of snapshot.services) {
      const config = service.config
      const card = node('article', undefined, 'mcp-card')
      card.dataset.serviceId = service.id
      const heading = node('div', undefined, 'section-heading')
      const identity = node('div')
      identity.append(node('h4', config.serverName || '未命名服务'), node('p', `${config.transport} · ${service.source === 'web' ? '网页配置（持久化）' : 'YAML 配置'}`))
      heading.append(identity, node('span', service.enabled ? (phases[service.phase] || service.phase) : '已停用', 'state-pill'))
      card.append(heading)
      const endpoint = config.transport === 'stdio' ? [config.command, ...(config.args || [])].join(' ') : config.url
      card.append(node('p', endpoint, 'mcp-endpoint'))
      if (config.envKeys?.length || config.headerKeys?.length) card.append(node('p', `已保存的${config.transport === 'stdio' ? '环境变量' : '请求头'}：${(config.envKeys || config.headerKeys).join('、')}（值已隐藏）`, 'control-hint'))
      if (service.error) card.append(node('p', service.error, 'debug-notice'))
      const actions = node('div', undefined, 'run-actions')
      const button = (label, action, callback) => {
        const element = node('button', label, 'plain-button')
        element.type = 'button'
        element.dataset.focus = `${service.id}:${action}`
        element.addEventListener('click', callback)
        actions.append(element)
      }
      button(service.enabled ? '停用' : '启用', 'toggle', () => change('toggle', { id: service.id, enabled: !service.enabled }))
      button('重新连接', 'reconnect', () => change('reconnect', { id: service.id }))
      if (service.editable) {
        button('编辑', 'edit', () => edit(service))
        button('删除配置', 'delete', () => change('delete', { id: service.id }))
      }
      card.append(actions)
      // 工具列表来自当前 ToolRuntime；停用后为空，不展示过期缓存。
      const catalog = details(`${service.id}:tools`, `可用工具（${service.tools.length}）`)
      catalog.querySelector('summary').dataset.focus = `${service.id}:tools`
      if (!service.tools.length) catalog.append(node('p', service.enabled ? '当前未公布工具。请检查客户端状态、tools 核心插件或重新连接。' : '服务已停用，工具已从 agent 可用列表移除。', 'control-hint'))
      for (const tool of service.tools) {
        const item = details(`${service.id}:${tool.name}`, tool.name)
        item.querySelector('summary').dataset.focus = `${service.id}:${tool.name}`
        item.append(node('p', tool.description || '未提供说明。'), node('pre', JSON.stringify(tool, null, 2), 'raw-content'))
        catalog.append(item)
      }
      card.append(catalog)
      if (!service.editable) card.append(node('p', '名称和连接参数由 YAML 定义；请在配置文件中编辑或删除。', 'control-hint'))
      list.append(card)
    }
    if (!snapshot.services.length) list.append(node('p', '尚未注册 MCP 服务。可以填入本机示例后保存。', 'control-hint'))
    $('mcp-storage').textContent = `网页配置保存位置：${snapshot.configPath}`
    if (snapshot.notice) notice(snapshot.notice, true)
    lockButtons()
    if (focusId) [...list.querySelectorAll('[data-focus]')].find(element => element.dataset.focus === focusId)?.focus({ preventScroll: true })
  }

  async function refresh() {
    if (reading || busy) return
    reading = true
    try { snapshot = await api('/api/mcp/services'); render() }
    catch (error) { notice(error.message, true) }
    finally { reading = false }
  }

  // 修改响应后立即通知插件树刷新，让聊天会话版本和工具列表同步更新。
  async function change(action, body) {
    if (busy || snapshot?.changing) return
    busy = true
    notice('正在更新服务，请稍候…')
    lockButtons()
    try {
      snapshot = await api('/api/mcp/' + action, body)
      notice('服务已更新。')
      if (action === 'save' || (action === 'delete' && editing === body.id)) reset()
    } catch (error) { notice(error.message, true) }
    finally {
      busy = false
      // 即使恰好有一次轮询正在返回，也先按修改响应解除本页按钮锁。
      render()
      window.dispatchEvent(new Event('dsh:mcp-change'))
      await refresh()
    }
  }

  function transportFields() {
    const stdio = $('mcp-transport').value === 'stdio'
    $('mcp-stdio-fields').hidden = !stdio
    $('mcp-http-fields').hidden = stdio
    // 隐藏分支不参与原生表单校验，避免未填写的隐藏 URL 阻止提交。
    $('mcp-command').required = stdio
    $('mcp-url').required = !stdio
    $('mcp-command').disabled = !stdio
    $('mcp-url').disabled = stdio
  }

  function reset() {
    editing = null
    $('mcp-form').reset()
    $('mcp-form-title').textContent = '注册 MCP 服务'
    transportFields()
  }

  function edit(service) {
    reset()
    editing = service.id
    const config = service.config
    $('mcp-form-title').textContent = `编辑服务：${config.serverName}`
    $('mcp-name').value = config.serverName
    $('mcp-transport').value = config.transport
    $('mcp-timeout').value = config.toolCallTimeoutMs
    $('mcp-enabled').checked = service.enabled
    if (config.transport === 'stdio') {
      $('mcp-command').value = config.command
      $('mcp-args').value = JSON.stringify(config.args, null, 2)
      $('mcp-cwd').value = config.cwd
    } else $('mcp-url').value = config.url
    // API 不返回凭据值；留空会由后端保留已有 env/headers。
    transportFields()
    $('mcp-form').scrollIntoView({ behavior: 'smooth', block: 'start' })
    $('mcp-name').focus({ preventScroll: true })
  }

  $('mcp-example').addEventListener('click', () => {
    if (!snapshot) return
    reset()
    const names = new Set(snapshot.services.map(service => service.config.serverName))
    let name = 'local-example', suffix = 2
    while (names.has(name)) name = 'local-example-' + suffix++
    $('mcp-name').value = name
    $('mcp-command').value = snapshot.defaults.command
    $('mcp-args').value = JSON.stringify(snapshot.defaults.args, null, 2)
    $('mcp-cwd').value = snapshot.defaults.cwd
    notice('已填入本机示例。保存后会启动独立的 MCP 服务实例。')
  })
  $('mcp-transport').addEventListener('change', transportFields)
  $('mcp-reset').addEventListener('click', reset)
  $('mcp-refresh').addEventListener('click', refresh)
  $('mcp-form').addEventListener('submit', event => {
    event.preventDefault()
    try {
      const config = { serverName: $('mcp-name').value.trim(), transport: $('mcp-transport').value, enabled: $('mcp-enabled').checked, toolCallTimeoutMs: Number($('mcp-timeout').value) }
      if (config.transport === 'stdio') Object.assign(config, { command: $('mcp-command').value.trim(), args: JSON.parse($('mcp-args').value.trim() || '[]'), cwd: $('mcp-cwd').value.trim() })
      else config.url = $('mcp-url').value.trim()
      const field = config.transport === 'stdio' ? 'env' : 'headers'
      const value = $('mcp-' + field).value.trim()
      if (value) config[field] = JSON.parse(value)
      void change('save', { ...(editing ? { id: editing } : {}), config })
    } catch { notice('参数、环境变量和 Headers 必须是有效 JSON。参数使用数组，环境变量和 Headers 使用对象。', true) }
  })
  $('tab-mcp').addEventListener('click', () => { void refresh() })
  // 页面隐藏或未打开 MCP 标签时不轮询；重新打开时马上查询真实状态。
  setInterval(() => { if (!document.hidden && !$('panel-mcp').hidden) void refresh() }, 2000)
  transportFields()
  void refresh()
})()
