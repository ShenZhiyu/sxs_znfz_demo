/** 浏览器入口：保存本页的会话 ID，通过 fetch 读取 SSE 文本流。 */
// 通过 CSS ID 选择器找到表单；后面统一监听 submit，使按钮点击和键盘发送走同一条逻辑。
const form = document.querySelector('#chat-form')
// 取得 textarea 节点；它的 value 是输入内容，textContent 不是读取表单值的正确方式。
const message = document.querySelector('#message')
// 取得发送按钮，用于随空输入或生成状态切换 disabled 和无障碍名称。
const send = document.querySelector('#send')
// 取得消息列表容器；每次新消息会创建节点并追加到这里。
const messages = document.querySelector('#messages')
// 消息区域拥有自己的滚动条，页头、输入框和右侧检查器不跟随它移动。
const chatViewport = document.querySelector('.main')
// 取得初始欢迎区；第一条消息出现时隐藏，新对话时重新显示。
const welcome = document.querySelector('#welcome')
// 取得错误提示区域；它带 role=status，辅助技术可感知状态文字变化。
const notice = document.querySelector('#notice')
// 取得顶部模式文字节点，稍后从 /api/config 填入离线或真实模型信息。
const mode = document.querySelector('#mode')
// 本页尚未创建服务端会话；第一次发送时才懒创建，并在后续轮次复用其 ID。
let sessionId = null
let openingSessionId = null
// 历史可先只读；首次继续发送时才恢复真实 Agent。
let sessionAttached = false
let navigating = false
// 记录本页是否正在发送或接收回复；它防止同一个页面重复提交，但服务端仍须独立检查并发。
let busy = false
// 插件调试面板报告当前模型依赖是否可用；不能只根据网页是否在线判断。
let available = true
// 保存本轮 fetch 的取消控制器；新对话或离开页面时可中止网络读取。
let controller = null
// 给对话状态编号；新对话时递增，使旧异步请求即使晚返回也不能修改新页面状态。
let revision = 0
// 一次用户提交算一轮；新对话归零，工具调用和模型再次请求不会增加此编号。
let turnNumber = 0
// 在更新 DOM 之前记住是否跟随底部，避免一次较大的回复增量把用户误判为向上翻阅。
let followReply = true
chatViewport.addEventListener('scroll', () => {
  followReply = chatViewport.scrollHeight - chatViewport.scrollTop - chatViewport.clientHeight < 220
}, { passive: true })

// 统一更新发送按钮和输入框高度，避免多个事件处理器各自维护不同的 UI 规则。
function updateComposer() {
  // 正在请求或输入仅含空白时禁用发送；|| 表示任一条件成立就禁用。
  send.disabled = busy || navigating || !available || !!window.dshFiles?.blocked() || (!message.value.trim() && !window.dshFiles?.hasFiles())
  window.dshFiles?.setBusy(busy)
  // 为只有箭头的按钮设置可读名称，并根据状态调整，便于屏幕阅读器使用。
  send.setAttribute('aria-label', busy ? '正在回复' : '发送消息')
  // 先让输入框恢复自然高度，才能在用户删字时缩回去；只不断增高会导致无法收缩。
  message.style.height = 'auto'
  // 按实际内容高度调整，最多 160px；模板字符串补上 CSS 所需的 px 单位。
  message.style.height = `${Math.min(message.scrollHeight, 160)}px`
  // 程序清空或恢复输入也要同步候选列表；设置 value 不会自动触发 input。
  window.dshCompletion?.sync()
// 闭合当前花括号结构；与上方对应的 { 配对，结束该函数、条件块或类型声明。
}

// 定义流式更新时的温和滚动策略；用户主动向上阅读历史时不应被强制拖回底部。
function scrollToReply(force = false) {
  // 发送新问题时主动显示最新轮次；生成中向上查看历史时保留用户的阅读位置。
  if (force || followReply) {
    chatViewport.scrollTop = chatViewport.scrollHeight
    followReply = true
  // 闭合当前花括号结构；与上方对应的 { 配对，结束该函数、条件块或类型声明。
  }
// 闭合当前花括号结构；与上方对应的 { 配对，结束该函数、条件块或类型声明。
}

