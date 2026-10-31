/**
 * Unit tests for the chat store module and its IPC plugin
 */
import { createAppStore } from '../../src/renderer/store'
import { sanitizeSessions } from '../../src/renderer/store/chat'

const tick = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms))

// Fake ipcRenderer: scripted invoke handlers + ability to emit main->renderer events
function createFakeIpc(handlers = {}) {
  const listeners = {}
  const calls = []
  return {
    calls,
    handlers,
    invoke: async (channel, payload) => {
      calls.push({ channel, payload })
      const handler = handlers[channel]
      return handler ? handler(payload) : { success: true }
    },
    on: (channel, fn) => { (listeners[channel] = listeners[channel] || []).push(fn) },
    removeListener: () => {},
    emit: (channel, payload) => (listeners[channel] || []).forEach(fn => fn({}, payload)),
    lastCall: (channel) => [...calls].reverse().find(c => c.channel === channel)
  }
}

const fakePdf = (texts) => ({
  numPages: texts.length,
  getPage: async (n) => ({ getTextContent: async () => ({ items: [{ str: texts[n - 1], hasEOL: false }] }) })
})

async function setup({ savedChat = null, texts = ['Page one text', 'Page two text'] } = {}) {
  const ipc = createFakeIpc({
    'chat:load': () => ({ success: true, data: savedChat }),
    'llm:chat-start': () => ({ started: true })
  })
  const store = createAppStore({ ipcRenderer: ipc })
  store.commit('HYDRATE_SETTINGS', {
    llm: { provider: 'custom', baseUrls: { custom: 'http://fake/v1' }, models: { custom: 'test-model' } }
  })
  store.commit('SET_PDF_DOCUMENT', { document: fakePdf(texts), path: '/docs/paper.pdf' })
  await tick() // plugin watcher -> chat/loadForPdf
  await tick()
  return { store, ipc }
}

const chat = (store) => store.state.chat

