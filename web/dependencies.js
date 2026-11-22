/** 交互式服务依赖视图：点击关系卡片继续追踪，数据全部来自运行时快照。 */
;(() => {
  const $ = id => document.getElementById(id)
  const phases = { active: '运行中', pending: '等待依赖', stopped: '已停止', loading: '加载中', unloading: '卸载中', disposed: '已释放', failed: '加载失败' }
  const statuses = { provided: '服务已提供', unavailable: '提供者未就绪', missing: '服务缺失' }
  const origins = { plugin: '主插件 inject', dynamic: '子作用域 inject', declaration: '已知声明（未运行）' }
  let graph = null, selected = '', signature = '', optionSignature = ''
  const node = (tag, text, className) => {
    const element = document.createElement(tag)
    if (text !== undefined) element.textContent = text
    if (className) element.className = className
    return element
  }
  const name = item => item.entryId || item.name

  function view(dependencies) {
    $('plugin-tree-view').hidden = dependencies
    $('plugin-dependencies-view').hidden = !dependencies
    $('show-plugin-tree').setAttribute('aria-pressed', String(!dependencies))
    $('show-plugin-dependencies').setAttribute('aria-pressed', String(dependencies))
  }

  function select(id) {
    selected = id
    $('dependency-plugin').value = selected
    signature = ''
    render()
  }

  // 缺失服务仍可导航到上次观察到的配置条目，但会明确标出实现已不存在。
  function link(item) {
    const button = node('button', name(item), 'dependency-link')
    button.type = 'button'
    button.dataset.dependencyTarget = item.id
    button.addEventListener('click', () => select(item.id))
    return button
  }

  function render() {
    if (!graph) return
    const current = graph.nodes.find(item => item.id === selected)
    if (!current) return
    // 相同快照不重建卡片，保留焦点、文字选择和间接依赖展开状态。
    const next = JSON.stringify([selected, graph])
    if (signature === next) return
    signature = next
    const focus = document.activeElement?.dataset.dependencyTarget
    const nodes = new Map(graph.nodes.map(item => [item.id, item]))
    const outgoing = graph.edges.filter(edge => edge.consumerId === selected)
    const incoming = graph.edges.filter(edge => edge.providerId === selected || (!edge.providerId && edge.lastProviderId === selected))
    const main = outgoing.filter(edge => edge.origin !== 'dynamic'), dynamic = outgoing.filter(edge => edge.origin === 'dynamic')
    $('dependency-summary').textContent = `${name(current)} · ${phases[current.phase] || current.phase}。主插件需求 ${main.length} 条（未提供/未就绪 ${main.filter(edge => edge.status !== 'provided').length} 条）；子作用域需求 ${dynamic.length} 条（未提供/未就绪 ${dynamic.filter(edge => edge.status !== 'provided').length} 条）。箭头：依赖方 → 提供方。`
    $('dependency-coverage').textContent = graph.coverage

    const center = $('dependency-current')
    center.replaceChildren(node('strong', name(current)), node('p', current.kind === 'entry' ? 'Loader 配置插件' : '启动器/代码创建的运行时节点', 'control-hint'))
    if (current.module) center.append(node('code', current.module))
    center.append(node('p', `当前提供：${current.provides.join('、') || '未观察到服务注册'}`, 'control-hint'))
    if (current.previouslyProvided.length) center.append(node('p', `曾提供，当前未注册：${current.previouslyProvided.join('、')}`, 'dependency-warning'))
    if (!current.declarationsKnown) center.append(node('p', '尚未加载，依赖声明未知。不会为了查看依赖而启动插件。', 'dependency-warning'))

    function cards(container, edges, direction) {
      const groups = new Map()
      for (const edge of edges) {
        const target = direction === 'out' ? edge.providerId || edge.lastProviderId : edge.consumerId
        const key = target || 'missing:' + edge.service
        if (!groups.has(key)) groups.set(key, { target: nodes.get(target), edges: [] })
        groups.get(key).edges.push(edge)
      }
      const children = []
      for (const group of groups.values()) {
        const card = node('article', undefined, 'dependency-card')
        if (group.target) card.append(link(group.target))
        else card.append(node('strong', '未找到提供者'))
        for (const edge of group.edges) {
          const row = node('div', undefined, 'dependency-service')
          row.dataset.dependencyService = edge.service
          row.dataset.dependencyStatus = edge.status
          row.append(node('code', edge.service), node('span', statuses[edge.status] + (edge.bound ? ' · 已绑定' : ''), edge.status === 'provided' ? 'dependency-ok' : 'dependency-warning'))
          row.append(node('small', `${origins[edge.origin]} · ${edge.scope} · ${phases[edge.scopePhase] || edge.scopePhase}`))
          if (!edge.providerId && edge.lastProviderId) row.append(node('small', '上次由此插件提供；当前没有注册实现。'))
          card.append(row)
        }
        children.push(card)
      }
      container.replaceChildren(...(children.length ? children : [node('p', direction === 'out'
        ? current.declarationsKnown ? '没有观察到 inject 服务需求。' : '依赖声明未知。'
        : '没有观察到其他作用域通过 inject 依赖它。', 'control-hint')]))
    }
    cards($('dependency-providers'), outgoing, 'out')
    cards($('dependency-consumers'), incoming, 'in')

    // 广度优先遍历真实边；相同节点只展开一次，互相依赖也不会造成死循环。
    const seen = new Set([selected]), queue = [{ id: selected, depth: 0 }], relations = []
    for (let index = 0; index < queue.length; index++) {
      const { id, depth } = queue[index]
      for (const edge of graph.edges.filter(edge => edge.consumerId === id)) {
        const row = node('div', undefined, 'dependency-path')
        const target = nodes.get(edge.providerId || edge.lastProviderId)
        row.append(node('span', `第 ${depth + 1} 层 · ${name(nodes.get(id))} → `), node('code', edge.service), node('span', ' → '))
        row.append(target ? link(target) : node('span', '未找到提供者'))
        row.append(node('small', `${statuses[edge.status]} · ${origins[edge.origin]} · ${edge.scope}`, edge.status === 'provided' ? 'dependency-ok' : 'dependency-warning'))
        relations.push(row)
        // 历史提供者仅为导航线索，不冒充当前依赖继续向下遍历。
        if (edge.providerId && !seen.has(edge.providerId)) { seen.add(edge.providerId); queue.push({ id: edge.providerId, depth: depth + 1 }) }
      }
    }
    $('dependency-transitive-list').replaceChildren(...(relations.length ? relations : [node('p', '没有可继续追踪的已知依赖。', 'control-hint')]))
    if (focus) [...$('plugin-dependencies-view').querySelectorAll('[data-dependency-target]')].find(element => element.dataset.dependencyTarget === focus)?.focus({ preventScroll: true })
  }

  $('dependency-plugin').addEventListener('change', event => select(event.target.value))
  $('show-plugin-tree').addEventListener('click', () => view(false))
  $('show-plugin-dependencies').addEventListener('click', () => { view(true); render() })
  window.dshDependencies = {
    selectNode(id) { view(true); select(id) },
    selectEntry(entryId) { view(true); select('entry:' + entryId) },
    update(value) {
      graph = value
      const options = JSON.stringify(graph.nodes.map(item => [item.id, name(item), item.kind]))
      if (optionSignature !== options) {
        optionSignature = options
        $('dependency-plugin').replaceChildren(...graph.nodes.map(item => {
          const option = node('option', `${name(item)}${item.kind === 'runtime' ? '（运行时）' : ''}`)
          option.value = item.id
          return option
        }))
      }
      if (!graph.nodes.some(item => item.id === selected)) selected = graph.nodes.find(item => item.name === 'tool-skill')?.id || graph.nodes[0]?.id || ''
      $('dependency-plugin').value = selected
      render()
    },
  }
})()