// 为 fetch 添加 HTTP 状态检查；fetch 遇到 400/500 通常仍会成功返回 Response，不会自动抛错。
async function checked(response) {
  // ok 仅在 2xx 状态时为 true；非成功响应进入错误解析分支。
  if (!response.ok) {
    // 尝试读取服务端 JSON 错误；若正文并非 JSON，则用空对象兜底，避免掩盖 HTTP 错误。
    const body = await response.json().catch(() => ({}))
    // 优先采用服务端可读错误，否则展示状态码；throw 让调用者统一进入 catch 更新 UI。
    const error = new Error(body.error || `请求失败（${response.status}）`)
    error.status = response.status
    throw error
  // 闭合当前花括号结构；与上方对应的 { 配对，结束该函数、条件块或类型声明。
  }
  // 校验成功后原样返回 Response；调用方仍可继续读取其 JSON 或流式正文。
  return response
// 闭合当前花括号结构；与上方对应的 { 配对，结束该函数、条件块或类型声明。
}

// 尽力请求释放一个服务端会话；此函数也在页面离开时使用，因此不依赖等待其完成。
function release(id) {
  // 有 ID 才发 DELETE；编码避免 ID 被解释成路径字符，keepalive 允许离页后短暂继续请求，失败被忽略但服务重启仍会清空内存。
  if (id) void fetch(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE', keepalive: true }).catch(() => {})
// 闭合当前花括号结构；与上方对应的 { 配对，结束该函数、条件块或类型声明。
}

// 发送一轮消息并读取回复流；从创建会话到最终恢复按钮的整个过程都由本函数拥有。
async function submit() {
  // /mcp 与 /skill 本身用于浏览目录，不作为对话发送给模型。
  if (window.dshCompletion?.browse()) return
  // 拍下本次输入并去除两端空白；后续用户继续编辑输入框不会改变已经提交的 text。
  const text = message.value.trim()
  // 忙碌或无有效输入时立即返回，避免空请求和重复请求。
  if (busy || navigating || !available || window.dshFiles?.blocked() || (!text && !window.dshFiles?.hasFiles())) return
  // 在第一个 await 前锁定本页发送流程，阻止两次快速点击同时进入创建会话阶段。
  busy = true
  const attachments = window.dshFiles?.take() ?? []
  // 记录本轮所属的对话版本；所有异步结果都要与当前全局版本核对。
  const current = revision
  // 为当前一轮创建取消控制器；两个 fetch 共用其 signal，方便一次中止整轮网络工作。
  controller = new AbortController()
  // 保留本轮的信号引用，即使全局 controller 后来被新对话替换，也能判断本轮是否被取消。
  const signal = controller.signal
  // 清除上一条错误文字；这只更新提示区域，不会修改服务端历史。
  notice.textContent = ''
  // 立即创建本轮的问题和展示容器；后续回答和工具结果都归到同一轮。
  welcome.hidden = true
  const turn = window.dshChatTurns.create(messages, ++turnNumber, text || '请查看上传的附件。', scrollToReply, attachments)
  // 清空已提交的输入，或在新对话时恢复空输入；不会清除上面保留的 text 变量。
  message.value = ''
  // 按最新的输入和 busy 状态刷新按钮与高度，保持 UI 和内部状态一致。
  updateComposer()
  // 只将消息区域滚到底部，不改变外层页面或右侧面板的位置。
  scrollToReply(true)
  // 开始受保护的执行区；其中抛出的错误会交给后面的 catch，清理操作则由 finally 保证执行。
  try {
    // 仅在当前页面尚无会话时调用创建接口；第二轮开始直接复用 ID，保留历史。
    if (!sessionId) {
      // 先等创建请求完成，再检查 HTTP 状态；checked 返回的仍是可读正文的 Response。
      const created = await checked(await fetch('/api/sessions', {
        // 用 POST 创建资源，声明 JSON 并传空对象；signal 将创建请求纳入本轮取消控制。
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal,
      // 先结束对象或回调，再闭合内外两层调用；括号顺序与打开时相反。
      }))
      // 解析服务端返回的 JSON，读取其中的 sessionId，而不是把 Response 当普通数据对象。
      const data = await created.json()
      // 若用户已经点了新对话，这个晚到的会话不能继续使用；尽力释放它并结束旧流程。
      if (current !== revision) { release(data.sessionId); return }
      // 保存服务端 ID，后续轮次将通过它找到相同 Agent。
      sessionId = data.sessionId
      sessionAttached = true
      window.dshHistory?.select(sessionId)
    // 闭合当前花括号结构；与上方对应的 { 配对，结束该函数、条件块或类型声明。
    }
    if (!sessionAttached) {
      // 恢复原会话 ID 与完整上下文，不把页面里显示的文字重新当作用户消息提交。
      await checked(await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/resume`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal,
      }))
      if (current !== revision) return
      sessionAttached = true
    }
    // 发起聊天请求并检查建流前的 HTTP 错误；成功响应的正文会持续到本轮结束。
    const response = await checked(await fetch('/api/chat', {
      // 发送消息属于创建一轮工作，因此使用 POST，而不是用 GET 查询字符串携带用户正文。
      method: 'POST',
      // 告诉服务端 body 是 JSON 文本，否则接口会以 415 拒绝。
      headers: { 'Content-Type': 'application/json' },
      // 把当前会话 ID 和本轮正文编码为 JSON；这里没有传 API Key，凭据仅由服务端使用。
      body: JSON.stringify({ sessionId, message: text, attachments: attachments.map(file => file.id) }),
      // 对象属性简写，相当于 signal: signal；取消此信号会中止 fetch 或正文流读取。
      signal,
    // 先结束对象或回调，再闭合内外两层调用；括号顺序与打开时相反。
    }))
    // 确认响应具有可读取的流；没有正文就无法按 SSE 显示增量回复。
    if (!response.body) throw new Error('浏览器无法读取回复流。')
    // 取得流读取器；每次 read() 返回网络数据块，网络块边界不等于 SSE 事件边界。
    const reader = response.body.getReader()
    // 建立 UTF-8 解码器；它会在流模式下保留跨网络块拆开的中文字符字节。
    const decoder = new TextDecoder()
    // 缓存已解码但尚未形成完整 SSE 事件的文本，不能假定一个 read 就是一条事件。
    let buffer = ''
    // 记录是否收到服务端显式 done；只读到 EOF 不足以判断生成成功。
    let completed = false
    // 开始受保护的执行区；其中抛出的错误会交给后面的 catch，清理操作则由 finally 保证执行。
    try {
      // 进入持续读取循环；没有固定次数，靠后面的 done 标志退出。
      for (;;) {
        // 等待一个字节块；value 是数据，done 表示正文流已经结束，这里的 done 与 SSE 的同名事件是不同层次。
        const { value, done } = await reader.read()
        // 流未结束时保留未完成字符；最后一次 decode 刷新尾部字节，然后把新文本追加到缓冲。
        buffer += decoder.decode(value, { stream: !done })
        // 临时保存一条 SSE 事件末尾空行的位置，while 会反复更新它。
        let boundary
        // 不断查找两个换行组成的分隔符；一次网络块可能包含零条、一条或多条完整事件。
        while ((boundary = buffer.indexOf('\n\n')) !== -1) {
          // 截取当前完整事件，再拆成 event 与 data 两行；剩余缓冲稍后单独保留。
          const lines = buffer.slice(0, boundary).split('\n')
          // 移除刚处理的事件及两个分隔换行，留下下一条事件或不完整尾部。
          buffer = buffer.slice(boundary + 2)
          // 寻找事件类型行，去掉前缀 event: ；找不到时可选链使结果为 undefined。
          const type = lines.find(line => line.startsWith('event: '))?.slice(7)
          // 提取 data: 后面的 JSON 字符串；这套最小协议由服务端保证单行 JSON。
          const raw = lines.find(line => line.startsWith('data: '))?.slice(6)
          // 没有数据的帧不参与业务处理；continue 跳到下一条完整事件。
          if (!raw) continue
          // 把该事件数据解码成对象；如分帧或 JSON 损坏，异常会进入外层错误提示流程。
          const data = JSON.parse(raw)
          // 同一份真实事件同时驱动轮次视图和右侧调试面板，不重复执行工具。
          if (type === 'run' || type === 'trace') {
            // 旧请求可以补全调试记录，但不能再修改已重置的对话区。
            if (current === revision) turn.receive(type, data)
            window.dispatchEvent(new CustomEvent('dsh:debug', { detail: { type, data } }))
          }
          // HTTP 200 的流中仍可能发生模型失败；显式 error 事件必须被转成失败，而不能当成功文字。
          if (type === 'error') throw new Error(data.message)
          // 收到业务层正常结束标记；之后连接关闭才会被认为是成功完成。
          if (type === 'done') completed = true
          // 只有文本增量且仍属于当前对话版本时才更新页面，防止旧请求覆盖新对话。
          if (type === 'delta' && current === revision) {
            // 视图按模型步骤分别累计 Markdown；工具返回值只由 tool/result 事件展示。
            turn.receive('delta', data)
          // 闭合当前花括号结构；与上方对应的 { 配对，结束该函数、条件块或类型声明。
          }
        // 闭合当前花括号结构；与上方对应的 { 配对，结束该函数、条件块或类型声明。
        }
        // 底层正文流结束时离开读取循环；离开后仍要验证 completed 是否为 true。
        if (done) break
      // 闭合当前花括号结构；与上方对应的 { 配对，结束该函数、条件块或类型声明。
      }
      // 若连接关闭前未收到 SSE done，则报告断线，而不是把部分回复误记为成功。
      if (!completed) throw new Error('连接已中断，请重试。')
      // 结算本轮状态；只有工具结果而没有回答时，视图会明确说明。
      turn.finish('completed')
    // 无论正常返回、提前退出还是抛错，都进入清理区；这能防止连接或 Agent 遗留。
    } finally {
      // 最终释放对正文流的读取；即使网络已关闭而取消失败，也不覆盖原本的成功或错误结果。
      await reader.cancel().catch(() => {})
    // 闭合当前花括号结构；与上方对应的 { 配对，结束该函数、条件块或类型声明。
    }
  // 统一处理请求、状态检查、SSE 解码和服务端生成错误，并把它们呈现到页面。
  } catch (error) {
    // 用户主动新建对话或取消时不显示旧请求错误；这是正常的状态切换，而非发送失败。
    if (current !== revision || signal.aborted) return
    // 保留本轮已有回答和工具结果，在轮次底部单独说明失败。
    turn.finish('error', error instanceof Error ? error.message : '发送失败，请重试。')
    // 展示可读错误，使用 instanceof 判断后才能安全读取 message。
    notice.textContent = error instanceof Error ? error.message : '发送失败，请重试。'
    // 同一会话可能被另一个页面关闭；下次重试先恢复，不能继续拿失效句柄发送。
    if (error.status === 404) sessionAttached = false
    // 若用户尚未输入新内容，则恢复本轮文字方便重试；不会覆盖用户已经写好的下一条输入。
    if (!message.value) message.value = text
    window.dshFiles?.restore(attachments)
  // 无论正常返回、提前退出还是抛错，都进入清理区；这能防止连接或 Agent 遗留。
  } finally {
    // 刷新最后一批文本并释放待执行动画帧，避免新对话后仍更新旧 DOM。
    turn.dispose()
    // 只有当前对话拥有更新 busy、controller 和焦点的权利；旧请求的 finally 不能解锁新请求。
    if (current === revision) {
      // 结束本页的发送锁，使用户能提交下一轮；这里只控制网页，服务端还有独立 busy 检查。
      busy = false
      // 清除已完成或已取消请求的控制器，避免下一次操作误用旧信号。
      controller = null
      // 按最新的输入和 busy 状态刷新按钮与高度，保持 UI 和内部状态一致。
      updateComposer()
      window.dispatchEvent(new Event('dsh:files-refresh'))
      window.dispatchEvent(new Event('dsh:sessions-refresh'))
      // 把键盘焦点交还输入框，便于连续聊天或修正失败的消息。
      message.focus()
    // 闭合当前花括号结构；与上方对应的 { 配对，结束该函数、条件块或类型声明。
    }
  // 闭合当前花括号结构；与上方对应的 { 配对，结束该函数、条件块或类型声明。
  }
// 闭合当前花括号结构；与上方对应的 { 配对，结束该函数、条件块或类型声明。
}

// 拦截表单默认跳转并调用异步发送；submit 自己处理错误，void 表示事件系统不等待它的 Promise。
form.addEventListener('submit', event => { event.preventDefault(); void submit() })
// 用户每次编辑输入都会刷新按钮与高度；传函数引用，不加括号，否则会在注册时立即执行。
message.addEventListener('input', updateComposer)
window.addEventListener('dsh:files-change', updateComposer)
// 监听输入框按键，单独实现 Enter 发送与 Shift+Enter 换行的约定。
message.addEventListener('keydown', event => {
  // 候选列表已消费 Enter 时只补全文字，不能在同一次按键中发送。
  if (event.defaultPrevented || window.dshCompletion?.composing || event.keyCode === 229) return
  // 只有普通 Enter 才发送；中文输入法组合过程中 Enter 可能用于确认候选词，不能抢走它。
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    // 取消这次普通 Enter 的默认换行行为；Shift+Enter 不进入此分支，仍由 textarea 正常换行。
    event.preventDefault()
    // 触发表单的正规提交过程，包括浏览器校验和上面的 submit 监听器，避免重复编写发送逻辑。
    form.requestSubmit()
  // 闭合当前花括号结构；与上方对应的 { 配对，结束该函数、条件块或类型声明。
  }
// 闭合回调函数或对象参数，再闭合外层调用；读到这里才完成这次注册或构造表达式。
})
// 给所有带 data-prompt 的建议按钮绑定点击事件；静态 HTML 通过自定义属性提供消息内容。
document.querySelectorAll('[data-prompt]').forEach(button => button.addEventListener('click', () => {
  // 生成期间忽略建议按钮，避免用预设内容替换用户正在写的下一条消息。
  if (busy) return
  // 把 HTML 的 data-prompt 属性读成输入框文本；dataset 使用去掉 data- 的属性名。
  message.value = button.dataset.prompt
  // 按最新的输入和 busy 状态刷新按钮与高度，保持 UI 和内部状态一致。
  updateComposer()
  // 触发表单的正规提交过程，包括浏览器校验和上面的 submit 监听器，避免重复编写发送逻辑。
  form.requestSubmit()
// 先结束对象或回调，再闭合内外两层调用；括号顺序与打开时相反。
}))
// 注册“新对话”操作；它同时清理旧网络请求、本地显示和服务端会话。
document.querySelector('#new-chat').addEventListener('click', () => {
  // 递增对话版本，使所有已经启动的旧异步流程失去更新当前 UI 的资格。
  revision++
  // 若有进行中的请求则发出取消信号；可选链允许当前没有请求。
  controller?.abort()
  // 请求服务端释放旧 Agent；它会取消当前生成并清理该会话的监听器。
  if (sessionAttached) release(sessionId)
  // 清除旧会话 ID；下一次发送会创建全新 Agent，而不是继续使用旧历史。
  sessionId = null
  openingSessionId = null
  sessionAttached = false
  navigating = false
  window.dshHistory?.select(null)
  window.dispatchEvent(new Event('dsh:sessions-refresh'))
  // 结束本页的发送锁，使用户能提交下一轮；这里只控制网页，服务端还有独立 busy 检查。
  busy = false
  window.dshFiles?.clear()
  // 清除已完成或已取消请求的控制器，避免下一次操作误用旧信号。
  controller = null
  // 移除消息容器的所有子节点；仅重置本地 DOM，服务端清理由上面的 DELETE 完成。
  messages.replaceChildren()
  // 新对话从第 1 轮开始，旧轮次仍可在右侧调用记录中查看。
  turnNumber = 0
  // 恢复初始欢迎区，让空白对话具有清晰的起点。
  welcome.hidden = false
  chatViewport.scrollTop = 0
  followReply = true
  // 清除上一条错误文字；这只更新提示区域，不会修改服务端历史。
  notice.textContent = ''
  // 清空已提交的输入，或在新对话时恢复空输入；不会清除上面保留的 text 变量。
  message.value = ''
  // 按最新的输入和 busy 状态刷新按钮与高度，保持 UI 和内部状态一致。
  updateComposer()
  // 把键盘焦点交还输入框，便于连续聊天或修正失败的消息。
  message.focus()
// 闭合回调函数或对象参数，再闭合外层调用；读到这里才完成这次注册或构造表达式。
})
// 监听页面即将离开或进入浏览器往返缓存的事件，尽力清理不再使用的会话。
window.addEventListener('pagehide', event => {
  // 若进入往返缓存则保留会话，便于返回后继续；真正离页时取消请求并尝试释放服务端资源。
  if (!event.persisted) { controller?.abort(); if (sessionAttached) release(sessionId) }
// 闭合回调函数或对象参数，再闭合外层调用；读到这里才完成这次注册或构造表达式。
})
// 页面加载后请求公开模式信息；Promise 链依次检查状态、解析 JSON、更新模式文字。
void fetch('/api/config').then(checked).then(response => response.json()).then(config => {
  // 区分模拟回复与真实模型；这只展示配置，不保证真实 API 凭据已可用。
  mode.textContent = config.offline ? '离线演示 · 模拟回复' : `真实模型 · ${config.model}`
// 配置读取失败时只更新页面提示，不让未处理的 Promise 异常中断其他交互。
}).catch(() => {
  // 明确告知顶部模式信息尚未取得，避免显示错误的“已连接”状态。
  mode.textContent = '暂时无法连接'
  // 给出可操作的恢复方式；网络失败没有服务端 JSON 错误时也能提供提示。
  notice.textContent = '无法连接服务，请确认服务已启动后刷新页面。'
// 闭合回调函数或对象参数，再闭合外层调用；读到这里才完成这次注册或构造表达式。
})

// 插件切换会使旧 Agent 句柄失效；重置聊天而不清空独立保存的调试记录。
window.addEventListener('dsh:plugin-state', event => {
  // 每个页面都收到同一插件版本；只有版本改变才清理旧会话。
  if (event.detail.changed) {
    // 服务端已落盘并释放旧句柄；保留历史展示，下一次发送通过官方接口恢复。
    revision++
    controller?.abort()
    controller = null
    busy = false
    navigating = false
    sessionAttached = false
    window.dispatchEvent(new Event('dsh:sessions-refresh'))
  // 结束会话失效处理。
  }
  // 当前适配器或任一核心服务未就绪时，仍允许浏览调试数据，但禁用发送。
  available = event.detail.ready
  // 给出可操作原因，而不是让用户反复提交必定失败的请求。
  if (!available) notice.textContent = '模型依赖未就绪，请在插件面板启用核心服务和当前适配器。'
  // 恢复服务后移除旧状态说明，但不覆盖与本轮有关的其他错误。
  else if (notice.textContent.startsWith('模型依赖未就绪')) notice.textContent = ''
  // 重新按模型可用性刷新发送按钮。
  updateComposer()
// 结束调试状态桥接。
})


/** 切换只读取事件，防止浏览历史时触发模型或重跑有副作用的工具。 */
async function openHistory(id) {
  if (id === sessionId && !navigating && busy) { notice.textContent = '当前会话正在生成。'; return }
  const current = ++revision
  openingSessionId = id
  controller?.abort()
  const previous = sessionId
  const previousAttached = sessionAttached
  controller = new AbortController()
  const signal = controller.signal
  busy = false
  navigating = true
  sessionAttached = false
  notice.textContent = '正在读取已保存的会话…'
  updateComposer()
  try {
    // 等上一会话关闭、落盘；服务端按 ID 串行处理，刷新时的关闭与恢复不会争抢写锁。
    if (previousAttached && previous && previous !== id) await fetch(`/api/sessions/${encodeURIComponent(previous)}`, { method: 'DELETE' }).catch(() => {})
    const response = await checked(await fetch(`/api/sessions/${encodeURIComponent(id)}`, { signal, cache: 'no-store' }))
    const saved = await response.json()
    if (current !== revision) return
    messages.replaceChildren()
    turnNumber = window.dshChatTurns.replay(messages, saved.events, saved.attachments)
    sessionId = saved.id
    window.dshHistory?.select(sessionId)
    // 切换会话只更新内容和选中项，侧栏保持展开，等待用户点击“收起”。
    window.dshFiles?.clear()
    welcome.hidden = turnNumber > 0
    notice.textContent = saved.busy ? '该会话仍在其他页面生成，请待本轮结束后重新打开。' : '历史已加载。发送新消息即可恢复并继续对话。'
    message.value = ''
    // 历史从第一轮开始阅读；只重置聊天容器，保留其他面板的滚动位置。
    chatViewport.scrollTop = 0
    followReply = chatViewport.scrollHeight - chatViewport.clientHeight < 220
  } catch (error) {
    if (current === revision && !signal.aborted) {
      notice.textContent = error.message
      // 其他页面已删除的 ID 不应继续作为下次刷新时的恢复目标。
      if (error.status === 404) window.dshHistory?.select(sessionId)
    }
  } finally {
    if (current === revision) { openingSessionId = null; navigating = false; controller = null; updateComposer() }
  }
}
window.addEventListener('dsh:open-session', event => { void openHistory(event.detail.id) })
window.addEventListener('dsh:session-deleted', event => {
  if (event.detail.id !== sessionId && event.detail.id !== openingSessionId) return
  // 服务器已停止并删除 Agent；清空当前视图时不再发送原来的“仅关闭”请求。
  sessionAttached = false
  document.querySelector('#new-chat').click()
  notice.textContent = '该会话已删除，可以开始新对话。'
})
void window.dshHistory?.refresh()
// 刷新恢复同一标签页上次选中的会话；没有 ID 时保持新对话。
if (window.dshHistory?.initial) void openHistory(window.dshHistory.initial)
