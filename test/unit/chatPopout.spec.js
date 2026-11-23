/**
 * Unit tests for the chat's own window (pop-out) state
 */
import { createAppStore } from '../../src/renderer/store'

const ipc = { invoke: async () => ({ success: true }), on: () => {} }

describe('Chat pop-out', () => {
  it('pops out (leaving full screen) and docks back', async () => {
    const store = createAppStore({ ipcRenderer: ipc })
    expect(store.state.chat.popout).to.equal(false)
    expect(store.state.settings.chat.popoutBounds).to.equal(null)
    await store.dispatch('chat/setFullscreen', true)
    await store.dispatch('chat/setPopout', true)
    expect(store.state.chat.popout).to.equal(true)
    expect(store.state.chat.fullscreen).to.equal(false)
    await store.dispatch('chat/setPopout', false)
    expect(store.state.chat.popout).to.equal(false)
  })

  it('docks when the chat is reset (leaving the PDF)', async () => {
    const store = createAppStore({ ipcRenderer: ipc })
    await store.dispatch('chat/setPopout', true)
    store.commit('chat/RESET')
    expect(store.state.chat.popout).to.equal(false)
  })
})
