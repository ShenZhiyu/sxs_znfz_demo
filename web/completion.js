/** 输入目录：/ 补全命令，@ 将工作区文件加入草稿的附件队列。 */
;(() => {
  const input = document.querySelector('#message')
  const panel = document.querySelector('#command-completion')
  const list = document.querySelector('#completion-list')
  const status = document.querySelector('#completion-status')
  let skills = [], tools = [], rows = [], selected = 0
  let loadedAt = 0, pending = null, generation = 0
  let failures = [], composing = false, dismissed = false, accepting = false, rendered = ''
  let workFiles = [], filePending = false, fileFailed = false, filesLoadedAt = 0
  const token = /^[A-Za-z0-9_.:-]*$/

  // /mcp 和 /skill 直接打开对应目录；替换范围包含目录前缀，保留后面的 JSON 或需求正文。
  function context() {
    if (composing || dismissed || document.activeElement !== input || input.selectionStart !== input.selectionEnd) return null
    const caret = input.selectionStart, prefix = input.value.slice(0, caret)
    // 支持中文正文紧接 @，同时避开电子邮件和 URL 中的 @。
    const mention = prefix.match(/(?<![A-Za-z0-9_.%+/@-])@([^\s@]*)$/u)
    if (mention) {
      const rest = input.value.slice(caret).match(/^[^\s@]*/u)[0]
      return { scope: 'files', query: mention[1], start: mention.index, end: caret + rest.length }
    }
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
    if (ctx.scope === 'files') {
      return workFiles.filter(file => file.path.toLowerCase().includes(query))
        .map(file => ({ key: 'file:' + file.path, kind: 'file', name: file.name,
          detail: file.path, badge: '文件', file }))
    }
    const skillRows = skills.map(skill => ({ key: 'skill:' + skill.name, kind: 'skill',
      name: '/' + skill.name, detail: skill.description, badge: 'Skill', insert: '/' + skill.name }))
    const toolRows = tools.map(tool => ({ key: 'tool:' + tool.name, kind: 'mcp',
      name: '/' + tool.name, detail: `${tool.description || 'MCP 工具'}\n参数：${parameters(tool.parameters)}`,
      badge: 'MCP · ' + tool.serverName, insert: '/' + tool.name }))
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
    const fileScope = ctx.scope === 'files', matches = candidates(ctx)
    const next = fileScope ? matches.slice(0, 50) : matches
    const signature = JSON.stringify([ctx.scope, next])
    const relevantFailures = fileScope ? (fileFailed ? ['files'] : []) : failures.filter(scope => ctx.scope === 'all' || ctx.scope === scope)
    const title = fileScope ? '工作区文件' : ctx.scope === 'mcp' ? '可用 MCP 工具' : ctx.scope === 'skill' ? '可调用 Skill' : 'Skill 与 MCP 工具'
    status.textContent = next.length ? `${title} · ${matches.length} 项${matches.length > next.length ? ' · 继续输入可筛选' : ''}${relevantFailures.length ? ' · 部分目录读取失败' : ''}`
      : (fileScope ? filePending : pending) ? '正在读取目录…' : relevantFailures.length ? '目录读取失败，请稍后重试'
        : fileScope ? (ctx.query ? '没有匹配的工作区文件。' : '暂无工作区文件。')
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
    const value = row.kind === 'file' ? '' : row.insert + (/^\s/.test(suffix) || row.insert.endsWith(' ') ? '' : ' ')
    if (input.value.length - (ctx.end - ctx.start) + value.length > input.maxLength) return
    if (row.kind === 'file' && !window.dshFiles.attachWorkFile(row.file)) return
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

  async function refreshFiles() {
    if (filePending || Date.now() - filesLoadedAt < 3000) return
    filePending = true
    sync()
    const directory = await window.dshFiles.refresh()
    filePending = false
    fileFailed = directory === null
    workFiles = directory?.files ?? []
    filesLoadedAt = Date.now()
    sync()
  }

  function refreshContext() {
    const ctx = context()
    if (ctx?.scope === 'files') void refreshFiles()
    else if (ctx) void refresh()
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
  input.addEventListener('input', () => { if (!accepting) dismissed = false; sync(); refreshContext() })
  input.addEventListener('focus', () => { sync(); if (context()?.scope === 'files') void refreshFiles(); else void refresh() })
  input.addEventListener('click', () => { dismissed = false; sync(); if (context()?.scope === 'files') void refreshFiles(); else void refresh() })
  input.addEventListener('blur', close)
  document.addEventListener('selectionchange', () => { if (document.activeElement === input) sync() })
  input.addEventListener('compositionstart', () => { composing = true; close() })
  input.addEventListener('compositionend', () => { composing = false; dismissed = false; sync(); refreshContext() })
  input.addEventListener('keydown', event => {
    if (composing || event.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey) return
    if (!panel.hidden && event.key === 'Escape') { event.preventDefault(); dismissed = true; close(); return }
    if (!panel.hidden && rows.length && !event.shiftKey && ['ArrowDown', 'ArrowUp', 'Tab', 'Enter'].includes(event.key)) {
      event.preventDefault()
      if (event.key === 'Enter' || event.key === 'Tab') accept()
      else { selected = (selected + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length; highlight(); list.children[selected].scrollIntoView({ block: 'nearest' }) }
      return
    }
    if (!panel.hidden && filePending && context()?.scope === 'files' && event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
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
  setInterval(refreshContext, 1500)
})()
