<template>
  <aside
    class="chat-panel"
    :class="{ fullscreen, resizing }"
    :style="fullscreen ? null : { width: `${width}px` }"
    aria-label="Chat"
  >
    <div
      v-if="!fullscreen"
      class="chat-resizer"
      title="Drag to resize"
      @mousedown.prevent="startResize"
      @dblclick="resetWidth"
    />

    <header class="chat-header">
      <button
        class="chat-session-toggle"
        :class="{ open: showSessions }"
        title="Sessions"
        @click="showSessions = !showSessions"
      >
        <svg
          viewBox="0 0 16 16"
          aria-hidden="true"
        ><path d="M2.5 4h11M2.5 8h11M2.5 12h7" /></svg>
        <span class="chat-session-name">{{ activeSession ? activeSession.title : 'New chat' }}</span>
        <svg
          class="chat-caret"
          viewBox="0 0 16 16"
          aria-hidden="true"
        ><path d="M4.5 6.5L8 10l3.5-3.5" /></svg>
      </button>

      <div class="chat-header-actions">
        <button
          class="chat-icon-btn"
          title="New session"
          @click="newSession"
        >
          <svg
            viewBox="0 0 16 16"
            aria-hidden="true"
          ><path d="M8 3.5v9M3.5 8h9" /></svg>
        </button>
        <button
          class="chat-icon-btn"
          :title="fullscreen ? 'Exit full screen (Esc)' : 'Full screen'"
          @click="toggleFullscreen"
        >
          <svg
            v-if="!fullscreen"
            viewBox="0 0 16 16"
            aria-hidden="true"
          ><path d="M3 6.5V3h3.5M13 6.5V3H9.5M3 9.5V13h3.5M13 9.5V13H9.5" /></svg>
          <svg
            v-else
            viewBox="0 0 16 16"
            aria-hidden="true"
          ><path d="M6.5 3v3.5H3M9.5 3v3.5H13M6.5 13V9.5H3M9.5 13V9.5H13" /></svg>
        </button>
        <button
          class="chat-icon-btn"
          title="Close chat (Ctrl+Shift+L)"
          @click="$emit('close')"
        >
          <svg
            viewBox="0 0 16 16"
            aria-hidden="true"
          ><path d="M4 4l8 8M12 4l-8 8" /></svg>
        </button>
      </div>
    </header>

    <ChatSessionList
      v-if="showSessions"
      :sessions="sortedSessions"
      :active-id="activeSessionId"
      @select="selectSession"
      @new="newSession"
      @rename="renameSession"
      @delete="deleteSession"
    />

    <div
      ref="scroller"
      class="chat-messages"
      @scroll="onScroll"
    >
      <div class="chat-messages-inner">
        <!-- Empty states -->
        <div
          v-if="!hasModel"
          class="chat-empty"
        >
          <p class="chat-empty-title">
            Connect a model to start chatting
          </p>
          <p class="chat-empty-text">
            Use OpenRouter, OpenAI, a local Ollama or LM Studio server, or any OpenAI-compatible API.
          </p>
          <button
            class="btn btn-primary"
            @click="$emit('open-settings')"
          >
            Open AI settings
          </button>
        </div>
        <div
          v-else-if="messages.length === 0"
          class="chat-empty"
        >
          <p class="chat-empty-title">
            Ask about {{ documentTitle }}
          </p>
          <p class="chat-empty-text">
            The document's text is included automatically. Select text or click a note to attach it as context.
          </p>
          <div class="chat-suggestions">
            <button
              v-for="suggestion in suggestions"
              :key="suggestion"
              class="chat-suggestion"
              @click="send(suggestion)"
            >
              {{ suggestion }}
            </button>
          </div>
        </div>

        <ChatMessage
          v-for="(message, index) in messages"
          :key="message.id"
          :message="message"
          :is-last="index === messages.length - 1"
          :editing="editingId === message.id"
          :locked="isStreaming"
          :sibling-index="branchInfo(message).index"
          :sibling-count="branchInfo(message).count"
          @retry="retry"
          @regenerate="startEdit(message.parentId)"
          @edit="startEdit(message.id)"
          @submit-edit="submitEdit(message.id, $event)"
          @cancel-edit="cancelEdit"
          @switch-branch="switchBranch(message.id, $event)"
          @delete-branch="deleteBranch(message.id)"
          @open-context="openContext"
        />
      </div>
    </div>

    <div
      v-if="notice"
      class="chat-notice"
    >
      <span>{{ notice }}</span>
      <button
        class="chat-notice-close"
        title="Dismiss"
        @click="dismissNotice"
      >
        ×
      </button>
    </div>

    <footer class="chat-composer">
      <!-- Context for the next message: pending selection (dashed) and attached chips -->
      <div
        v-if="pendingContext || attachedContexts.length"
        class="chat-context-tray"
      >
        <div
          v-for="context in attachedContexts"
          :key="context.id"
          class="chat-chip attached"
          :title="context.text"
        >
          <span class="chat-chip-kind">{{ context.kind === 'note' ? 'Note' : 'Text' }}</span>
          <span class="chat-chip-page">p. {{ context.page }}</span>
          <span class="chat-chip-text">{{ context.text }}</span>
          <button
            class="chat-chip-btn"
            title="Remove"
            @click="removeContext(context.id)"
          >
            <svg
              viewBox="0 0 16 16"
              aria-hidden="true"
            ><path d="M5 5l6 6M11 5l-6 6" /></svg>
          </button>
        </div>
        <div
          v-if="pendingContext"
          :key="pendingContext.id"
          class="chat-chip pending"
          :title="`Attach to your next message:\n${pendingContext.text}`"
          role="button"
          tabindex="0"
          @click="attachContext"
          @keydown.enter.prevent="attachContext"
        >
          <span
            class="chat-chip-add"
            aria-hidden="true"
          >
            <svg viewBox="0 0 16 16"><path d="M8 4v8M4 8h8" /></svg>
          </span>
          <span class="chat-chip-kind">{{ pendingContext.kind === 'note' ? 'Note' : 'Selection' }}</span>
          <span class="chat-chip-page">p. {{ pendingContext.page }}</span>
          <span class="chat-chip-text">{{ pendingContext.text }}</span>
          <button
            class="chat-chip-btn"
            title="Dismiss"
            @click.stop="dismissPending"
          >
            <svg
              viewBox="0 0 16 16"
              aria-hidden="true"
            ><path d="M5 5l6 6M11 5l-6 6" /></svg>
          </button>
        </div>
      </div>
      <div
        class="chat-input-wrap"
        :class="{ disabled: !hasModel }"
      >
        <textarea
          ref="input"
          v-model="draft"
          class="chat-input"
          rows="1"
          :placeholder="hasModel ? 'Ask about this document…' : 'Choose a model below or in Settings'"
          :disabled="!hasModel"
          @input="autoGrow"
          @keydown="onComposerKeydown"
        />
        <button
          v-if="hasModel && modelVision !== false"
          class="chat-vision-toggle"
          :class="{ on: imagesEnabled, unknown: modelVision === null }"
          :title="visionTitle"
          :aria-pressed="imagesEnabled"
          @click="toggleImages"
        >
          <svg
            viewBox="0 0 16 16"
            aria-hidden="true"
          ><rect
            x="2.5"
            y="3.5"
            width="11"
            height="9"
            rx="1"
          /><path d="M2.5 10.5l3-3 3 3 2-2 3 3" /></svg>
        </button>
        <button
          v-if="isStreaming"
          class="chat-send stop"
          title="Stop generating"
          @click="stop"
        >
          <svg
            viewBox="0 0 16 16"
            aria-hidden="true"
          ><rect
            x="4.5"
            y="4.5"
            width="7"
            height="7"
            rx="1"
          /></svg>
        </button>
        <button
          v-else
          class="chat-send"
          title="Send (Enter)"
          :disabled="!canSend"
          @click="send()"
        >
          <svg
            viewBox="0 0 16 16"
            aria-hidden="true"
          ><path d="M8 13V3.5M3.5 8L8 3.5 12.5 8" /></svg>
        </button>
      </div>
      <div class="chat-meta">
        <ChatModelPicker :disabled="isStreaming" />
        <span
          v-if="status"
          class="chat-status"
        >{{ status }}</span>
        <span
          v-else-if="lastRequest"
          class="chat-tokens"
          :class="tokenLevel"
          :title="tokenTitle"
        >
          ~{{ formatTokens(lastRequest.estimatedTokens) }}{{ contextLength ? ` / ${formatTokens(contextLength)}` : '' }} tokens{{ lastRequest.images ? ` + ${lastRequest.images} img` : '' }}{{ lastRequest.truncated ? ' · partial document' : '' }}
        </span>
        <span class="chat-hint">Shift+Enter for a new line</span>
      </div>
    </footer>
  </aside>
