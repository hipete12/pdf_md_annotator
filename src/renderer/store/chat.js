/**
 * Chat sessions for the open PDF (Vuex module, namespaced as "chat").
 *
 * Sessions are persisted to "<name>.pdfchat" next to the PDF through the
 * chat:load / chat:save IPC handlers. Replies stream from the main process
 * (llm:chat-start) and arrive through the plugin created by createChatPlugin.
 */
import { v4 as uuidv4 } from 'uuid'
import { buildRequestMessages, estimateTokens, formatDocument, sessionTitleFrom } from '../utils/chatPrompt'
import { extractDocumentPages } from '../utils/documentText'

export const PDFCHAT_VERSION = '1.0.0'

const clone = (value) => JSON.parse(JSON.stringify(value))
const now = () => new Date().toISOString()

function findSession(state, id) {
  return state.sessions.find(s => s.id === id) || null
}

function findMessage(state, sessionId, messageId) {
  return findSession(state, sessionId)?.messages.find(m => m.id === messageId) || null
}

// Basic shape check for loaded .pdfchat data; drops anything malformed
export function sanitizeSessions(data) {
  if (!data || !Array.isArray(data.sessions)) return []
  return data.sessions
    .filter(s => s && typeof s.id === 'string' && Array.isArray(s.messages))
    .map(s => ({
      id: s.id,
      title: typeof s.title === 'string' ? s.title : 'Chat',
      created: s.created || now(),
      modified: s.modified || s.created || now(),
      messages: s.messages
        .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
        .map(m => ({ ...m, contexts: Array.isArray(m.contexts) ? m.contexts : [], pending: false }))
    }))
}

