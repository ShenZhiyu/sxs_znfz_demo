/** 输入目录：技能来自官方用户调用目录，MCP 工具来自实际连接的服务；补全只编辑草稿。 */
;(() => {
  const input = document.querySelector('#message')
  const panel = document.querySelector('#command-completion')
  const list = document.querySelector('#completion-list')
  const status = document.querySelector('#completion-status')
  let skills = [], tools = [], rows = [], selected = 0
  let loadedAt = 0, pending = null, generation = 0
  let failures = [], composing = false, dismissed = false, accepting = false, rendered = ''
  const token = /^[A-Za-z0-9_.:-]*$/

  // /mcp 和 /skill 直接打开对应目录；替换范围包含目录前缀，保留后面的 JSON 或需求正文。
  function context() {
    if (composing || dismissed || document.activeElement !== input || input.selectionStart !== input.selectionEnd) return null
    const caret = input.selectionStart, prefix = input.value.slice(0, caret)
    const group = prefix.match(/(?:^|\s)\/(mcp|skill)(?:[ \t]+([A-Za-z0-9_.:-]*))?$/)
    if (group && (group[2] !== undefined || !/[A-Za-z0-9_.:-]/.test(input.value[caret] ?? ''))) {
      const scope = group[1], start = prefix.lastIndexOf('/' + scope)
      // 光标停在 /mcp 后、但尚未进入已有工具名时，不消耗那个工具名。
      const hasArgument = group[2] !== undefined
      const argumentStart = hasArgument ? caret - group[2].length : caret
      const rest = hasArgument ? input.value.slice(argumentStart).match(/^[^\s]*/)[0] : ''
      if (!token.test(rest)) return null
      return { scope, query: group[2] ?? '', start, end: hasArgument ? argumentStart + rest.length : caret }
    }
    const match = prefix.match(/(?:^|\s)\/([A-Za-z0-9_.:-]*)$/)
    if (!match) return null
    const start = caret - match[1].length - 1
    const rest = input.value.slice(start + 1).match(/^[^\s]*/)[0]
    if (!token.test(rest)) return null
    return { scope: 'all', query: match[1], start, end: start + 1 + rest.length }
  }

  function close() {
    panel.hidden = true
    input.setAttribute('aria-expanded', 'false')
    input.removeAttribute('aria-activedescendant')
  }

  // 参数提示来自实际 JSON Schema；星号表示必填，不替用户编造参数值。
  function parameters(schema) {
    const required = new Set(schema?.required ?? [])
    return Object.entries(schema?.properties ?? {}).map(([name, value]) => {
      const type = value.type ?? (value.enum ? 'enum' : value.oneOf || value.anyOf ? '多种类型' : '任意类型')
      return `${name}${required.has(name) ? '*' : ''}: ${Array.isArray(type) ? type.join('|') : type}`
    }).join(' · ') || '无具名参数'
  }
  function candidates(ctx) {
    const query = ctx.query.toLowerCase()
    const skillRows = skills.map(skill => ({ key: 'skill:' + skill.name, kind: 'skill',
      name: '/' + skill.name, detail: skill.description, badge: 'Skill', insert: '/' + skill.name }))
    const toolRows = tools.map(tool => ({ key: 'tool:' + tool.name, kind: 'mcp',
      name: (ctx.scope === 'all' ? '/' : '') + tool.name, detail: `${tool.description || 'MCP 工具'}\n参数：${parameters(tool.parameters)}`,
      badge: 'MCP · ' + tool.serverName, insert: '/mcp ' + tool.name }))
    const directories = [
      { key: 'directory:mcp', kind: 'directory', name: '/mcp', detail: '列出所有当前可用的 MCP 工具', badge: '目录', insert: '/mcp ' },
      { key: 'directory:skill', kind: 'directory', name: '/skill', detail: '列出所有当前可供用户调用的 Skill', badge: '目录', insert: '/skill ' },
    ]
    const available = ctx.scope === 'mcp' ? toolRows : ctx.scope === 'skill' ? skillRows : [...directories, ...skillRows, ...toolRows]
    return available.filter(row => row.name.toLowerCase().replace(/^\//, '').includes(query))
  }

  function sync() {
    if (!input.value) dismissed = false
    const ctx = context()
    if (!ctx) { close(); return }
    const next = candidates(ctx), signature = JSON.stringify([ctx.scope, next])
    const relevantFailures = failures.filter(scope => ctx.scope === 'all' || ctx.scope === scope)
    const title = ctx.scope === 'mcp' ? '可用 MCP 工具' : ctx.scope === 'skill' ? '可调用 Skill' : 'Skill 与 MCP 工具'
    status.textContent = next.length ? `${title} · ${next.length} 项${relevantFailures.length ? ' · 部分目录读取失败' : ''}`
      : pending ? '正在读取目录…' : relevantFailures.length ? '目录读取失败，请稍后重试'
        : ctx.scope === 'mcp' ? '没有可用 MCP 工具，请连接或启用 MCP 服务' : ctx.scope === 'skill' ? '没有可调用 Skill，请检查启用状态和用户调用权限' : '没有匹配项'
    if (signature !== rendered) {
      const previous = rows[selected]?.key
      rows = next
      selected = Math.max(0, rows.findIndex(row => row.key === previous))
      rendered = signature
      // 目录、说明与服务名称均为外部数据，必须用 textContent，不能当作 HTML。
      list.replaceChildren(...rows.map((row, index) => {
        const option = document.createElement('div')
        option.id = `completion-option-${index}`
        option.className = 'completion-option'
        option.setAttribute('role', 'option')
        option.dataset.kind = row.kind
        const heading = document.createElement('div'), name = document.createElement('strong'), badge = document.createElement('span'), detail = document.createElement('span')
        heading.className = 'completion-label'
        name.textContent = row.name
        badge.textContent = row.badge
        badge.className = 'completion-kind'
        detail.textContent = row.detail.slice(0, 600)
        detail.className = 'completion-detail'
        heading.append(name, badge)
        option.append(heading, detail)
        option.addEventListener('pointermove', () => { selected = index; highlight() })
        option.addEventListener('mousedown', event => event.preventDefault())
        option.addEventListener('click', () => { selected = index; accept() })
        return option
      }))
    }
    panel.hidden = false
    input.setAttribute('aria-expanded', 'true')
    highlight()
  }
  function highlight() {
    Array.from(list.children).forEach((option, index) => option.setAttribute('aria-selected', String(index === selected)))
    if (rows.length) input.setAttribute('aria-activedescendant', `completion-option-${selected}`)
    else input.removeAttribute('aria-activedescendant')
  }
  function accept() {
    const ctx = context(), row = rows[selected]
    if (!ctx || !row) return
    const suffix = input.value.slice(ctx.end)
    const value = row.insert + (/^\s/.test(suffix) || row.insert.endsWith(' ') ? '' : ' ')
    if (input.value.length - (ctx.end - ctx.start) + value.length > input.maxLength) return
    input.setRangeText(value, ctx.start, ctx.end, 'end')
    input.focus()
    // 目录项继续列出子项，技能和工具项补全后收起；下一次发送才进入 Agent。
    dismissed = row.kind !== 'directory'
    accepting = true
    input.dispatchEvent(new Event('input', { bubbles: true }))
    accepting = false
    sync()
  }
  async function refresh(force = false) {
    if (pending || (!force && Date.now() - loadedAt < 3000)) return
    const version = generation
    const read = async path => {
      const response = await fetch(path, { signal: AbortSignal.timeout(8000), cache: 'no-store' })
      if (!response.ok) throw new Error('目录暂不可用')
      return response.json()
    }
    // 两种目录独立读取，一种失败不隐藏另一种仍可用的能力。
    pending = Promise.allSettled([read('/api/skills'), read('/api/mcp/services')])
    sync()
    const results = await pending
    pending = null
    if (version !== generation) { void refresh(true); return }
    skills = results[0].status === 'fulfilled' && !results[0].value.changing ? results[0].value.commands : []
    const services = results[1].status === 'fulfilled' && !results[1].value.changing ? results[1].value.services : []
    const discovered = services.filter(service => service.enabled && service.phase === 'active')
      .flatMap(service => service.tools.map(tool => ({ ...tool, serverName: service.config.serverName })))
    tools = [...new Map(discovered.map(tool => [tool.name, tool])).values()]
      .sort((a, b) => a.name.localeCompare(b.name))
    skills.sort((a, b) => a.name.localeCompare(b.name))
    failures = results.flatMap((result, index) => result.status === 'rejected' ? [index ? 'mcp' : 'skill'] : [])
    loadedAt = Date.now()
    sync()
  }

  // 单独发送目录命令只展开目录；即便目录为空也不会创建会话或消耗模型请求。
  function browse() {
    if (!/^\/(mcp|skill)\s*$/.test(input.value.trim())) return false
    dismissed = false
    input.focus()
    input.setSelectionRange(input.value.length, input.value.length)
    sync()
    void refresh(true)
    return true
  }
  input.addEventListener('input', () => { if (!accepting) dismissed = false; sync(); if (context()) void refresh() })
  input.addEventListener('focus', () => { sync(); void refresh() })
  input.addEventListener('click', () => { dismissed = false; sync(); void refresh() })
  input.addEventListener('blur', close)
  document.addEventListener('selectionchange', () => { if (document.activeElement === input) sync() })
  input.addEventListener('compositionstart', () => { composing = true; close() })
  input.addEventListener('compositionend', () => { composing = false; dismissed = false; sync(); void refresh() })
  input.addEventListener('keydown', event => {
    if (composing || event.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey) return
    if (!panel.hidden && event.key === 'Escape') { event.preventDefault(); dismissed = true; close(); return }
    if (!panel.hidden && rows.length && !event.shiftKey && ['ArrowDown', 'ArrowUp', 'Tab', 'Enter'].includes(event.key)) {
      event.preventDefault()
      if (event.key === 'Enter' || event.key === 'Tab') accept()
      else { selected = (selected + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length; highlight(); list.children[selected].scrollIntoView({ block: 'nearest' }) }
      return
    }
    if (event.key === 'Enter' && !event.shiftKey && browse()) { event.preventDefault(); return }
    if (event.key.length === 1 || ['Backspace', 'Delete'].includes(event.key)) dismissed = false
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) queueMicrotask(sync)
  })
  window.dshCompletion = { sync, browse, get composing() { return composing } }
  for (const name of ['dsh:skills-change', 'dsh:mcp-change', 'dsh:plugin-state']) window.addEventListener(name, event => {
    if (name === 'dsh:plugin-state' && !event.detail.changed) return
    generation++
    skills = []; tools = []; loadedAt = 0
    sync()
    void refresh(true)
  })
  setInterval(() => { if (context()) void refresh() }, 1500)
})()
