/** 助手正文的 Markdown 渲染：解析器来自本项目安装的 markdown-it 浏览器构建。 */
// 用立即执行函数隔离局部变量，只向聊天入口暴露 render 方法。
window.dshMarkdown = (() => {
  // 只启用 Markdown 语法；html:false 把模型返回的 HTML 标签作为普通文字转义。
  const parser = window.markdownit({ html: false, breaks: true, linkify: true })
  // 保留解析器原有的链接输出规则，继续使用其属性转义和危险 URL 校验。
  const linkOpen = parser.renderer.rules.link_open
    || ((tokens, index, options, env, renderer) => renderer.renderToken(tokens, index, options))
  // Markdown 链接在新页打开，避免离开当前聊天时中断生成。
  parser.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
    // 工作目录产物使用真实下载接口；普通外部链接仍由解析器原有规则处理。
    const href = tokens[index].attrGet('href')
    if (href) tokens[index].attrSet('href', window.dshFiles?.downloadHref(href) ?? href)
    // attrSet 修改结构化属性，不直接把模型文本拼接成 HTML 属性。
    tokens[index].attrSet('target', '_blank')
    // 阻止新页面访问 opener，并避免向外站发送本地聊天页的来源信息。
    tokens[index].attrSet('rel', 'noopener noreferrer')
    // 返回经过解析器转义后的链接起始标签。
    return linkOpen(tokens, index, options, env, renderer)
  }
  // 表格外加滚动容器，列数过多时只在表格内部横向滚动。
  parser.renderer.rules.table_open = () => '<div class="markdown-table" tabindex="0" role="region" aria-label="表格，可横向滚动"><table>\n'
  // 和上方 table_open 成对闭合，避免后续段落被放进表格容器。
  parser.renderer.rules.table_close = () => '</table></div>\n'
  // 页面 CSP 禁止内联样式，把表格对齐规则转换成预定义 CSS 类。
  for (const type of ['th_open', 'td_open']) parser.renderer.rules[type] = (tokens, index, options, env, renderer) => {
    // 这里只识别解析器生成的三种对齐值，不接收任意模型样式。
    const alignment = /^text-align:(left|center|right)$/.exec(tokens[index].attrGet('style') || '')
    // 没有对齐标记的单元格继续使用默认样式。
    if (alignment) {
      // 去掉内联 style，避免触发内容安全策略并丢失表格对齐。
      tokens[index].attrs = tokens[index].attrs.filter(([name]) => name !== 'style')
      // 使用固定前缀和白名单值构造样式类。
      tokens[index].attrJoin('class', `markdown-align-${alignment[1]}`)
    }
    // 仍让解析器负责生成和转义标签属性。
    return renderer.renderToken(tokens, index, options)
  }
  // 只暴露渲染操作，调用方不需要也不能通过此接口修改解析器配置。
  return {
    // source 始终是累计的原始文本；不从上一次生成的 HTML 反推 Markdown。
    render(element, source) {
      // 用专用类覆盖纯文本的 pre-wrap，块级间距改由 Markdown 样式控制。
      element.classList.add('markdown-body')
      // 仅插入解析器生成的 HTML；不要在这里直接插入未经解析的模型文本。
      // 原始 HTML 已关闭，javascript/vbscript 等危险链接由解析器默认规则拒绝。
      element.innerHTML = parser.render(source)
    },
  }
})()
