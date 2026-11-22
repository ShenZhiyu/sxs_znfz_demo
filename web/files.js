/** 对话附件队列与工作文件下载；浏览器只提交服务器签收的上传 ID。 */
window.dshFiles = (() => {
  const $ = id => document.getElementById(id)
  let state = null, queue = [], busy = false, reading = null
  const node = (tag, text, className) => {
    const element = document.createElement(tag)
    if (text !== undefined) element.textContent = text
    if (className) element.className = className
    return element
  }
  const size = bytes => bytes < 1024 ? `${bytes} B` : bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / 1024 ** 2).toFixed(1)} MiB`
  const changed = () => window.dispatchEvent(new Event('dsh:files-change'))
  const problem = text => { $('files-upload-notice').textContent = text }

  function link(file) {
    const anchor = node('a', `${file.name} · ${size(file.bytes)}`, 'file-download')
    anchor.href = file.downloadUrl
    anchor.download = file.name
    return anchor
  }

  function renderQueue() {
    const list = $('chat-attachments')
    list.hidden = !queue.length
    list.replaceChildren(...queue.map(item => {
      const row = node('div', undefined, 'attachment-chip')
      if (item.receipt) row.append(link(item.receipt))
      else row.append(node('span', `${item.name} · ${size(item.bytes)}`))
      row.append(node('span', item.status === 'ready' ? '待发送' : item.status === 'uploading' ? '正在上传…' : item.error, item.status === 'error' ? 'file-error' : 'file-state'))
      if (item.status === 'error') {
        const retry = node('button', '重试', 'plain-button')
        retry.type = 'button'; retry.disabled = busy
        retry.addEventListener('click', () => { void upload(item) })
        row.append(retry)
      }
      const remove = node('button', '移除', 'plain-button')
      remove.type = 'button'; remove.disabled = busy
      remove.setAttribute('aria-label', `从本条消息移除 ${item.name}`)
      remove.addEventListener('click', () => {
        item.controller?.abort()
        queue = queue.filter(value => value !== item)
        renderQueue(); changed()
      })
      row.append(remove)
      return row
    }))
    $('chat-upload').disabled = busy
  }

  async function upload(item) {
    if (!queue.includes(item) || busy) return
    item.status = 'uploading'; item.error = ''; item.controller = new AbortController()
    renderQueue(); changed()
    try {
      const response = await fetch('/api/files/upload', { method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(item.name) },
        body: item.file, signal: item.controller.signal })
      const receipt = await response.json()
      if (!response.ok) throw new Error(receipt.error || '上传失败')
      if (!queue.includes(item)) return
      item.receipt = receipt; item.status = 'ready'
      void refresh()
    } catch (error) {
      if (!queue.includes(item)) return
      item.status = 'error'; item.error = error.message || '上传失败'
    } finally { renderQueue(); changed() }
  }

  function add(files) {
    if (busy) return
    problem('')
    for (const file of files) {
      if (queue.length >= (state?.maxAttachments ?? 10)) { problem('每条消息最多添加 10 个附件。'); break }
      if (file.size > (state?.maxFileBytes ?? 20 * 1024 ** 2)) { problem(`${file.name} 超过单文件 20 MiB 上限。`); continue }
      if (queue.reduce((sum, item) => sum + item.bytes, 0) + file.size > (state?.maxMessageBytes ?? 100 * 1024 ** 2)) {
        problem('本条消息附件合计不能超过 100 MiB。'); continue
      }
      const item = { file, name: file.name, bytes: file.size, status: 'uploading', receipt: null }
      queue.push(item)
      void upload(item)
    }
    renderQueue(); changed()
  }

  function renderFiles() {
    if (!state) return
    $('files-root').textContent = `工作目录：${state.root}。单文件最多 20 MiB，每条消息最多 10 个附件、合计 100 MiB。`
    const query = $('files-search').value.trim().toLowerCase()
    const uploads = new Map(state.uploads.map(file => [file.path, file]))
    const list = $('files-list')
    list.replaceChildren()
    for (const file of state.files.filter(file => file.path.toLowerCase().includes(query))) {
      const row = node('article', undefined, 'work-file')
      row.append(link(file), node('code', file.path), node('span', uploads.has(file.path) ? '已上传的原始文件' : '工作文件 / 生成产物', 'control-hint'))
      if (uploads.has(file.path)) {
        const attach = node('button', '添加为附件', 'plain-button')
        attach.type = 'button'; attach.disabled = busy
        attach.addEventListener('click', () => {
          const receipt = uploads.get(file.path)
          if (queue.some(item => item.receipt?.id === receipt.id)) { problem('该文件已经在当前附件队列中。'); return }
          if (queue.length >= 10 || queue.reduce((sum, item) => sum + item.bytes, 0) + receipt.bytes > 100 * 1024 ** 2) {
            problem('当前附件数量或总大小已达上限。'); return
          }
          queue.push({ name: receipt.name, bytes: receipt.bytes, receipt, status: 'ready' })
          renderQueue(); changed(); $('message').focus()
        })
        row.append(attach)
      }
      list.append(row)
    }
    if (!list.children.length) list.append(node('p', query ? '没有匹配文件。' : '暂无工作文件。上传资料或让 Agent 将产物保存到工作目录后，可以在这里下载。', 'control-hint'))
    $('files-state').textContent = `${state.files.length} 个文件${state.truncated ? '（目录较大，仅列出部分文件；已知路径的下载链接仍可使用）' : ''}`
  }

  async function refresh() {
    if (reading) return reading
    reading = (async () => {
      try {
        const response = await fetch('/api/files', { cache: 'no-store', signal: AbortSignal.timeout(15000) })
        const value = await response.json()
        if (!response.ok) throw new Error(value.error || '无法读取文件列表')
        state = value; renderFiles()
      } catch (error) { $('files-state').textContent = error.message }
      finally { reading = null }
    })()
    return reading
  }

  $('chat-upload').addEventListener('click', () => $('chat-file-input').click())
  $('chat-file-input').addEventListener('change', () => { add($('chat-file-input').files); $('chat-file-input').value = '' })
  $('files-refresh').addEventListener('click', () => { void refresh() })
  $('files-search').addEventListener('input', renderFiles)
  $('tab-files').addEventListener('click', () => { void refresh() })
  const dropzone = document.querySelector('.composer-wrap')
  dropzone.addEventListener('dragover', event => { event.preventDefault(); if (!busy) dropzone.classList.add('file-dragover') })
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('file-dragover'))
  dropzone.addEventListener('drop', event => { event.preventDefault(); dropzone.classList.remove('file-dragover'); add(event.dataTransfer.files) })
  window.addEventListener('dsh:files-refresh', () => { void refresh() })
  setInterval(() => { if (!document.hidden && !$('panel-files').hidden) void refresh() }, 5000)
  void refresh()
  return {
    link, refresh,
    hasFiles: () => queue.some(item => item.status === 'ready'),
    blocked: () => queue.some(item => item.status !== 'ready'),
    take() { const sent = queue.map(item => item.receipt); queue = []; renderQueue(); return sent },
    restore(files) { for (const receipt of files) if (!queue.some(item => item.receipt?.id === receipt.id)) queue.push({ name: receipt.name, bytes: receipt.bytes, receipt, status: 'ready' }); renderQueue(); changed() },
    clear() { for (const item of queue) item.controller?.abort(); queue = []; problem(''); renderQueue(); changed() },
    setBusy(value) { if (busy === value) return; busy = value; renderQueue(); renderFiles() },
    downloadHref(href) {
      // markdown-it 会规范化中文和空格为百分号编码；先还原再编码 query，避免二次编码。
      let source
      try { source = decodeURIComponent(href) } catch { return href }
      let path
      if (source.startsWith('work/')) path = source.slice(5)
      else if (source.startsWith('./work/')) path = source.slice(7)
      else if (state?.root && source.startsWith(state.root + '/')) path = source.slice(state.root.length + 1)
      return path ? '/api/files/download?path=' + encodeURIComponent(path) : href
    },
  }
})()
