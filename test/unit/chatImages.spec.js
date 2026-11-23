/**
 * Unit tests for images pasted into the chat
 */
import { createAppStore } from '../../src/renderer/store'
import { fitWithin, imageFilesFrom, sanitizeAttachments } from '../../src/renderer/utils/chatImages'
import { buildRequestMessages, countImages, messageText } from '../../src/renderer/utils/chatPrompt'
import { sanitizeSessions } from '../../src/renderer/store/chat'
import { DEFAULT_SYSTEM_TEMPLATE, DEFAULT_USER_TEMPLATE } from '../../src/common/llm'

const tick = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms))
const PNG = 'data:image/png;base64,AAAA'
const image = (id = 'img1', dataUrl = PNG) => ({ id, type: 'image', mime: 'image/png', dataUrl, width: 800, height: 600, name: '' })

describe('Images pasted into the chat', () => {
  describe('helpers', () => {
    it('scales large images down, never up', () => {
      expect(fitWithin(4096, 2048)).to.deep.equal({ width: 2048, height: 1024 })
      expect(fitWithin(1000, 3000, 1500)).to.deep.equal({ width: 500, height: 1500 })
      expect(fitWithin(640, 480)).to.deep.equal({ width: 640, height: 480 })
    })

    it('picks the image files of a paste', () => {
      const png = { type: 'image/png', name: 'shot.png' }
      const items = [
        { kind: 'string', type: 'text/plain', getAsFile: () => null },
        { kind: 'file', type: 'image/png', getAsFile: () => png },
        { kind: 'file', type: 'application/pdf', getAsFile: () => ({}) }
      ]
      expect(imageFilesFrom({ items })).to.deep.equal([png])
      expect(imageFilesFrom({ items: [], files: [png, { type: 'text/plain' }] })).to.deep.equal([png])
      expect(imageFilesFrom(null)).to.deep.equal([])
    })

    it('keeps only valid image attachments from a file', () => {
      expect(sanitizeAttachments([image(), { type: 'image', dataUrl: 'javascript:alert(1)' }, null, { type: 'file' }]))
        .to.deep.equal([image()])
      expect(sanitizeAttachments('nope')).to.deep.equal([])
      // Saved sessions keep their images
      const [session] = sanitizeSessions({ sessions: [{ id: 's', messages: [{ id: 'm', role: 'user', content: 'see', attachments: [image()] }] }] })
      expect(session.messages[0].attachments).to.deep.equal([image()])
    })
  })

  describe('requests', () => {
    const base = { systemTemplate: DEFAULT_SYSTEM_TEMPLATE, userTemplate: DEFAULT_USER_TEMPLATE, title: 't', documentText: '' }

    it('sends pasted images with their message, first in the current one and again in history', () => {
      const messages = buildRequestMessages({
        ...base,
        history: [
          { role: 'user', content: 'What is this?', attachments: [image('a', 'data:image/png;base64,OLD')] },
          { role: 'assistant', content: 'A chart.' }
        ],
        userMessage: { input: 'And this?', contexts: [], attachments: [image('b', 'data:image/png;base64,NEW')] },
        images: [{ dataUrl: 'data:image/jpeg;base64,PAGE' }]
      })
      expect(messages[1].content).to.deep.equal([
        { type: 'text', text: 'What is this?' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,OLD' } }
      ])
      expect(messages[3].content.map(p => p.image_url?.url || p.text))
        .to.deep.equal(['And this?', 'data:image/png;base64,NEW', 'data:image/jpeg;base64,PAGE'])
      expect(countImages(messages)).to.equal(3)
      expect(messageText(messages[3])).to.equal('And this?')
    })

    it('leaves images out for models that cannot see them', () => {
      const messages = buildRequestMessages({
        ...base,
        history: [{ role: 'user', content: 'Old', attachments: [image()] }, { role: 'assistant', content: 'ok' }],
        userMessage: { input: 'New', contexts: [] },
        includeAttachments: false
      })
      expect(messages[1].content).to.equal('Old')
      expect(countImages(messages)).to.equal(0)
    })
  })

  describe('store', () => {
    async function setup({ vision = true } = {}) {
      const calls = []
      const ipc = {
        invoke: async (channel, payload) => {
          calls.push({ channel, payload })
          if (channel === 'chat:load') return { success: true, data: null }
          if (channel === 'llm:chat-start') return { started: true }
          return { success: true }
        },
        on: () => {}
      }
      const store = createAppStore({ ipcRenderer: ipc })
      store.commit('HYDRATE_SETTINGS', { llm: { provider: 'custom', baseUrls: { custom: 'http://x/v1' }, models: { custom: 'm' } } })
      store.commit('SET_LLM_MODELS', { providerId: 'custom', models: [{ id: 'm', vision }] })
      store.commit('SET_PDF_DOCUMENT', {
        document: { numPages: 1, getPage: async () => ({ getTextContent: async () => ({ items: [{ str: 'text' }] }) }) },
        path: '/a.pdf'
      })
      await tick(); await tick()
      const lastStart = () => [...calls].reverse().find(c => c.channel === 'llm:chat-start')?.payload
      return { store, lastStart }
    }

    it('sends pasted images with the next message, even without text', async () => {
      const { store, lastStart } = await setup()
      expect(await store.dispatch('chat/attachImage', image())).to.equal(true)
      expect(store.state.chat.attachedImages).to.have.length(1)

      await store.dispatch('chat/sendMessage', { text: '' })
      const [message] = store.getters['chat/activeSession'].messages
      expect(message.attachments).to.deep.equal([image()])
      expect(store.getters['chat/activeSession'].title).to.equal('Image')
      expect(store.state.chat.attachedImages).to.deep.equal([])
      expect(lastStart().messages.at(-1).content[1]).to.deep.equal({ type: 'image_url', image_url: { url: PNG } })
      expect(store.state.chat.lastRequest.images).to.equal(1)
    })

    it('refuses images for a text-only model and keeps them when editing', async () => {
      const textOnly = await setup({ vision: false })
      expect(await textOnly.store.dispatch('chat/attachImage', image())).to.equal(false)
      expect(textOnly.store.state.chat.notice).to.include("can't read images")
      expect(textOnly.store.state.chat.attachedImages).to.deep.equal([])

      const { store, lastStart } = await setup()
      await store.dispatch('chat/attachImage', image())
      await store.dispatch('chat/sendMessage', { text: 'What is it?' })
      await store.dispatch('chat/finishStream', { requestId: store.state.chat.streaming.requestId, result: {} })
      const original = store.getters['chat/activeSession'].messages[0]
      await store.dispatch('chat/editAndRegenerate', { messageId: original.id, text: 'Describe it' })
      const edited = store.getters['chat/activeMessages'][0]
      expect(edited.id).to.not.equal(original.id)
      expect(edited.attachments).to.deep.equal([image()])
      expect(lastStart().messages.at(-1).content[1].image_url.url).to.equal(PNG)
    })

    it('limits the images per message', async () => {
      const { store } = await setup()
      for (let i = 0; i < 8; i++) await store.dispatch('chat/attachImage', image(`i${i}`))
      expect(await store.dispatch('chat/attachImage', image('extra'))).to.equal(false)
      expect(store.state.chat.notice).to.include('Up to 8 images')
    })
  })
})
