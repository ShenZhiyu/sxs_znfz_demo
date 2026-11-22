/** Skill 管理页：本地草稿、标准 Markdown 导入导出与真实启用状态。 */
(() => {
  const $ = id => document.getElementById(id)
  let state = null, editing = null, readOnly = false, busy = false, reading = false, loadingEditor = 0
  const notice = (text, error = false) => { $('skills-notice').textContent = text; $('skills-notice').classList.toggle('error', error) }
  const node = (tag, text, className) => {
    const element = document.createElement(tag)
    if (text !== undefined) element.textContent = text
    if (className) element.className = className
    return element
  }
  const template = (name, description, body) => `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n${body}\n`

  async function api(path, body) {
    const response = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const value = await response.json()
    if (!response.ok) throw new Error(value.error || `请求失败（${response.status}）`)
    return value
  }

  function lock() {
    const locked = busy || state?.changing
    $('panel-skills').querySelectorAll('button').forEach(button => { button.disabled = !!locked })
    $('skills-save').disabled = !!locked || readOnly
    $('skills-enabled').disabled = readOnly || !!locked
    $('skills-markdown').readOnly = readOnly
    $('skills-save').textContent = busy ? '正在保存…' : readOnly ? '技能只读' : '保存技能'
  }

  function render() {
    if (!state) return
    const list = $('skills-list')
    const focusId = list.contains(document.activeElement) ? document.activeElement.dataset.action : null
    const query = $('skills-search').value.trim().toLowerCase()
    list.replaceChildren()
    for (const skill of state.skills.filter(skill => `${skill.name}\n${skill.description}`.toLowerCase().includes(query))) {
      const card = node('article', undefined, 'skill-card')
      card.dataset.skillId = skill.id
      const heading = node('div', undefined, 'section-heading')
      heading.append(node('h4', skill.name), node('span', !skill.enabled ? '已停用' : skill.available ? '可按需加载' : '等待依赖', 'state-pill'))
      card.append(heading, node('p', skill.description, 'skill-description'), node('p', `${skill.source === 'filesystem' ? '官方目录加载 · 源文件只读 · 启停状态持久化' : '网页技能 · 持久化'}${skill.bytes === null ? '' : ` · ${skill.bytes} 字节`}`, 'control-hint'))
      card.append(node('p', `当前可调用：模型${skill.modelAvailable ? '可用' : '不可用'} · 用户 /技能名 ${skill.userAvailable ? '可用' : '不可用'}`, 'control-hint'))
      card.append(node('p', `技能策略：模型${skill.invocation.modelInvocable ? '允许' : '禁止'} · 用户${skill.invocation.userInvocable ? '允许' : '禁止'}；仍需技能启用且依赖就绪。`, 'control-hint'))
      if (skill.extraFields.length) card.append(node('p', `其他元信息仅保留，不执行：${skill.extraFields.join('、')}`, 'control-hint'))
      const actions = node('div', undefined, 'run-actions')
      const button = (label, action, handler) => {
        const element = node('button', label, 'plain-button')
        element.type = 'button'
        element.dataset.action = `${skill.id}:${action}`
        element.addEventListener('click', () => { void Promise.resolve().then(handler).catch(error => notice(error.message, true)) })
        actions.append(element)
      }
      if (skill.managed !== false) button(skill.enabled ? '停用' : '启用', 'toggle', () => change('toggle', { id: skill.id, enabled: !skill.enabled }))
      button(skill.editable ? '编辑' : '查看', 'edit', () => open(skill.id))
      button('复制为新技能', 'copy', () => open(skill.id, true))
      button('导出', 'export', async () => download((await api('/api/skills/detail?id=' + encodeURIComponent(skill.id))).markdown))
      if (skill.editable) button('删除', 'delete', () => change('delete', { id: skill.id }))
      card.append(actions)
      list.append(card)
    }
    if (!list.children.length) list.append(node('p', query ? '没有匹配的技能。' : '暂无技能，可以导入 SKILL.md 或填入示例。', 'control-hint'))
    $('skills-state').textContent = `${state.skills.filter(skill => skill.enabled).length} 个技能已启用 · ${state.runtimeReady ? '官方 skill 工具已就绪' : '等待官方 Skill 插件及其依赖'}`
    $('skills-storage').textContent = `网页技能及目录技能启停状态保存位置：${state.configPath}。启停不改动目录源文件；导入 / 导出仅包含单个 SKILL.md，每个文件最多 ${state.maxBytes} 字节。`
    if (state.notice) notice(state.notice, true)
    // 目录源文件只读，但列表启停按钮独立可用；勾选状态跟随真实快照。
    if (readOnly) $('skills-enabled').checked = state.skills.find(skill => skill.id === editing)?.enabled ?? false
    lock()
    if (focusId) [...list.querySelectorAll('[data-action]')].find(element => element.dataset.action === focusId)?.focus({ preventScroll: true })
  }

  async function refresh() {
    if (reading || busy) return
    reading = true
    try { state = await api('/api/skills'); render() }
    catch (error) { notice(error.message, true) }
    finally { reading = false }
  }

  function reset() {
    loadingEditor++
    editing = null
    readOnly = false
    $('skills-form').reset()
    $('skills-form-title').textContent = '新建技能'
    $('skills-preview-section').hidden = true
    lock()
  }

  function unique(base) {
    const names = new Set(state?.skills.map(skill => skill.name) ?? [])
    let name = base, index = 2
    while (names.has(name)) name = base + '-' + index++
    return name
  }

  function preview(parsed) {
    $('skills-preview-meta').textContent = `${parsed.name}：${parsed.description}${parsed.extraFields.length ? `（其他元信息仅保留：${parsed.extraFields.join('、')}）` : ''}`
    window.dshMarkdown.render($('skills-preview'), parsed.body)
    $('skills-preview-section').hidden = false
  }

  async function open(id, copy = false) {
    const request = ++loadingEditor
    const skill = await api('/api/skills/detail?id=' + encodeURIComponent(id))
    // 快速切换技能或开始新建时，旧响应不能覆盖新草稿。
    if (request !== loadingEditor) return
    editing = copy ? null : skill.id
    readOnly = !copy && !skill.editable
    const copiedName = copy ? unique(skill.name.slice(0, 52) + '-copy') : skill.name
    $('skills-markdown').value = copy ? template(copiedName, skill.description, skill.body) : skill.markdown
    $('skills-enabled').checked = !copy && skill.enabled
    $('skills-form-title').textContent = copy ? '复制为新技能' : readOnly ? `查看技能：${skill.name}` : `编辑技能：${skill.name}`
    preview(copy ? { ...skill, name: copiedName } : skill)
    lock()
    $('skills-form').scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  async function change(action, body) {
    if (busy || state?.changing) return
    busy = true
    notice('正在更新技能…')
    lock()
    try {
      state = await api('/api/skills/' + action, body)
      notice('技能已更新；后续对话将使用新的启用状态。')
      if (action === 'save' || (action === 'delete' && editing === body.id)) reset()
    } catch (error) { notice(error.message, true) }
    finally {
      busy = false
      render()
      window.dispatchEvent(new Event('dsh:skills-change'))
      await refresh()
    }
  }

  function download(markdown) {
    const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }))
    const link = node('a')
    link.href = url
    link.download = 'SKILL.md'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  $('skills-form').addEventListener('submit', event => {
    event.preventDefault()
    if (readOnly) return
    void change('save', { ...(editing ? { id: editing } : {}), markdown: $('skills-markdown').value, enabled: $('skills-enabled').checked })
  })
  $('skills-preview-button').addEventListener('click', () => {
    const draft = $('skills-markdown').value
    // 旧预览响应不能覆盖用户已经继续修改的草稿。
    void api('/api/skills/preview', { markdown: draft }).then(parsed => { if ($('skills-markdown').value === draft) preview(parsed) }).catch(error => notice(error.message, true))
  })
  $('skills-export-editor').addEventListener('click', () => download($('skills-markdown').value))
  $('skills-new').addEventListener('click', reset)
  $('skills-example').addEventListener('click', () => {
    reset()
    $('skills-markdown').value = template(unique('my-skill'), '当用户需要按统一步骤解释仿真结果时使用。', '# 仿真结果解读\n\n1. 先说明任务状态，再解释工具实际返回的指标。\n2. 区分演示配额与物理资源，不编造未返回的数据。\n3. 回答采用中文 Markdown，结果和自己的解释分开。')
  })
  $('skills-import').addEventListener('click', () => { $('skills-file').click() })
  $('skills-file').addEventListener('change', async () => {
    const file = $('skills-file').files[0]
    if (!file) return
    if (file.size > (state?.maxBytes ?? 48000)) { notice('文件过大，请精简 SKILL.md 后再导入。', true); return }
    const request = ++loadingEditor
    try {
      const text = await file.text()
      if (request !== loadingEditor) return
      reset()
      $('skills-markdown').value = text
      notice('文件已载入草稿，预览并保存后才会生效。')
    } catch { notice('无法读取这个文件，请重新选择 UTF-8 编码的 SKILL.md。', true) }
  })
  // 用户开始输入后，未完成的详情读取和文件导入就不再有权覆盖草稿。
  $('skills-markdown').addEventListener('input', () => { loadingEditor++; $('skills-preview-section').hidden = true })
  $('skills-search').addEventListener('input', render)
  $('skills-refresh').addEventListener('click', refresh)
  $('tab-skills').addEventListener('click', () => { void refresh() })
  setInterval(() => { if (!document.hidden && !$('panel-skills').hidden) void refresh() }, 3000)
  void refresh()
})()
