/** 仿真监控：状态来自 MCP，不在浏览器执行仿真或维护资源余额。 */
(() => {
  const $ = id => document.getElementById(id)
  const terminal = new Set(['completed', 'failed', 'cancelled'])
  const labels = { queued: '已提交', pending: '等待依赖/资源', running: '运行中', completed: '完成', failed: '失败', cancelled: '已取消', cancelling: '正在取消', skipped: '上游失败，跳过' }
  let selected = '', newest = '', loading = false, cancelling = false, snapshot
  // 同源 API 在服务端经过已有的 Host、Origin、方法和生命周期校验。
  async function api(path, options) {
    const response = await fetch(path, { signal: AbortSignal.timeout(12000), ...options })
    const value = await response.json()
    if (!response.ok) throw new Error(value.error ?? `请求失败 ${response.status}`)
    return value
  }
  function render(job) {
    snapshot = job
    $('simulation-status').textContent = `${job.id} · ${labels[job.status] ?? job.status} · ${job.progress}% · ${job.scale} · 租约 ${job.lease.state}${job.error ? ' · ' + job.error : ''}`
    $('simulation-progress').value = job.progress
    $('simulation-cancel').disabled = cancelling || terminal.has(job.status)
    $('simulation-download').disabled = false
    const nodes = $('simulation-nodes')
    nodes.replaceChildren()
    // 父模块来自模板 groups；执行顺序取决于每个节点的 dependsOn 和 serialGroup。
    for (const group of job.groups) {
      const section = document.createElement('section'), title = document.createElement('h4')
      section.className = 'simulation-group'
      title.textContent = group.title
      section.append(title)
      for (const node of job.nodes.filter(node => node.group === group.id)) {
        const row = document.createElement('div'), name = document.createElement('strong'), description = document.createElement('small')
        row.className = 'simulation-node'
        row.dataset.nodeId = node.id
        row.dataset.state = node.status
        name.textContent = `${node.title} · ${labels[node.status] ?? node.status} · ${node.progress}%`
        description.textContent = `${node.resources.cpu} CPU / ${node.resources.memoryGb} GB；前置：${node.dependsOn.length ? node.dependsOn.join('、') : '无'}${node.serialGroup ? '；串行锁：' + node.serialGroup : ''}${node.error ? '；' + node.error : ''}`
        row.append(name, description)
        section.append(row)
      }
      nodes.append(section)
    }
    $('simulation-result').textContent = job.results.report ? JSON.stringify(job.results.report, null, 2) : terminal.has(job.status) ? (job.error ?? labels[job.status]) : '等待报告节点完成；已完成的中间结果保存在任务 JSON。'
    // 保留所有事件；不按长度截断，下载同样使用完整快照。
    $('simulation-events').textContent = job.events.map(event => `${event.seq} ${new Date(event.time).toLocaleTimeString()} ${event.type} ${JSON.stringify(event.data)}`).join('\n')
  }
  async function refresh() {
    if (loading || $('panel-simulation').hidden) return
    loading = true
    try {
      const [resources, list] = await Promise.all([api('/api/simulation-resources'), api('/api/simulations')])
      $('simulation-resources').textContent = `本机演示集群 · 可用 CPU ${resources.available.cpu}/${resources.capacity.cpu} · 内存 ${resources.available.memoryGb}/${resources.capacity.memoryGb} GB。配额账本不代表物理隔离。`
      if (list.jobs[0] && list.jobs[0].id !== newest) { newest = list.jobs[0].id; selected = newest }
      const select = $('simulation-select'), options = [...select.options].map(option => option.value)
      const ids = list.jobs.length ? list.jobs.map(job => job.id) : ['']
      if (JSON.stringify(options) !== JSON.stringify(ids)) select.replaceChildren(...ids.map(id => {
        const option = document.createElement('option'), job = list.jobs.find(job => job.id === id)
        option.value = id; option.textContent = job ? `${job.scale} · ${id}` : '暂无仿真任务'
        return option
      }))
      select.value = selected
      if (selected) {
        const id = selected, job = await api('/api/simulations/' + encodeURIComponent(id))
        if (selected === id) render(job)
      }
      $('simulation-notice').textContent = ''
    } catch (error) { $('simulation-notice').textContent = error.message }
    finally { loading = false }
  }
  $('simulation-select').addEventListener('change', () => { selected = $('simulation-select').value; void refresh() })
  // 标签展示由 debugger.js 统一管理，微任务等待它切换 hidden 后立即拉取状态。
  $('tab-simulation').addEventListener('click', () => { queueMicrotask(() => { void refresh() }) })
  $('simulation-cancel').addEventListener('click', async () => {
    if (!selected || cancelling) return
    cancelling = true; $('simulation-cancel').disabled = true
    try {
      const job = await api(`/api/simulation-cancel/${encodeURIComponent(selected)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      if (job.id === selected) render(job)
    } catch (error) { $('simulation-notice').textContent = error.message }
    finally { cancelling = false; void refresh() }
  })
  $('simulation-download').addEventListener('click', () => {
    if (!snapshot) return
    const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url; link.download = `simulation-${snapshot.id}.json`; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  })
  // 面板可见时每秒通过 MCP 查询，不为后台任务创建第二个调度器。
  setInterval(() => { void refresh() }, 1000)
})()