</template>

<script>
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { useStore } from 'vuex'
import ChatMessage from './ChatMessage.vue'
import ChatSessionList from './ChatSessionList.vue'
import ChatModelPicker from './ChatModelPicker.vue'
import { describePageRanges } from '../../utils/chatPrompt'

const MIN_WIDTH = 300
const DEFAULT_WIDTH = 420

export default {
  name: 'ChatPanel',

  components: { ChatMessage, ChatSessionList, ChatModelPicker },

  emits: ['close', 'open-settings'],

  setup() {
    const store = useStore()
    const scroller = ref(null)
    const input = ref(null)
    const draft = ref('')
    const showSessions = ref(false)
    const stickToBottom = ref(true)

    const chat = computed(() => store.state.chat)
    const activeSession = computed(() => store.getters['chat/activeSession'])
    const activeSessionId = computed(() => chat.value.activeSessionId)
    const sortedSessions = computed(() => store.getters['chat/sortedSessions'])
    // Visible branch of the session's conversation tree
    const messages = computed(() => store.getters['chat/activeMessages'])
    const isStreaming = computed(() => store.getters['chat/isStreaming'])
    const fullscreen = computed(() => chat.value.fullscreen)
    const status = computed(() => chat.value.status)
    const notice = computed(() => chat.value.notice)
    const lastRequest = computed(() => chat.value.lastRequest)

    // Session's own model if chosen, else the default from Settings
    const modelId = computed(() => store.getters['chat/sessionModel'].model)
    const hasModel = computed(() => Boolean(modelId.value))
    const documentTitle = computed(() => String(store.state.pdfPath || 'this document').split(/[\\/]/).pop())

    // --- Context chips -----------------------------------------------------
    const pendingContext = computed(() => chat.value.pendingContext)
    const attachedContexts = computed(() => chat.value.attachedContexts)
    const MAX_CONTEXT_CHARS = 6000

    const displayPage = (pageId) => store.getters.visiblePages.indexOf(pageId) + 1

    const elementOf = (node) => (node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement)

    // Text selected in the PDF's text layer becomes the pending chip. It is
    // only replaced by the next selection, not cleared when the selection
    // collapses (clicking into the chat panel always collapses it).
    const captureSelection = () => {
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return
      const container = document.querySelector('.pdf-pages-container')
      // Ctrl+A selects the whole document, which is already in the prompt
      if (!container || container.classList.contains('pdf-select-all-mode')) return
      const start = elementOf(selection.getRangeAt(0).startContainer)
      if (!start?.closest('.textLayer')) return
      const pageId = Number(start.closest('.pdf-page-wrapper')?.dataset.page)
      if (!pageId) return

      let text = selection.toString().replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim()
      if (!text) return
      if (text.length > MAX_CONTEXT_CHARS) text = `${text.slice(0, MAX_CONTEXT_CHARS)}…`
      const pending = pendingContext.value
      if (pending?.kind === 'text' && pending.text === text && pending.pageId === pageId) return
      store.dispatch('chat/setPendingContext', { kind: 'text', page: displayPage(pageId), pageId, text })
    }

    let selectionTimer = null
    const onSelectionChange = () => {
      clearTimeout(selectionTimer)
      selectionTimer = setTimeout(captureSelection, 250)
    }
    document.addEventListener('selectionchange', onSelectionChange)

    // Selecting a note (with content) offers it as context too
    const findNotePage = (id) => {
      for (const [pageId, notes] of Object.entries(store.state.annotations)) {
        if (notes.some(n => n.id === id)) return Number(pageId)
      }
      return null
    }

    watch(
      () => {
        const id = store.state.selectedAnnotation
        const note = id ? store.getters.annotationById(id) : null
        return note ? `${id}\u0000${note.content}` : null
      },
      (key) => {
        if (!key) return
        const [noteId, content] = key.split('\u0000')
        const text = content.trim()
        if (!text || attachedContexts.value.some(c => c.noteId === noteId)) return
        const pageId = findNotePage(noteId)
        store.dispatch('chat/setPendingContext', { kind: 'note', noteId, page: displayPage(pageId), pageId, text })
      }
    )

    const attachContext = () => {
      store.dispatch('chat/attachPendingContext')
      input.value?.focus()
    }
    const dismissPending = () => store.dispatch('chat/setPendingContext', null)
    const removeContext = (id) => store.dispatch('chat/removeAttachedContext', id)

    // --- Page images (vision) -----------------------------------------------
    const modelVision = computed(() => store.getters['chat/modelVision'])
    const imagesEnabled = computed(() => store.getters['chat/imagesEnabled'])
    const visionTitle = computed(() => {
      const chatSettings = store.state.settings.chat
      const which = chatSettings.visionPages === 'all'
        ? `all pages (up to ${chatSettings.maxVisionPages})`
        : `pages of attached context, or the page in view (up to ${chatSettings.maxVisionPages})`
      const state = imagesEnabled.value ? `On: sends ${which} as images.` : 'Off: text only.'
      const unknown = modelVision.value === null ? ' This model does not report image support.' : ''
      return `Page images for this session. ${state}${unknown} Click to turn ${imagesEnabled.value ? 'off' : 'on'}.`
    })
    const toggleImages = () => store.dispatch('chat/setSessionVision', !imagesEnabled.value)

    const canSend = computed(() => hasModel.value && !isStreaming.value &&
      (draft.value.trim().length > 0 || chat.value.attachedContexts.length > 0))

    const suggestions = [
      'Summarize this document',
      'Explain the key ideas on the current page',
      'What are the main conclusions?'
    ]

    // --- Sending -----------------------------------------------------------
    const autoGrow = () => {
      const el = input.value
      if (!el) return
      el.style.height = 'auto'
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`
    }

    const send = async (text) => {
      const content = text ?? draft.value
      if (!hasModel.value || isStreaming.value) return
      if (!content.trim() && chat.value.attachedContexts.length === 0) return
      if (text === undefined) {
        draft.value = ''
        await nextTick()
        autoGrow()
      }
      stickToBottom.value = true
      await store.dispatch('chat/sendMessage', { text: content })
    }

    const stop = () => store.dispatch('chat/stop')
    const retry = (options) => {
      stickToBottom.value = true
      store.dispatch('chat/retry', options)
    }

    // Enter sends, Shift+Enter is a newline; ignore Enter while an IME
    // (Chinese/Japanese/Korean input) is still composing
    const onComposerKeydown = (event) => {
      if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return
      if (event.isComposing || event.keyCode === 229) return
      event.preventDefault()
      send()
    }

    // --- Edit & regenerate, branches ---------------------------------------
    // Only one message is edited at a time; the edit box cancels itself on
    // Esc, on clicks outside it and when focus moves to another text field.
    const editingId = ref(null)

    const startEdit = (messageId) => {
      if (isStreaming.value || !messageId) return
      editingId.value = messageId
    }
    const cancelEdit = () => { editingId.value = null }
    const submitEdit = async (messageId, { text, contexts }) => {
      editingId.value = null
      stickToBottom.value = true
      await store.dispatch('chat/editAndRegenerate', { messageId, text, contexts })
    }

    // Alternatives at each message's fork: { index (1-based), count }
    const branchInfo = (message) => {
      const session = activeSession.value
      if (!session || message.role !== 'user') return { index: 1, count: 1 }
      const siblings = session.messages.filter(m => m.role === 'user' && (m.parentId ?? null) === (message.parentId ?? null))
      return { index: siblings.findIndex(m => m.id === message.id) + 1, count: siblings.length }
    }
    const switchBranch = (messageId, offset) => {
      cancelEdit()
      store.dispatch('chat/switchSibling', { messageId, offset })
    }
    const deleteBranch = (messageId) => {
      cancelEdit()
      store.dispatch('chat/deleteBranch', messageId)
    }

    // An edit never survives a session switch or its message leaving the view
    watch(activeSessionId, cancelEdit)
    watch(messages, (list) => {
      if (editingId.value && !list.some(m => m.id === editingId.value)) cancelEdit()
    })
    const dismissNotice = () => store.commit('chat/SET_NOTICE', '')

    // --- Sessions ----------------------------------------------------------
    const newSession = async () => {
      if (isStreaming.value) await stop()
      await store.dispatch('chat/newSession')
      showSessions.value = false
      input.value?.focus()
    }
    const selectSession = (id) => {
      store.dispatch('chat/selectSession', id)
      showSessions.value = false
      stickToBottom.value = true
      scrollToBottom()
    }
    const renameSession = (payload) => store.dispatch('chat/renameSession', payload)
    const deleteSession = (id) => store.dispatch('chat/deleteSession', id)

    // Jump back to where an attached context came from
    const openContext = (context) => {
      if (context.pageId) store.commit('REQUEST_PAGE_SCROLL', context.pageId)
      if (context.kind === 'note' && context.noteId) store.dispatch('selectAnnotation', context.noteId)
      if (fullscreen.value) store.dispatch('chat/setFullscreen', false)
    }

    // --- Scrolling ---------------------------------------------------------
    const scrollToBottom = async () => {
      await nextTick()
      const el = scroller.value
      if (el) el.scrollTop = el.scrollHeight
    }

    const onScroll = () => {
      const el = scroller.value
      if (!el) return
      stickToBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    }

    // Follow streaming output unless the user scrolled up to read
    watch(
      () => {
        const last = messages.value[messages.value.length - 1]
        return [messages.value.length, last?.content.length, last?.reasoning?.length, last?.error]
      },
      () => { if (stickToBottom.value) scrollToBottom() }
    )
    watch(activeSessionId, scrollToBottom)

    // --- Full screen -------------------------------------------------------
    const toggleFullscreen = () => store.dispatch('chat/setFullscreen', !fullscreen.value)

    // --- Resizing ----------------------------------------------------------
    const width = ref(store.state.settings.chat.panelWidth || DEFAULT_WIDTH)
    const resizing = ref(false)
    watch(() => store.state.settings.chat.panelWidth, (value) => {
      if (!resizing.value && value) width.value = value
    })

    const maxWidth = () => Math.max(MIN_WIDTH, Math.min(window.innerWidth * 0.7, window.innerWidth - 360))
    const clampWidth = (value) => Math.round(Math.min(maxWidth(), Math.max(MIN_WIDTH, value)))

    const saveWidth = () => {
      store.commit('SET_SETTING', { path: 'chat.panelWidth', value: width.value })
      store.dispatch('saveSettings')
    }

    const onResizeMove = (event) => {
      width.value = clampWidth(window.innerWidth - event.clientX)
    }

    const stopResize = () => {
      resizing.value = false
      document.body.classList.remove('chat-resizing')
      window.removeEventListener('mousemove', onResizeMove)
      window.removeEventListener('mouseup', stopResize)
      saveWidth()
    }

    const startResize = () => {
      resizing.value = true
      document.body.classList.add('chat-resizing')
      window.addEventListener('mousemove', onResizeMove)
      window.addEventListener('mouseup', stopResize)
    }

    const resetWidth = () => {
      width.value = clampWidth(DEFAULT_WIDTH)
      saveWidth()
    }

    // Keep the panel inside the window when the window shrinks
    const onWindowResize = () => { width.value = clampWidth(width.value) }
    window.addEventListener('resize', onWindowResize)

    onUnmounted(() => {
      document.removeEventListener('selectionchange', onSelectionChange)
      clearTimeout(selectionTimer)
      window.removeEventListener('resize', onWindowResize)
      if (resizing.value) stopResize()
    })

    // --- Formatting --------------------------------------------------------
    const formatTokens = (n) => {
      if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
      if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`
      return `${n}`
    }
    // Context window of the selected model, when the provider reports it
    const contextLength = computed(() => store.getters['chat/sessionModelInfo']?.contextLength || null)
    const tokenLevel = computed(() => {
      if (!lastRequest.value || !contextLength.value) return ''
      const ratio = lastRequest.value.estimatedTokens / contextLength.value
      return ratio > 1 ? 'over' : ratio > 0.8 ? 'near' : ''
    })
    const tokenTitle = computed(() => {
      const info = lastRequest.value
      if (!info) return ''
      const pages = info.truncated
        ? `Pages ${describePageRanges(info.includedPages)} of ${info.totalPages} were included (document text budget reached).`
        : `All ${info.totalPages} pages were included.`
      const limit = tokenLevel.value === 'over'
        ? ' This is more than the model\'s context window: lower the document text budget in Settings or start a new session.'
        : tokenLevel.value === 'near' ? ' This is close to the model\'s context window.' : ''
      return `Estimated text size of the last request (images not counted). ${pages}${limit}`
    })

    scrollToBottom()

    return {
      onComposerKeydown,
      editingId,
      startEdit,
      cancelEdit,
      submitEdit,
      branchInfo,
      switchBranch,
      deleteBranch,
      modelVision,
      imagesEnabled,
      visionTitle,
      toggleImages,
      pendingContext,
      attachedContexts,
      attachContext,
      dismissPending,
      removeContext,
      scroller,
      input,
      draft,
      showSessions,
      activeSession,
      activeSessionId,
      sortedSessions,
      messages,
      isStreaming,
      fullscreen,
      status,
      notice,
      lastRequest,
      modelId,
      hasModel,
      documentTitle,
      canSend,
      suggestions,
      width,
      resizing,
      autoGrow,
      send,
      stop,
      retry,
      dismissNotice,
      newSession,
      selectSession,
      renameSession,
      deleteSession,
      openContext,
      onScroll,
      toggleFullscreen,
      startResize,
      resetWidth,
      formatTokens,
      tokenTitle,
      tokenLevel,
      contextLength
    }
  }
}
</script>

