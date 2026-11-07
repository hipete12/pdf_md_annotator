<template>
  <section
    class="doc-viewer"
    :style="{ width: `${ratio * 100}%` }"
    aria-label="Document"
  >
    <div
      class="doc-resizer"
      title="Drag to resize · double-click to reset"
      @mousedown.prevent="startResize"
      @dblclick="resetRatio"
    />

    <header class="doc-toolbar">
      <svg
        class="doc-toolbar-icon"
        viewBox="0 0 16 16"
        aria-hidden="true"
      ><path d="M4 1.5h5.5l3 3v10H4z M9.5 1.5v3h3 M6 8h4.5 M6 10.5h4.5" /></svg>
      <span
        class="doc-name"
        :title="docName"
      >{{ docName || 'Document' }}</span>
      <span
        v-if="html"
        class="doc-badge"
        :class="{ ran: ranCode }"
        :title="ranCode ? 'Code cells were run when rendering' : 'Code cells are shown but were not run'"
      >{{ ranCode ? 'Code run' : 'Code not run' }}</span>
      <span class="doc-spacer" />
      <button
        class="doc-btn"
        :disabled="rendering"
        title="Render again"
        @click="render(ranCode)"
      >
        <svg
          viewBox="0 0 16 16"
          aria-hidden="true"
        ><path d="M13 8a5 5 0 1 1-1.5-3.5M13 2.5v3h-3" /></svg>
      </button>
      <button
        v-if="!ranCode"
        class="doc-btn doc-btn-text"
        :disabled="rendering"
        title="Render and run the code cells (/open run)"
        @click="render(true)"
      >
        <svg
          viewBox="0 0 16 16"
          aria-hidden="true"
        ><path d="M5 3.5l7 4.5-7 4.5z" /></svg>
        Run code
      </button>
      <button
        class="doc-btn"
        title="Close (/close)"
        @click="close"
      >
        <svg
          viewBox="0 0 16 16"
          aria-hidden="true"
        ><path d="M4 4l8 8M12 4l-8 8" /></svg>
      </button>
    </header>

    <div class="doc-body">
      <iframe
        v-if="html"
        ref="frame"
        class="doc-frame"
        :class="{ dimmed: rendering }"
        title="Rendered document"
        sandbox="allow-scripts allow-popups"
        :srcdoc="html"
        @load="onFrameLoad"
      />

      <div
        v-if="rendering"
        class="doc-overlay"
      >
        <div class="doc-spinner" />
        <p>{{ runRequested ? 'Rendering and running code with Quarto…' : 'Rendering with Quarto…' }}</p>
        <button
          class="doc-link"
          @click="cancel"
        >
          Cancel
        </button>
      </div>

      <div
        v-else-if="error"
        class="doc-message"
        :class="{ error: error.code !== 'no_document' }"
      >
        <p class="doc-message-title">
          {{ errorTitle }}
        </p>
        <p class="doc-message-text">
          {{ error.message }}
        </p>
        <details
          v-if="error.log"
          class="doc-log"
        >
          <summary>Quarto output</summary>
          <pre>{{ error.log }}</pre>
        </details>
        <div class="doc-message-actions">
          <button
            v-if="error.code === 'no_quarto'"
            class="btn btn-secondary"
            @click="$emit('open-settings')"
          >
            Open Settings
          </button>
          <button
            v-if="error.code !== 'no_document'"
            class="btn btn-secondary"
            @click="render(runRequested)"
          >
            Try again
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<script>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useStore } from 'vuex'

let ipcRenderer = null
try {
  ipcRenderer = require('electron').ipcRenderer
} catch (e) {
  // Not running in Electron
}

const MIN_RATIO = 0.25
const MAX_RATIO = 0.75
const DEFAULT_RATIO = 0.5

