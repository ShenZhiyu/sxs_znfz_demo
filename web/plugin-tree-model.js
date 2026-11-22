/** 把依赖图投影为可折叠森林；共享依赖用引用节点表示，避免复制插件开关。 */
;(() => {
  const synthetic = (id, key, description, phase = 'active') => ({ id, key, description, phase, enabled: true,
    module: '', container: false, switchable: false, persisted: false, reason: '运行时或子作用域节点仅供查看。' })

  function build(state, mode) {
    if (mode === 'configuration') {
      // 配置归属仍可查看；这里才使用 parentId，与服务依赖布局分开。
      const nodes = new Map(state.entries.map(entry => [entry.id, { treeKey: 'configuration:' + entry.id, entry, children: [] }]))
      const roots = []
      for (const item of nodes.values()) {
        const parent = nodes.get(item.entry.parentId)
        if (parent) parent.children.push(item)
        else roots.push(item)
      }
      return roots
    }

    const graph = state.dependencies
    const entries = new Map(state.entries.map(entry => [entry.id, entry]))
    const nodes = new Map(graph.nodes.map(item => [item.id, item]))
    const expanded = new Set(), roots = []
    const targetOf = edge => edge.providerId || edge.lastProviderId
    const used = new Set(graph.edges.map(targetOf).filter(Boolean))
    const edgesByConsumer = new Map()
    for (const edge of graph.edges) {
      if (!edgesByConsumer.has(edge.consumerId)) edgesByConsumer.set(edge.consumerId, [])
      edgesByConsumer.get(edge.consumerId).push(edge)
    }

    // 一位提供者可能贡献多个服务；合并为一个树分支，保留每条服务的实际状态。
    function children(edges, path, parentKey) {
      const groups = new Map()
      for (const edge of edges) {
        const target = targetOf(edge), key = target || 'missing:' + edge.service
        if (!groups.has(key)) groups.set(key, { target, edges: [] })
        groups.get(key).edges.push(edge)
      }
      return [...groups].map(([key, group]) => {
        const relation = group.edges.map(edge => `${edge.service}${!edge.providerId && edge.lastProviderId ? '（缺失，上次提供者）' : edge.status === 'missing' ? '（缺失）' : edge.status === 'unavailable' ? '（未就绪）' : ''}`).join('、')
        if (!group.target) return { treeKey: parentKey + '/' + key, missing: true, relation, children: [] }
        return expand(group.target, path, parentKey + '/' + key, relation)
      })
    }

    function expand(id, path, key, relation = '') {
      const item = nodes.get(id)
      const entry = entries.get(item.entryId) || synthetic(id, item.name, '启动器/代码创建的运行时节点', item.phase)
      const model = { treeKey: key, dependencyNodeId: id, entry, relation, children: [], unknown: !item.declarationsKnown }
      // 先判断当前路径，区分真正的环与已在其他分支出现过的共享依赖。
      if (path.has(id) || expanded.has(id)) return { ...model, reference: path.has(id) ? '循环/内部引用' : '共享依赖引用' }
      expanded.add(id)
      const nextPath = new Set(path).add(id), edges = edgesByConsumer.get(id) || []
      model.children.push(...children(edges.filter(edge => edge.origin !== 'dynamic'), nextPath, key))
      // 子作用域的必需依赖不能冒充主插件的必需依赖，按实际作用域单独展开。
      const scopes = new Map()
      for (const edge of edges.filter(edge => edge.origin === 'dynamic')) {
        if (!scopes.has(edge.scope)) scopes.set(edge.scope, [])
        scopes.get(edge.scope).push(edge)
      }
      for (const [scope, scopedEdges] of scopes) {
        const scopeKey = key + '/scope:' + scope
        model.children.push({ treeKey: scopeKey, dependencyNodeId: id, scope: true,
          entry: synthetic(scopeKey, scope, '只影响本子作用域，状态与主插件分别显示。', scopedEdges[0].scopePhase),
          children: children(scopedEdges, nextPath, scopeKey) })
      }
      return model
    }

    // 顶层优先展示未被其他节点依赖的功能插件，向下展开它所依赖的服务提供者。
    for (const item of graph.nodes) if (!used.has(item.id)) roots.push(expand(item.id, new Set(), 'dependencies:' + item.id))
    // 纯环或仅有内部引用的组件也必须有入口，不能从树中消失。
    for (const item of graph.nodes) if (!expanded.has(item.id)) roots.push(expand(item.id, new Set(), 'dependencies:' + item.id))
    return roots
  }
  window.dshPluginTree = { build }
})()