<style scoped>
.chat-panel {
  position: relative;
  flex: none;
  display: flex;
  flex-direction: column;
  min-width: 300px;
  height: 100%;
  background: var(--bg-color);
  border-left: 1px solid var(--border-color);
}

.chat-panel.fullscreen {
  position: fixed;
  inset: 0;
  z-index: 500;
  width: auto;
  border-left: none;
}

.chat-panel.fullscreen .chat-messages-inner,
.chat-panel.fullscreen .chat-composer > * {
  width: 100%;
  max-width: 820px;
  margin-left: auto;
  margin-right: auto;
}

.chat-resizer {
  position: absolute;
  top: 0;
  bottom: 0;
  left: -3px;
  width: 6px;
  cursor: col-resize;
  z-index: 30;
}

.chat-resizer:hover,
.chat-panel.resizing .chat-resizer {
  background: var(--primary-color);
  opacity: 0.4;
}

/* Header */
.chat-header {
  flex: none;
  height: 48px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 8px 0 10px;
  background: var(--sidebar-bg);
  border-bottom: 1px solid var(--border-color);
}

.chat-session-toggle {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: none;
  color: var(--text-color);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.chat-session-toggle:hover,
.chat-session-toggle.open {
  border-color: var(--border-color);
  background: var(--annotation-bg);
}

.chat-session-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-header-actions {
  display: flex;
  gap: 2px;
}

.chat-icon-btn {
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 6px;
  background: none;
  color: var(--text-muted);
  cursor: pointer;
}

.chat-icon-btn:hover {
  background: var(--border-color);
  color: var(--text-color);
}

.chat-panel svg {
  width: 16px;
  height: 16px;
  flex: none;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.4;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.chat-caret {
  width: 12px !important;
  height: 12px !important;
  color: var(--text-muted);
}

/* Messages */
.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px 14px;
}

.chat-messages-inner {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.chat-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  margin-top: 12vh;
  padding: 0 12px;
  text-align: center;
}

.chat-empty-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-color);
  overflow-wrap: anywhere;
}