export default {
  name: 'DocumentViewer',

  emits: ['open-settings'],

  setup() {
    const store = useStore()
    const html = ref('')
    const docName = ref('')
    const ranCode = ref(false)
    const rendering = ref(false)
    const runRequested = ref(false)
    const error = ref(null)
    const frame = ref(null)
    let renderId = 0

    const viewer = computed(() => store.state.chat.viewer)
    const chatPath = computed(() => store.state.chatPath)

    const render = async (run = false) => {
      if (!ipcRenderer || !chatPath.value) return
      const id = ++renderId
      rendering.value = true
      runRequested.value = run
      error.value = null
      const result = await ipcRenderer.invoke('doc:render', { chatPath: chatPath.value, run })
      if (id !== renderId) return // superseded by a newer render
      rendering.value = false
      if (result?.success) {
        html.value = result.html
        docName.value = result.docName
        ranCode.value = result.run
      } else if (result?.code === 'cancelled') {
        // keep what was shown before
      } else {
        error.value = { code: result?.code || 'render', message: result?.error || 'Rendering failed', log: result?.log || '' }
        if (result?.code === 'no_document') html.value = ''
      }
    }

    const cancel = async () => {
      renderId++
      rendering.value = false
      if (ipcRenderer) await ipcRenderer.invoke('doc:render-cancel')
    }

    const close = () => store.commit('chat/SET_VIEWER', { open: false })

    const errorTitle = computed(() => ({
      no_document: 'No document yet',
      no_quarto: 'Quarto is not installed',
      timeout: 'Rendering took too long'
    }[error.value?.code] || 'Could not render the document'))

    // Every /open (nonce) renders; a new /generate re-renders without code
    watch(() => viewer.value.nonce, () => {
      if (viewer.value.open) render(viewer.value.run)
    }, { immediate: true })
    watch(() => store.state.chat.docVersion, () => {
      if (viewer.value.open) render(false)
    })

    // --- Selections for the chat --------------------------------------------
    // The frame's bridge script (prepareForViewer) posts selected text; it is
    // handed to the chat panel as a "Report" chip. Only messages from this
    // frame count, and only the expected fields are passed on.
    const MAX_SELECTION_CHARS = 20000
    const onMessage = (event) => {
      const data = event.data
      if (!frame.value || event.source !== frame.value.contentWindow) return
      if (!data || data.source !== 'pdfmd-viewer' || data.type !== 'selection') return
      if (typeof data.text !== 'string' || !data.text.trim()) return
      window.dispatchEvent(new CustomEvent('chat:report-selection', {
        detail: {
          text: data.text.slice(0, MAX_SELECTION_CHARS),
          section: typeof data.section === 'string' ? data.section.slice(0, 200) : '',
          sectionId: typeof data.sectionId === 'string' ? data.sectionId.slice(0, 200) : ''
        }
      }))
    }

    // Clicking a Report chip scrolls to its section, once the page has loaded
    let frameLoaded = false
    let pendingReveal = null
    const postReveal = (sectionId) => {
      frame.value?.contentWindow?.postMessage({ source: 'pdfmd-app', type: 'reveal', sectionId }, '*')
    }
    const onReveal = (event) => {
      const sectionId = event.detail?.sectionId
      if (!sectionId) return
      if (frameLoaded && !rendering.value) postReveal(sectionId)
      else pendingReveal = sectionId
    }
    const onFrameLoad = () => {
      frameLoaded = true
      if (pendingReveal) postReveal(pendingReveal)
      pendingReveal = null
    }
    watch(html, () => { frameLoaded = false })

    onMounted(() => {
      window.addEventListener('message', onMessage)
      window.addEventListener('chat:report-reveal', onReveal)
    })

    // --- Resizing (share of the window, saved in settings) -----------------
    const ratio = ref(store.state.settings.chat.docPaneRatio || DEFAULT_RATIO)
    const clamp = (value) => Math.min(MAX_RATIO, Math.max(MIN_RATIO, value))
    const save = () => {
      store.commit('SET_SETTING', { path: 'chat.docPaneRatio', value: Math.round(ratio.value * 1000) / 1000 })
      store.dispatch('saveSettings')
    }
    const onMove = (event) => {
      ratio.value = clamp(1 - event.clientX / window.innerWidth)
    }
    const stopResize = () => {
      document.body.classList.remove('doc-resizing')
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', stopResize)
      save()
    }
    const startResize = () => {
      // The iframe would swallow mouse events while dragging over it
      document.body.classList.add('doc-resizing')
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', stopResize)
    }
    const resetRatio = () => {
      ratio.value = DEFAULT_RATIO
      save()
    }
    onUnmounted(() => {
      window.removeEventListener('message', onMessage)
      window.removeEventListener('chat:report-reveal', onReveal)
      if (document.body.classList.contains('doc-resizing')) stopResize()
      if (rendering.value) cancel()
    })

    return {
      html, docName, ranCode, rendering, runRequested, error, errorTitle, frame, onFrameLoad,
      render, cancel, close, ratio, startResize, resetRatio
    }
  }
}
</script>

