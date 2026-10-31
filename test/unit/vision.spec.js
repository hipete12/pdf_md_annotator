/**
 * Unit tests for page images (vision) in chat
 */
import { createAppStore } from '../../src/renderer/store'
import { selectVisionPages } from '../../src/renderer/utils/pageImages'

const tick = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms))

describe('selectVisionPages', () => {
  const visiblePages = [3, 1, 2, 5] // user reordered; page 4 deleted

  it('uses attached-context pages in display order', () => {
    expect(selectVisionPages({ mode: 'context', contexts: [{ pageId: 2 }, { pageId: 3 }, { pageId: 2 }], visiblePages, viewPage: 1, max: 4 }))
      .to.deep.equal([3, 2])
  })

  it('falls back to the page in view, then the first page', () => {
    expect(selectVisionPages({ mode: 'context', contexts: [], visiblePages, viewPage: 5, max: 4 })).to.deep.equal([5])
    expect(selectVisionPages({ mode: 'context', contexts: [{ pageId: 4 }], visiblePages, viewPage: null, max: 4 })).to.deep.equal([3])
  })

  it('sends all pages up to the limit', () => {
    expect(selectVisionPages({ mode: 'all', contexts: [], visiblePages, viewPage: 1, max: 3 })).to.deep.equal([3, 1, 2])
  })
})

describe('Chat with page images', () => {
  const fakePdf = (n) => ({
    numPages: n,
    getPage: async (p) => ({ getTextContent: async () => ({ items: [{ str: `text ${p}` }] }) })
  })

  async function setup({ visionEnabled = true, models = [], overrides = {}, model = 'vis-model' } = {}) {
    const calls = []
    const rendered = []
    const listeners = {}
    const ipc = {
      invoke: async (channel, payload) => {
        calls.push({ channel, payload })
        if (channel === 'chat:load') return { success: true, data: null }
        if (channel === 'llm:chat-start') return { started: true }
        return { success: true }
      },
      on: (channel, fn) => { listeners[channel] = fn },
      emit: (channel, payload) => listeners[channel]?.({}, payload)
    }
    const store = createAppStore({
      ipcRenderer: ipc,
      renderPageImage: async (doc, page) => { rendered.push(page); return `data:image/jpeg;base64,PAGE${page}` }
    })
    store.commit('HYDRATE_SETTINGS', {
      llm: { provider: 'custom', baseUrls: { custom: 'http://x/v1' }, models: { custom: model }, visionOverrides: overrides },
      chat: { visionEnabled, visionPages: 'context', maxVisionPages: 4 }
    })
    store.commit('SET_LLM_MODELS', { providerId: 'custom', models })
    store.commit('SET_PDF_DOCUMENT', { document: fakePdf(3), path: '/a.pdf' })
    await tick(); await tick()
    const lastStart = () => [...calls].reverse().find(c => c.channel === 'llm:chat-start')?.payload
    return { store, ipc, rendered, lastStart }
  }

  it('attaches context pages as images for a vision model', async () => {
    const { store, rendered, lastStart } = await setup({ models: [{ id: 'vis-model', vision: true }] })
    expect(store.getters['chat/modelVision']).to.equal(true)
    store.dispatch('chat/setPendingContext', { kind: 'text', page: 2, pageId: 2, text: 'x' })
    store.dispatch('chat/attachPendingContext')
    await store.dispatch('chat/sendMessage', { text: 'Look at the figure' })
    expect(rendered).to.deep.equal([2])
    const content = lastStart().messages.at(-1).content
    expect(content[0].type).to.equal('text')
    expect(content[1]).to.deep.equal({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,PAGE2' } })
    const userMessage = store.getters['chat/activeSession'].messages[0]
    expect(userMessage.images).to.deep.equal([{ page: 2, pageId: 2 }])
    expect(store.state.chat.lastRequest.images).to.equal(1)
  })

  it('never sends images to a model known to be text-only', async () => {
    const { store, rendered, lastStart } = await setup({ models: [{ id: 'vis-model', vision: false }] })
    expect(store.getters['chat/imagesEnabled']).to.equal(false)
    await store.dispatch('chat/sendMessage', { text: 'hi' })
    expect(rendered).to.deep.equal([])
    expect(lastStart().messages.at(-1).content).to.equal('hi')
  })

  it('respects the user override of vision detection', async () => {
    const { store, rendered } = await setup({ models: [{ id: 'vis-model', vision: false }], overrides: { 'vis-model': true } })
    expect(store.getters['chat/modelVision']).to.equal(true)
    await store.dispatch('chat/sendMessage', { text: 'hi' })
    expect(rendered).to.have.length(1)
  })

  it('allows images for models with unknown support', async () => {
    const { store, rendered } = await setup({ model: 'mystery-model' })
    expect(store.getters['chat/modelVision']).to.equal(null)
    await store.dispatch('chat/sendMessage', { text: 'hi' })
    expect(rendered).to.have.length(1)
  })

  it('per-session toggle overrides the setting and is saved', async () => {
    const { store, rendered } = await setup({ visionEnabled: false, models: [{ id: 'vis-model', vision: true }] })
    expect(store.getters['chat/imagesEnabled']).to.equal(false)
    await store.dispatch('chat/newSession')
    await store.dispatch('chat/setSessionVision', true)
    expect(store.getters['chat/imagesEnabled']).to.equal(true)
    await store.dispatch('chat/sendMessage', { text: 'hi' })
    expect(rendered).to.have.length(1)
  })

  it('retry without images turns them off for the session', async () => {
    const { store, ipc, rendered, lastStart } = await setup({ models: [{ id: 'vis-model', vision: true }] })
    await store.dispatch('chat/sendMessage', { text: 'hi' })
    ipc.emit('llm:chat-error', { requestId: lastStart().requestId, code: 'image_unsupported', message: 'no images' })
    await tick()
    await store.dispatch('chat/retry', { withoutImages: true })
    expect(rendered).to.have.length(1) // only the first attempt rendered
    expect(lastStart().messages.at(-1).content).to.equal('hi')
    const session = store.getters['chat/activeSession']
    expect(session.visionEnabled).to.equal(false)
    expect(session.messages[0].images).to.deep.equal([])
  })
})