.chat-empty-text {
  margin: 0 0 8px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-muted);
}

.chat-suggestions {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
  max-width: 320px;
}

.chat-suggestion {
  padding: 8px 10px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--annotation-bg);
  color: var(--text-color);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.chat-suggestion:hover {
  border-color: var(--primary-color);
}

.chat-notice {
  flex: none;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 0 12px 8px;
  padding: 8px 10px;
  border: 1px solid var(--warning-color);
  border-radius: 6px;
  background: rgba(245, 158, 11, 0.08);
  color: var(--text-color);
  font-size: 12px;
}

.chat-notice span {
  flex: 1;
}

.chat-notice-close {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}

/* Context chips */
.chat-context-tray {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 6px;
  max-height: 140px;
  overflow-y: auto;
}

.chat-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  padding: 3px 4px 3px 8px;
  border-radius: 6px;
  font-size: 12px;
  color: var(--text-color);
  animation: chat-chip-in 0.16s ease-out;
}

.chat-chip.attached {
  border: 1px solid var(--border-color);
  border-left: 3px solid var(--primary-color);
  background: var(--annotation-bg);
  box-shadow: var(--shadow-sm);
}

.chat-chip.pending {
  border: 1px dashed var(--text-muted);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  padding-left: 4px;
}

.chat-chip.pending:hover,
.chat-chip.pending:focus-visible {
  border-color: var(--primary-color);
  color: var(--text-color);
  outline: none;
}