describe('Chat store', () => {
  it('loads sessions for the opened PDF and selects the most recent', async () => {
    const { store, ipc } = await setup({
      savedChat: {
        version: '1.0.0',
        sessions: [
          { id: 's1', title: 'Old', created: '2026-01-01T00:00:00Z', modified: '2026-01-01T00:00:00Z', messages: [] },
          { id: 's2', title: 'New', created: '2026-02-01T00:00:00Z', modified: '2026-02-01T00:00:00Z', messages: [{ role: 'user', content: 'hi' }] }
        ]
      }
    })
    expect(ipc.lastCall('chat:load').payload).to.deep.equal({ pdfPath: '/docs/paper.pdf' })
    expect(chat(store).sessions).to.have.length(2)
    expect(chat(store).activeSessionId).to.equal('s2')
    expect(store.getters['chat/sortedSessions'].map(s => s.id)).to.deep.equal(['s2', 's1'])
  })

  it('sanitizes malformed chat files', () => {
    expect(sanitizeSessions(null)).to.deep.equal([])
    const sessions = sanitizeSessions({ sessions: [{ id: 'a', messages: [{ role: 'system', content: 'x' }, { role: 'user', content: 'ok' }, null] }, { nope: 1 }] })
    expect(sessions).to.have.length(1)
    expect(sessions[0].messages.map(m => m.content)).to.deep.equal(['ok'])
    expect(sessions[0].messages[0].contexts).to.deep.equal([])
  })

  it('streams a reply, batches deltas and persists the session', async () => {
    const { store, ipc } = await setup()
    await store.dispatch('chat/sendMessage', { text: 'What is page two about?' })

    const start = ipc.lastCall('llm:chat-start').payload
    expect(start).to.include({ providerId: 'custom', baseUrl: 'http://fake/v1', model: 'test-model', temperature: 0.3 })
    expect(start.messages[0].role).to.equal('system')
    expect(start.messages[0].content).to.include('[Page 1]\nPage one text\n\n[Page 2]\nPage two text')
    expect(start.messages[0].content).to.include('"paper.pdf"')
    expect(start.messages[1]).to.deep.equal({ role: 'user', content: 'What is page two about?' })

    const session = store.getters['chat/activeSession']
    expect(session.title).to.equal('What is page two about?')
    expect(session.messages.map(m => m.role)).to.deep.equal(['user', 'assistant'])
    expect(store.getters['chat/isStreaming']).to.equal(true)

    ipc.emit('llm:chat-delta', { requestId: start.requestId, content: 'It is ' })
    ipc.emit('llm:chat-delta', { requestId: start.requestId, content: 'about ' })
    ipc.emit('llm:chat-delta', { requestId: 'other-request', content: 'IGNORED ' })
    ipc.emit('llm:chat-delta', { requestId: start.requestId, content: 'text.' })
    expect(session.messages[1].content).to.equal('') // batched, not yet flushed
    await tick(50)
    expect(session.messages[1].content).to.equal('It is about text.')

    ipc.emit('llm:chat-done', { requestId: start.requestId, model: 'test-model-v2', finishReason: 'stop' })
    await tick()
    expect(store.getters['chat/isStreaming']).to.equal(false)
    expect(session.messages[1]).to.include({ pending: false, model: 'test-model-v2', finishReason: 'stop' })

    const saved = ipc.lastCall('chat:save').payload
    expect(saved.pdfPath).to.equal('/docs/paper.pdf')
    expect(saved.data.version).to.equal('1.0.0')
    expect(saved.data.sessions[0].messages[1].content).to.equal('It is about text.')
    expect(saved.data.sessions[0].messages[1]).to.not.have.property('pending')
  })

  it('includes earlier turns and their contexts in follow-up requests', async () => {
    const { store, ipc } = await setup()
    store.dispatch('chat/setPendingContext', { kind: 'text', page: 2, pageId: 2, text: 'Page two text' })
    store.dispatch('chat/attachPendingContext')
    expect(chat(store).attachedContexts).to.have.length(1)
    await store.dispatch('chat/sendMessage', { text: 'Explain this' })
    expect(chat(store).attachedContexts).to.have.length(0) // chips last for one message
    const first = ipc.lastCall('llm:chat-start').payload
    ipc.emit('llm:chat-done', { requestId: first.requestId })
    await tick()
    // done without content -> treated as empty reply; add content to make the exchange complete
    store.getters['chat/activeSession'].messages[1].content = 'An explanation.'

    await store.dispatch('chat/sendMessage', { text: 'Shorter please' })
    const second = ipc.lastCall('llm:chat-start').payload
    expect(second.messages.map(m => m.role)).to.deep.equal(['system', 'user', 'assistant', 'user'])
    expect(second.messages[1].content).to.equal('<selected_context>\n[p. 2, selected text]\nPage two text\n</selected_context>\nExplain this')
    expect(second.messages[2].content).to.equal('An explanation.')
    expect(second.messages[3].content).to.equal('Shorter please')
  })

  it('records errors on the assistant message and supports retry', async () => {
    const { store, ipc } = await setup()
    await store.dispatch('chat/sendMessage', { text: 'Hello' })
    const first = ipc.lastCall('llm:chat-start').payload
    ipc.emit('llm:chat-error', { requestId: first.requestId, code: 'auth', message: 'bad key' })
    await tick()
    const session = store.getters['chat/activeSession']
    expect(session.messages[1].error).to.deep.equal({ code: 'auth', message: 'bad key' })
    expect(store.getters['chat/isStreaming']).to.equal(false)

    await store.dispatch('chat/retry')
    const second = ipc.lastCall('llm:chat-start').payload
    expect(second.requestId).to.not.equal(first.requestId)
    expect(session.messages).to.have.length(2) // failed reply replaced, user message kept
    expect(session.messages[1].error).to.equal(undefined)
    expect(second.messages[1].content).to.equal('Hello')
  })

  it('stop aborts the request and ignores the late error event', async () => {
    const { store, ipc } = await setup()
    await store.dispatch('chat/sendMessage', { text: 'Long answer please' })
    const start = ipc.lastCall('llm:chat-start').payload
    ipc.emit('llm:chat-delta', { requestId: start.requestId, content: 'Partial' })
    await tick(50)
    await store.dispatch('chat/stop')
    expect(ipc.lastCall('llm:chat-abort').payload).to.deep.equal({ requestId: start.requestId })
    const reply = store.getters['chat/activeSession'].messages[1]
    expect(reply.error.code).to.equal('aborted')
    expect(reply.content).to.equal('Partial')
    ipc.emit('llm:chat-error', { requestId: start.requestId, code: 'aborted', message: 'Request cancelled' })
    await tick()
    expect(reply.error.message).to.equal('Stopped')
  })

  it('asks for a model before sending', async () => {
    const { store, ipc } = await setup()
    store.commit('SET_SETTING', { path: 'llm.models', value: { custom: '' } })
    const sent = await store.dispatch('chat/sendMessage', { text: 'hi' })
    expect(sent).to.equal(false)
    expect(chat(store).notice).to.include('Settings')
    expect(ipc.lastCall('llm:chat-start')).to.equal(undefined)
  })

  it('reuses an empty session, renames and deletes sessions', async () => {
    const { store, ipc } = await setup()
    const a = await store.dispatch('chat/newSession')
    const b = await store.dispatch('chat/newSession')
    expect(a).to.equal(b)
    expect(chat(store).sessions).to.have.length(1)

    await store.dispatch('chat/sendMessage', { text: 'first' })
    ipc.emit('llm:chat-done', { requestId: ipc.lastCall('llm:chat-start').payload.requestId })
    await tick()
    const c = await store.dispatch('chat/newSession')
    expect(c).to.not.equal(a)
    expect(chat(store).activeSessionId).to.equal(c)

    await store.dispatch('chat/renameSession', { id: a, title: '  Renamed  ' })
    expect(chat(store).sessions.find(s => s.id === a).title).to.equal('Renamed')

    await store.dispatch('chat/deleteSession', a)
    expect(chat(store).sessions.map(s => s.id)).to.deep.equal([c])
    // empty sessions are not written to disk
    expect(ipc.lastCall('chat:save').payload.data.sessions).to.deep.equal([])
  })

  it('switching PDFs resets the chat state', async () => {
    const { store, ipc } = await setup()
    await store.dispatch('chat/sendMessage', { text: 'hi' })
    store.commit('SET_PDF_DOCUMENT', { document: fakePdf(['other']), path: '/docs/other.pdf' })
    await tick()
    await tick()
    expect(ipc.lastCall('llm:chat-abort')).to.not.equal(undefined)
    expect(chat(store).loadedPdfPath).to.equal('/docs/other.pdf')
    expect(chat(store).sessions).to.deep.equal([])
  })

  it('app-level settings do not mark the document dirty', async () => {
    const { store } = await setup()
    store.commit('SET_SETTING', { path: 'chat.panelVisible', value: true })
    expect(store.state.isDirty).to.equal(false)
    store.commit('SET_SETTING', { path: 'markdown.fontSize', value: 20 })
    expect(store.state.isDirty).to.equal(true)
  })

  it('keeps the page being read when the document is over budget', async () => {
    const texts = Array.from({ length: 6 }, (_, i) => `Page ${i + 1} `.repeat(200))
    const { store, ipc } = await setup({ texts })
    store.commit('SET_SETTING', { path: 'llm.contextBudgetTokens', value: 1000 })
    store.commit('SET_VIEW_PAGE', 5) // scrolled to page 5; currentPage is still 1
    await store.dispatch('chat/sendMessage', { text: 'What is here?' })
    const system = ipc.lastCall('llm:chat-start').payload.messages[0].content
    expect(system).to.include('[Page 5]')
    expect(system).to.not.include('[Page 1]')
    expect(chat(store).lastRequest.truncated).to.equal(true)
    expect(chat(store).lastRequest.includedPages).to.include(5)
  })
})

