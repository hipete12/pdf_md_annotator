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
import { renderPageImage as defaultRenderPageImage, selectVisionPages } from '../utils/pageImages'
import { LLM_PROVIDERS, resolveVisionSupport } from '../../common/llm'
import { activePath, ancestorsOf, normalizeTree, pointersToShow, siblingsOf, subtreeIds } from '../utils/chatTree'

// 1.1.0: messages form a tree (parentId / activeChildId / rootActiveId)
export const PDFCHAT_VERSION = '1.1.0'

const clone = (value) => JSON.parse(JSON.stringify(value))
const now = () => new Date().toISOString()

function findSession(state, id) {
  return state.sessions.find(s => s.id === id) || null
}

function setActiveChild(session, parentId, childId) {
  if (parentId == null) {
    session.rootActiveId = childId
  } else {
    const parent = session.messages.find(m => m.id === parentId)
    if (parent) parent.activeChildId = childId
  }
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
      // null: follow the "Send page images" setting; true/false: per-session override
      visionEnabled: typeof s.visionEnabled === 'boolean' ? s.visionEnabled : null,
      // Model chosen for this session; null follows the default from Settings
      provider: typeof s.provider === 'string' && LLM_PROVIDERS[s.provider] ? s.provider : null,
      model: typeof s.model === 'string' && s.model ? s.model : null,
      // Flat lists from 1.0.0 files become a single chain
      ...normalizeTree(
        s.messages
          .filter(m => m && typeof m.id === 'string' && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
          .map(m => ({ ...m, contexts: Array.isArray(m.contexts) ? m.contexts : [], pending: false })),
        s.rootActiveId
      )
    }))
}