.chat-chip-add {
  flex: none;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  background: var(--primary-color);
  color: #fff;
}

.chat-chip-add svg {
  width: 12px !important;
  height: 12px !important;
  stroke-width: 2 !important;
}

.chat-chip-kind {
  flex: none;
  font-weight: 600;
  font-size: 11px;
}

.chat-chip.attached .chat-chip-kind {
  color: var(--primary-color);
}

.chat-chip-page {
  flex: none;
  font-size: 11px;
  color: var(--text-muted);
}

.chat-chip-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-chip-btn {
  flex: none;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 4px;
  background: none;
  color: var(--text-muted);
  cursor: pointer;
}

.chat-chip-btn:hover {
  background: var(--border-color);
  color: var(--text-color);
}

.chat-chip-btn svg {
  width: 12px !important;
  height: 12px !important;
}

@keyframes chat-chip-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: none; }
}

/* Composer */
.chat-composer {
  flex: none;
  padding: 8px 12px 10px;
  border-top: 1px solid var(--border-color);
  background: var(--bg-color);
}

.chat-input-wrap {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  padding: 6px 6px 6px 10px;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: var(--annotation-bg);
}

.chat-input-wrap:focus-within {
  border-color: var(--primary-color);
}

.chat-input-wrap.disabled {
  opacity: 0.6;
}