export function createChatModule({ ipcRenderer }) {
  return {
    namespaced: true,

    state: () => ({
      sessions: [],
      activeSessionId: null,
      loadedPdfPath: null,
      // { requestId, sessionId, messageId } while a reply is streaming
      streaming: null,
      // Phase 4: selection waiting to be attached / contexts for the next message
      pendingContext: null,
      attachedContexts: [],
      fullscreen: false,
      // e.g. "Reading document…" while building a request
      status: '',
      // Problems not tied to a message (no model configured, save failed, ...)
      notice: '',
      lastRequest: null // { estimatedTokens, truncated, includedPages, totalPages }
    }),

    getters: {
      activeSession: (state) => findSession(state, state.activeSessionId),
      sortedSessions: (state) => [...state.sessions].sort((a, b) => b.modified.localeCompare(a.modified)),
      isStreaming: (state) => Boolean(state.streaming)
    },

    mutations: {
      RESET(state) {
        state.sessions = []
        state.activeSessionId = null
        state.loadedPdfPath = null
        state.streaming = null
        state.pendingContext = null
        state.attachedContexts = []
        state.status = ''
        state.notice = ''
        state.lastRequest = null
      },
      SET_SESSIONS(state, { pdfPath, sessions }) {
        state.loadedPdfPath = pdfPath
        state.sessions = sessions
        state.activeSessionId = [...sessions].sort((a, b) => b.modified.localeCompare(a.modified))[0]?.id || null
      },
      ADD_SESSION(state, session) {
        state.sessions.push(session)
        state.activeSessionId = session.id
      },
      SET_ACTIVE(state, id) {
        state.activeSessionId = id
      },
      RENAME_SESSION(state, { id, title }) {
        const session = findSession(state, id)
        if (session) {
          session.title = title
          session.modified = now()
        }
      },
      REMOVE_SESSION(state, id) {
        state.sessions = state.sessions.filter(s => s.id !== id)
        if (state.activeSessionId === id) {
          state.activeSessionId = [...state.sessions].sort((a, b) => b.modified.localeCompare(a.modified))[0]?.id || null
        }
      },
      ADD_MESSAGE(state, { sessionId, message }) {
        const session = findSession(state, sessionId)
        if (!session) return
        session.messages.push(message)
        session.modified = now()
      },
      APPEND_TO_MESSAGE(state, { sessionId, messageId, content, reasoning }) {
        const message = findMessage(state, sessionId, messageId)
        if (!message) return
        if (content) message.content += content
        if (reasoning) message.reasoning = (message.reasoning || '') + reasoning
      },
      UPDATE_MESSAGE(state, { sessionId, messageId, patch }) {
        const message = findMessage(state, sessionId, messageId)
        if (message) Object.assign(message, patch)
      },
      REMOVE_MESSAGE(state, { sessionId, messageId }) {
        const session = findSession(state, sessionId)
        if (session) session.messages = session.messages.filter(m => m.id !== messageId)
      },
      SET_STREAMING(state, streaming) {
        state.streaming = streaming
      },
      SET_FULLSCREEN(state, value) {
        state.fullscreen = value
      },
      SET_PENDING_CONTEXT(state, context) {
        state.pendingContext = context
      },
      ATTACH_CONTEXT(state, context) {
        const duplicate = state.attachedContexts.some(c =>
          c.kind === context.kind && c.pageId === context.pageId &&
          (context.kind === 'note' ? c.noteId === context.noteId : c.text === context.text))
        if (!duplicate) state.attachedContexts.push(context)
      },
      REMOVE_ATTACHED(state, id) {
        state.attachedContexts = state.attachedContexts.filter(c => c.id !== id)
      },
      CLEAR_ATTACHED(state) {
        state.attachedContexts = []
      },
      SET_STATUS(state, status) {
        state.status = status
      },
      SET_NOTICE(state, notice) {
        state.notice = notice
      },
      SET_LAST_REQUEST(state, info) {
        state.lastRequest = info
      }
    },

    actions: {
      async loadForPdf({ commit, state, dispatch }, pdfPath) {
        if (state.streaming) await dispatch('stop')
        commit('RESET')
        if (!pdfPath || !ipcRenderer) return
        const result = await ipcRenderer.invoke('chat:load', { pdfPath })
        if (!result?.success) {
          commit('SET_NOTICE', `Could not read the chat file: ${result?.error || 'unknown error'}`)
          commit('SET_SESSIONS', { pdfPath, sessions: [] })
          return
        }
        commit('SET_SESSIONS', { pdfPath, sessions: sanitizeSessions(result.data) })
      },

      async persist({ state, commit }) {
        if (!state.loadedPdfPath || !ipcRenderer) return
        const sessions = clone(state.sessions.filter(s => s.messages.length > 0))
        for (const session of sessions) {
          for (const message of session.messages) delete message.pending
        }
        const result = await ipcRenderer.invoke('chat:save', {
          pdfPath: state.loadedPdfPath,
          data: { version: PDFCHAT_VERSION, pdfPath: state.loadedPdfPath, sessions }
        })
        if (!result?.success) commit('SET_NOTICE', `Could not save the chat: ${result?.error || 'unknown error'}`)
      },

      newSession({ commit, getters }) {
        // Reuse an untouched session instead of piling up empty ones
        if (getters.activeSession && getters.activeSession.messages.length === 0) return getters.activeSession.id
        const session = { id: uuidv4(), title: 'New chat', created: now(), modified: now(), messages: [] }
        commit('ADD_SESSION', session)
        return session.id
      },

      selectSession({ commit }, id) {
        commit('SET_ACTIVE', id)
      },

      renameSession({ commit, dispatch }, { id, title }) {
        const clean = String(title || '').trim()
        if (!clean) return
        commit('RENAME_SESSION', { id, title: clean })
        return dispatch('persist')
      },

      async deleteSession({ commit, dispatch, state }, id) {
        if (state.streaming?.sessionId === id) await dispatch('stop')
        commit('REMOVE_SESSION', id)
        return dispatch('persist')
      },

      async sendMessage({ commit, dispatch, state, getters, rootState }, { text }) {
        const input = String(text || '').trim()
        if (state.streaming || (!input && state.attachedContexts.length === 0)) return false

        const llm = rootState.settings.llm
        if (!llm.models?.[llm.provider]) {
          commit('SET_NOTICE', 'Choose a provider and model in Settings → AI Chat first.')
          return false
        }
        commit('SET_NOTICE', '')

        const sessionId = getters.activeSession ? getters.activeSession.id : await dispatch('newSession')
        const session = getters.activeSession
        if (session.messages.length === 0) commit('RENAME_SESSION', { id: sessionId, title: sessionTitleFrom(input || 'Selected context') })

        const userMessage = {
          id: uuidv4(),
          role: 'user',
          content: input,
          contexts: clone(state.attachedContexts),
          created: now()
        }
        commit('ADD_MESSAGE', { sessionId, message: userMessage })
        commit('CLEAR_ATTACHED')
        commit('SET_PENDING_CONTEXT', null)
        return dispatch('generateReply', { sessionId, userMessageId: userMessage.id })
      },

      // Request an assistant reply to the given user message (also used by retry)
      async generateReply({ commit, dispatch, state, rootState, rootGetters }, { sessionId, userMessageId }) {
        const session = findSession(state, sessionId)
        const index = session?.messages.findIndex(m => m.id === userMessageId) ?? -1
        if (index === -1) return false
        const userMessage = session.messages[index]
        const history = session.messages.slice(0, index)

        const llm = rootState.settings.llm
        const providerId = llm.provider
        const model = llm.models?.[providerId] || ''

        const assistantMessage = {
          id: uuidv4(),
          role: 'assistant',
          content: '',
          reasoning: '',
          model,
          created: now(),
          pending: true
        }
        commit('ADD_MESSAGE', { sessionId, message: assistantMessage })
        const fail = (code, message) => {
          commit('UPDATE_MESSAGE', { sessionId, messageId: assistantMessage.id, patch: { pending: false, error: { code, message } } })
          commit('SET_STREAMING', null)
          commit('SET_STATUS', '')
          return dispatch('persist').then(() => false)
        }

        const requestId = uuidv4()
        commit('SET_STREAMING', { requestId, sessionId, messageId: assistantMessage.id })

        let messages
        try {
          commit('SET_STATUS', 'Reading document…')
          const pages = await extractDocumentPages(rootGetters.visiblePages, rootGetters.getPageSource)
          // Pages to keep when the document is too long: attached context and
          // the page being read
          const currentIndex = rootGetters.visiblePages.indexOf(rootState.viewPage ?? rootState.currentPage)
          const focusPages = [
            ...userMessage.contexts.map(c => c.page).filter(Boolean),
            ...(currentIndex >= 0 ? [currentIndex + 1] : [])
          ]
          const doc = formatDocument(pages, { budgetTokens: llm.contextBudgetTokens, focusPages })
          messages = buildRequestMessages({
            systemTemplate: llm.systemTemplate,
            userTemplate: llm.userTemplate,
            title: String(rootState.pdfPath || 'document').split(/[\\/]/).pop(),
            documentText: doc.text,
            history,
            userMessage: { input: userMessage.content, contexts: userMessage.contexts },
            images: []
          })
          commit('SET_LAST_REQUEST', {
            estimatedTokens: messages.reduce((sum, m) => sum + estimateTokens(typeof m.content === 'string' ? m.content : JSON.stringify(m.content)), 0),
            truncated: doc.truncated,
            includedPages: doc.includedPages,
            totalPages: doc.totalPages
          })
        } catch (err) {
          return fail('prompt', `Could not prepare the request: ${err.message}`)
        }

        // The user may have pressed Stop while the document was being read
        if (state.streaming?.requestId !== requestId) return false
        commit('SET_STATUS', '')

        if (!ipcRenderer) return fail('config', 'Chat is only available in the desktop app')
        const started = await ipcRenderer.invoke('llm:chat-start', {
          requestId,
          providerId,
          baseUrl: llm.baseUrls?.[providerId],
          model,
          messages,
          temperature: llm.temperature
        })
        if (!started?.started) return fail('start', started?.error || 'Could not start the request')
        return true
      },

      // Called by the IPC plugin when a stream finishes or fails
      async finishStream({ commit, state, dispatch }, { requestId, result, error }) {
        const streaming = state.streaming
        if (!streaming || streaming.requestId !== requestId) return
        const patch = { pending: false }
        if (result) {
          if (result.model) patch.model = result.model
          if (result.usage) patch.usage = result.usage
          if (result.finishReason) patch.finishReason = result.finishReason
        }
        if (error) patch.error = { code: error.code, message: error.message }
        commit('UPDATE_MESSAGE', { sessionId: streaming.sessionId, messageId: streaming.messageId, patch })
        commit('SET_STREAMING', null)
        commit('SET_STATUS', '')
        await dispatch('persist')
      },

      async stop({ state, dispatch }) {
        const streaming = state.streaming
        if (!streaming) return
        if (ipcRenderer) await ipcRenderer.invoke('llm:chat-abort', { requestId: streaming.requestId })
        // Covers a stop while still reading the document (no stream yet); a
        // live stream's own error event is then ignored as stale
        await dispatch('finishStream', {
          requestId: streaming.requestId,
          error: { code: 'aborted', message: 'Stopped' }
        })
      },

      // Regenerate the last assistant reply of the active session
      retry({ commit, dispatch, state, getters }) {
        const session = getters.activeSession
        if (!session || state.streaming) return false
        const last = session.messages[session.messages.length - 1]
        const previous = session.messages[session.messages.length - 2]
        if (last?.role !== 'assistant' || previous?.role !== 'user') return false
        commit('REMOVE_MESSAGE', { sessionId: session.id, messageId: last.id })
        return dispatch('generateReply', { sessionId: session.id, userMessageId: previous.id })
      },

      setFullscreen({ commit }, value) {
        commit('SET_FULLSCREEN', Boolean(value))
      },

      setPendingContext({ commit }, context) {
        commit('SET_PENDING_CONTEXT', context ? { id: uuidv4(), ...context } : null)
      },

      attachPendingContext({ commit, state }) {
        if (!state.pendingContext) return
        commit('ATTACH_CONTEXT', state.pendingContext)
        commit('SET_PENDING_CONTEXT', null)
      },

      removeAttachedContext({ commit }, id) {
        commit('REMOVE_ATTACHED', id)
      }
    }
  }
}