<style scoped>
.doc-viewer {
  position: relative;
  flex: none;
  display: flex;
  flex-direction: column;
  min-width: 320px;
  height: 100%;
  background: var(--bg-color);
  border-left: 1px solid var(--border-color);
}

.doc-resizer {
  position: absolute;
  top: 0;
  bottom: 0;
  left: -3px;
  width: 6px;
  cursor: col-resize;
  z-index: 2;
}

.doc-resizer:hover {
  background: var(--primary-color);
  opacity: 0.4;
}

:global(body.doc-resizing) {
  cursor: col-resize;
  user-select: none;
}

:global(body.doc-resizing) .doc-frame {
  pointer-events: none;
}

.doc-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 49px;
  padding: 0 10px 0 14px;
  border-bottom: 1px solid var(--border-color);
  background: var(--sidebar-bg);
}

.doc-toolbar-icon {
  flex: none;
  width: 16px;
  height: 16px;
  fill: none;
  stroke: var(--text-muted);
  stroke-width: 1.2;
  stroke-linejoin: round;
}

.doc-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-color);
}

.doc-badge {
  flex: none;
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid var(--border-color);
  font-size: 11px;
  color: var(--text-muted);
}

.doc-badge.ran {
  border-color: var(--warning-color);
  color: var(--warning-color);
}

.doc-spacer {
  flex: 1;
}

.doc-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  min-width: 28px;
  justify-content: center;
  padding: 0 6px;
  border: none;
  border-radius: 6px;
  background: none;
  color: var(--text-muted);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.doc-btn:hover:not(:disabled) {
  background: var(--border-color);
  color: var(--text-color);
}

.doc-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.doc-btn svg {
  width: 15px;
  height: 15px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.4;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.doc-btn-text {
  padding: 0 10px 0 8px;
  border: 1px solid var(--border-color);
}

.doc-body {
  position: relative;
  flex: 1;
  min-height: 0;
  background: #ffffff;
}

.doc-frame {
  width: 100%;
  height: 100%;
  border: none;
  display: block;
  background: #ffffff;
  transition: opacity 0.2s;
}

.doc-frame.dimmed {
  opacity: 0.35;
}

.doc-overlay,
.doc-message {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 24px;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
}

.doc-message {
  background: var(--bg-color);
}

.doc-spinner {
  width: 26px;
  height: 26px;
  border: 3px solid var(--border-color);
  border-top-color: var(--primary-color);
  border-radius: 50%;
  animation: doc-spin 0.8s linear infinite;
}

@keyframes doc-spin {
  to { transform: rotate(360deg); }
}

.doc-message-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-color);
}

.doc-message.error .doc-message-title {
  color: var(--danger-color);
}

.doc-message-text {
  max-width: 460px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.doc-log {
  width: min(560px, 100%);
  text-align: left;
}

.doc-log summary {
  cursor: pointer;
  font-size: 12px;
}

.doc-log pre {
  margin-top: 6px;
  max-height: 240px;
  overflow: auto;
  padding: 10px;
  border-radius: 6px;
  background: var(--sidebar-bg);
  color: var(--text-color);
  font-size: 11px;
  white-space: pre-wrap;
}

.doc-message-actions {
  display: flex;
  gap: 8px;
}

.doc-link {
  background: none;
  border: none;
  color: var(--primary-color);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
</style>