.chat-input {
  flex: 1;
  min-height: 24px;
  max-height: 200px;
  padding: 3px 0;
  border: none;
  outline: none;
  resize: none;
  background: transparent;
  color: var(--text-color);
  font: inherit;
  font-size: 13px;
  line-height: 1.5;
}

.chat-vision-toggle {
  flex: none;
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  border-radius: 8px;
  background: none;
  color: var(--text-muted);
  cursor: pointer;
}

.chat-vision-toggle:hover {
  background: var(--sidebar-bg);
}

.chat-vision-toggle.on {
  color: var(--primary-color);
  border-color: var(--primary-color);
  background: var(--selection-color);
}

.chat-vision-toggle.on.unknown {
  color: var(--warning-color);
  border-color: var(--warning-color);
  background: rgba(245, 158, 11, 0.1);
}

.chat-send {
  flex: none;
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 8px;
  background: var(--primary-color);
  color: #fff;
  cursor: pointer;
}

.chat-send:disabled {
  background: var(--border-color);
  color: var(--text-muted);
  cursor: default;
}

.chat-send.stop {
  background: var(--text-color);
  color: var(--bg-color);
}

.chat-send.stop svg {
  fill: currentColor;
  stroke: none;
}

.chat-meta {
  display: flex;
  gap: 8px;
  margin-top: 6px;
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
}

.chat-model,
.chat-status {
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.chat-status {
  color: var(--primary-color);
}

.chat-tokens.near {
  color: var(--warning-color);
}

.chat-tokens.over {
  color: var(--danger-color);
  font-weight: 600;
}

.chat-hint {
  margin-left: auto;
}
</style>

<style>
/* While dragging the resizer, keep the col-resize cursor everywhere and stop
   text selection in the PDF */
body.chat-resizing,
body.chat-resizing * {
  cursor: col-resize !important;
  user-select: none !important;
}
</style>