/**
 * Vuex plugin wiring the main-process stream events into the chat module and
 * (re)loading sessions whenever a PDF is opened. Text deltas are batched so
 * the message re-renders at most every ~30 ms.
 */
export function createChatPlugin({ ipcRenderer, flushDelayMs = 30 }) {
  return (store) => {
    store.watch(
      (state) => state.pdfDocument,
      () => store.dispatch('chat/loadForPdf', store.state.pdfPath)
    )

    if (!ipcRenderer?.on) return

    let buffer = { requestId: null, content: '', reasoning: '' }
    let timer = null

    const flush = () => {
      clearTimeout(timer)
      timer = null
      const streaming = store.state.chat.streaming
      if (streaming && buffer.requestId === streaming.requestId && (buffer.content || buffer.reasoning)) {
        store.commit('chat/APPEND_TO_MESSAGE', {
          sessionId: streaming.sessionId,
          messageId: streaming.messageId,
          content: buffer.content,
          reasoning: buffer.reasoning
        })
      }
      buffer = { requestId: null, content: '', reasoning: '' }
    }

    ipcRenderer.on('llm:chat-delta', (event, { requestId, content, reasoning }) => {
      // Late events from a stopped/replaced request
      if (requestId !== store.state.chat.streaming?.requestId) return
      if (buffer.requestId && buffer.requestId !== requestId) flush()
      buffer.requestId = requestId
      buffer.content += content || ''
      buffer.reasoning += reasoning || ''
      if (!timer) timer = setTimeout(flush, flushDelayMs)
    })

    ipcRenderer.on('llm:chat-done', (event, { requestId, ...result }) => {
      flush()
      store.dispatch('chat/finishStream', { requestId, result })
    })

    ipcRenderer.on('llm:chat-error', (event, { requestId, code, message }) => {
      flush()
      store.dispatch('chat/finishStream', { requestId, error: { code, message } })
    })
  }
}