export function createChatModule({ ipcRenderer, renderPageImage = defaultRenderPageImage }) {
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
      // Visible conversation of the active session (one branch of its tree)
      activeMessages: (state, getters) => activePath(getters.activeSession),
      // true / false / null (unknown) for the selected model
      // Provider + model for the active session: its own choice, else the
      // default from Settings. isDefault tells the UI which one applies.
      sessionModel: (state, getters, rootState) => {
        const llm = rootState.settings.llm
        const session = getters.activeSession
        if (session?.provider && session?.model) {
          return { providerId: session.provider, model: session.model, isDefault: false }
        }
        return { providerId: llm.provider, model: llm.models?.[llm.provider] || '', isDefault: true }
      },
      // Model entry (from the loaded model list) for the active session, if known
      sessionModelInfo: (state, getters, rootState) => {
        const { providerId, model } = getters.sessionModel
        return (rootState.llmModels[providerId] || []).find(m => m.id === model) || null
      },
      modelVision: (state, getters, rootState) => {
        const { model } = getters.sessionModel
        if (!model) return null
        return resolveVisionSupport(getters.sessionModelInfo, rootState.settings.llm.visionOverrides, model)
      },
      // Whether the next message in the active session will include page images
      imagesEnabled: (state, getters, rootState) => {
        if (getters.modelVision === false) return false
        const override = getters.activeSession?.visionEnabled
        return typeof override === 'boolean' ? override : Boolean(rootState.settings.chat.visionEnabled)
      },
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
      SET_SESSION_MODEL(state, { id, providerId, model }) {
        const session = findSession(state, id)
        if (!session) return
        session.provider = providerId || null
        session.model = providerId && model ? model : null
      },
      SET_SESSION_VISION(state, { id, value }) {
        const session = findSession(state, id)
        if (session) session.visionEnabled = value
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
      // Adds a message under message.parentId and shows it (branch pointer)
      ADD_MESSAGE(state, { sessionId, message }) {
        const session = findSession(state, sessionId)
        if (!session) return
        session.messages.push(message)
        setActiveChild(session, message.parentId ?? null, message.id)
        session.modified = now()
      },
      SET_ACTIVE_CHILD(state, { sessionId, parentId, childId }) {
        const session = findSession(state, sessionId)
        if (session) setActiveChild(session, parentId, childId)
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
      REMOVE_MESSAGES(state, { sessionId, ids }) {
        const session = findSession(state, sessionId)
        if (!session) return
        const remove = new Set(ids)
        session.messages = session.messages.filter(m => !remove.has(m.id))
        // Clear pointers to removed messages (activePath then picks a sibling)
        if (remove.has(session.rootActiveId)) session.rootActiveId = null
        for (const m of session.messages) if (remove.has(m.activeChildId)) m.activeChildId = null
        session.modified = now()
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
          (context.kind === 'note'
            ? c.noteId === context.noteId
            : c.text === context.text && (c.messageId ?? null) === (context.messageId ?? null)))
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
        const session = {
          id: uuidv4(),
          title: 'New chat',
          created: now(),
          modified: now(),
          visionEnabled: null,
          provider: null,
          model: null,
          rootActiveId: null,
          messages: []
        }
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

      async sendMessage({ commit, dispatch, state, getters }, { text }) {
        const input = String(text || '').trim()
        if (state.streaming || (!input && state.attachedContexts.length === 0)) return false

        if (!getters.sessionModel.model) {
          commit('SET_NOTICE', 'Choose a provider and model in Settings → AI Chat first.')
          return false
        }
        commit('SET_NOTICE', '')

        const sessionId = getters.activeSession ? getters.activeSession.id : await dispatch('newSession')
        const session = getters.activeSession
        if (session.messages.length === 0) commit('RENAME_SESSION', { id: sessionId, title: sessionTitleFrom(input || 'Selected context') })

        // Continue the visible branch
        const path = activePath(getters.activeSession)
        const userMessage = {
          id: uuidv4(),
          role: 'user',
          parentId: path.length ? path[path.length - 1].id : null,
          activeChildId: null,
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
      async generateReply({ commit, dispatch, state, getters, rootState, rootGetters }, { sessionId, userMessageId }) {
        const session = findSession(state, sessionId)
        const userMessage = session?.messages.find(m => m.id === userMessageId)
        if (!userMessage) return false
        // Only this branch's turns are sent, never other branches
        const history = ancestorsOf(session, userMessageId)

        const llm = rootState.settings.llm
        // The session's own model when chosen, else the Settings default
        const providerId = session.provider && session.model ? session.provider : llm.provider
        const model = session.provider && session.model ? session.model : (llm.models?.[llm.provider] || '')

        const assistantMessage = {
          id: uuidv4(),
          role: 'assistant',
          parentId: userMessage.id,
          activeChildId: null,
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

          // Page images for vision models (never stored; the message records
          // which pages were sent)
          const images = []
          if (getters.imagesEnabled) {
            commit('SET_STATUS', 'Rendering page images…')
            const pageIds = selectVisionPages({
              mode: rootState.settings.chat.visionPages,
              contexts: userMessage.contexts,
              visiblePages: rootGetters.visiblePages,
              viewPage: rootState.viewPage ?? rootState.currentPage,
              max: rootState.settings.chat.maxVisionPages
            })
            for (const pageId of pageIds) {
              const source = rootGetters.getPageSource(pageId)
              if (!source?.document) continue
              images.push({
                pageId,
                page: rootGetters.visiblePages.indexOf(pageId) + 1,
                dataUrl: await renderPageImage(source.document, source.actualPage)
              })
            }
          }
          commit('UPDATE_MESSAGE', {
            sessionId,
            messageId: userMessage.id,
            patch: { images: images.map(({ page, pageId }) => ({ page, pageId })) }
          })

          messages = buildRequestMessages({
            systemTemplate: llm.systemTemplate,
            userTemplate: llm.userTemplate,
            title: String(rootState.pdfPath || 'document').split(/[\\/]/).pop(),
            documentText: doc.text,
            history,
            userMessage: { input: userMessage.content, contexts: userMessage.contexts },
            images
          })
          commit('SET_LAST_REQUEST', {
            // Text only; image token cost depends on the provider
            estimatedTokens: messages.reduce((sum, m) => sum + estimateTokens(
              typeof m.content === 'string' ? m.content : m.content.filter(p => p.type === 'text').map(p => p.text).join('\n')
            ), 0),
            images: images.length,
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
          temperature: llm.temperature,
          // Stable per conversation: providers such as OpenCode Go route and
          // cache prompts by it
          sessionId
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

      // Choose the model for the active session (null/empty = Settings default).
      // Remembered with the session until changed.
      async setSessionModel({ commit, getters, dispatch }, { providerId = null, model = null } = {}) {
        let session = getters.activeSession
        if (!session) {
          await dispatch('newSession')
          session = getters.activeSession
        }
        commit('SET_SESSION_MODEL', { id: session.id, providerId, model })
        if (session.messages.length) return dispatch('persist')
      },

      // Fetch (and cache in the root store) the model list of a provider
      async loadModels({ commit, rootState }, providerId) {
        if (!ipcRenderer) return { success: false, error: 'Not running in the desktop app' }
        const provider = LLM_PROVIDERS[providerId]
        const baseUrl = rootState.settings.llm.baseUrls?.[providerId] ?? provider?.baseUrl
        const result = await ipcRenderer.invoke('llm:list-models', { providerId, baseUrl })
        if (result?.success) commit('SET_LLM_MODELS', { providerId, models: result.models }, { root: true })
        return result
      },

      // Turn page images on/off for the active session
      setSessionVision({ commit, getters, dispatch }, value) {
        const session = getters.activeSession
        if (!session) return
        commit('SET_SESSION_VISION', { id: session.id, value })
        if (session.messages.length) return dispatch('persist')
      },

      // Edit a user message and regenerate: the edited text becomes a new
      // sibling of the original (a new branch, even when unchanged) with a
      // fresh reply. The original branch is kept and can be switched back to.
      async editAndRegenerate({ commit, dispatch, state, getters }, { messageId, text, contexts }) {
        const session = getters.activeSession
        if (!session || state.streaming) return false
        const original = session.messages.find(m => m.id === messageId)
        if (!original || original.role !== 'user') return false
        const input = String(text || '').trim()
        const keptContexts = clone(contexts ?? original.contexts ?? [])
        if (!input && keptContexts.length === 0) return false
        if (!getters.sessionModel.model) {
          commit('SET_NOTICE', 'Choose a provider and model in Settings → AI Chat first.')
          return false
        }
        commit('SET_NOTICE', '')

        const edited = {
          id: uuidv4(),
          role: 'user',
          parentId: original.parentId ?? null,
          activeChildId: null,
          content: input,
          contexts: keptContexts,
          created: now()
        }
        commit('ADD_MESSAGE', { sessionId: session.id, message: edited })
        return dispatch('generateReply', { sessionId: session.id, userMessageId: edited.id })
      },

      // Show the branch containing a message (keeps where the user last was below it)
      switchBranch({ commit, dispatch, state, getters }, messageId) {
        const session = getters.activeSession
        if (!session || state.streaming) return false
        const updates = pointersToShow(session, messageId)
        if (updates.length === 0) return false
        for (const { parentId, childId } of updates) {
          commit('SET_ACTIVE_CHILD', { sessionId: session.id, parentId, childId })
        }
        dispatch('persist')
        return true
      },

      // Step to the previous (-1) or next (+1) alternative at a fork
      switchSibling({ dispatch, getters }, { messageId, offset }) {
        const session = getters.activeSession
        const message = session?.messages.find(m => m.id === messageId)
        const siblings = siblingsOf(session, message)
        const index = siblings.findIndex(m => m.id === messageId)
        const target = siblings[index + offset]
        return target ? dispatch('switchBranch', target.id) : false
      },

      // Delete one alternative at a fork (with everything below it). Only
      // allowed when another alternative remains, so the conversation itself
      // is never removed this way.
      deleteBranch({ commit, dispatch, state, getters }, messageId) {
        const session = getters.activeSession
        if (!session || state.streaming) return false
        const message = session.messages.find(m => m.id === messageId)
        const siblings = siblingsOf(session, message)
        if (!message || siblings.length < 2) return false
        const index = siblings.findIndex(m => m.id === messageId)
        const neighbour = siblings[index - 1] || siblings[index + 1]
        const wasShown = activePath(session).some(m => m.id === messageId)
        commit('REMOVE_MESSAGES', { sessionId: session.id, ids: [...subtreeIds(session, messageId)] })
        if (wasShown) {
          commit('SET_ACTIVE_CHILD', { sessionId: session.id, parentId: message.parentId ?? null, childId: neighbour.id })
        }
        dispatch('persist')
        return true
      },

      // Retry the last reply of the visible branch in place (no new branch).
      // Used for failed or stopped replies; Regenerate creates a branch instead.
      retry({ commit, dispatch, state, getters }, { withoutImages = false } = {}) {
        const session = getters.activeSession
        if (!session || state.streaming) return false
        if (withoutImages) commit('SET_SESSION_VISION', { id: session.id, value: false })
        const path = activePath(session)
        const last = path[path.length - 1]
        const previous = path[path.length - 2]
        if (last?.role !== 'assistant' || previous?.role !== 'user') return false
        commit('REMOVE_MESSAGES', { sessionId: session.id, ids: [last.id] })
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