describe('Context chips', () => {
  it('attaches pending contexts once, ignoring duplicates', async () => {
    const { store } = await setup()
    const attach = (ctx) => { store.dispatch('chat/setPendingContext', ctx); store.dispatch('chat/attachPendingContext') }
    attach({ kind: 'text', page: 1, pageId: 1, text: 'same' })
    attach({ kind: 'text', page: 1, pageId: 1, text: 'same' })
    attach({ kind: 'text', page: 2, pageId: 2, text: 'same' })
    attach({ kind: 'note', page: 1, pageId: 1, noteId: 'n1', text: 'v1' })
    attach({ kind: 'note', page: 1, pageId: 1, noteId: 'n1', text: 'v2' })
    expect(chat(store).attachedContexts.map(c => `${c.kind}:${c.pageId}:${c.text}`)).to.deep.equal(['text:1:same', 'text:2:same', 'note:1:v1'])
    expect(chat(store).pendingContext).to.equal(null)
    store.dispatch('chat/removeAttachedContext', chat(store).attachedContexts[0].id)
    expect(chat(store).attachedContexts).to.have.length(2)
  })

  it('sends contexts without any typed text', async () => {
    const { store, ipc } = await setup()
    store.dispatch('chat/setPendingContext', { kind: 'text', page: 1, pageId: 1, text: 'Page one text' })
    store.dispatch('chat/attachPendingContext')
    expect(await store.dispatch('chat/sendMessage', { text: '' })).to.equal(true)
    const last = ipc.lastCall('llm:chat-start').payload.messages.at(-1).content
    expect(last).to.equal('<selected_context>\n[p. 1, selected text]\nPage one text\n</selected_context>')
    expect(store.getters['chat/activeSession'].title).to.equal('Selected context')
  })
})

describe('Page navigation state', () => {
  it('scroll requests always change (nonce) and reset with a new document', () => {
    const store = createAppStore({ ipcRenderer: createFakeIpc() })
    store.commit('REQUEST_PAGE_SCROLL', 3)
    store.commit('REQUEST_PAGE_SCROLL', 3)
    expect(store.state.scrollRequest).to.deep.equal({ pageId: 3, nonce: 2 })
    store.commit('SET_VIEW_PAGE', 4)
    store.commit('SET_PDF_DOCUMENT', { document: fakePdf(['a']), path: '/x.pdf' })
    expect(store.state.viewPage).to.equal(null)
    expect(store.state.scrollRequest).to.equal(null)
  })
})
