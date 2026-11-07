<template>
  <div class="welcome-screen">
    <h1 class="welcome-title">
      PDF Annotator
    </h1>
    <p class="welcome-text">
      Annotate a PDF, or start a chat to work through a topic.
    </p>

    <div class="welcome-actions">
      <button
        class="welcome-card"
        @click="$emit('open-file')"
      >
        <svg
          class="welcome-card-icon"
          viewBox="0 0 24 24"
          aria-hidden="true"
        ><path d="M6 2.5h8l4.5 4.5v14.5h-12.5z M14 2.5V7h4.5 M9 12h6 M9 15.5h6" /></svg>
        <span class="welcome-card-title">Open PDF</span>
        <span class="welcome-card-text">View, annotate and chat about a document</span>
        <kbd>Ctrl+O</kbd>
      </button>
      <button
        class="welcome-card"
        @click="$emit('new-chat')"
      >
        <svg
          class="welcome-card-icon"
          viewBox="0 0 24 24"
          aria-hidden="true"
        ><path d="M4 5.5h16v10H10l-4.5 3.5v-3.5H4z M8 9.5h8 M8 12h5" /></svg>
        <span class="welcome-card-title">New chat</span>
        <span class="welcome-card-text">Explore concepts, then turn the conversation into a document</span>
        <kbd>Ctrl+N</kbd>
      </button>
    </div>
    <p class="welcome-hint">
      or drag and drop a PDF file here
    </p>

    <div
      v-if="recent.length"
      class="welcome-recent"
    >
      <h3>Recent</h3>
      <ul>
        <li
          v-for="file in recent"
          :key="file.path"
        >
          <button
            class="welcome-recent-item"
            :title="file.path"
            @click="$emit('open-recent', file.path)"
          >
            <span
              class="welcome-recent-kind"
              :class="file.kind"
            >{{ file.kind === 'chat' ? 'Chat' : 'PDF' }}</span>
            <span class="welcome-recent-name">{{ file.name }}</span>
            <span class="welcome-recent-dir">{{ folderOf(file.path) }}</span>
          </button>
        </li>
      </ul>
    </div>

    <div class="welcome-shortcuts">
      <h3>Keyboard Shortcuts</h3>
      <ul>
        <li><kbd>Ctrl+S</kbd> Save annotations</li>
        <li><kbd>Ctrl+Shift+S</kbd> Save as (PDF or chat)</li>
        <li><kbd>Ctrl+B</kbd> Bold text in a note</li>
        <li><kbd>Ctrl+H</kbd> Hide/Show annotation</li>
        <li><kbd>Ctrl+\</kbd> Toggle sidebar</li>
        <li><kbd>Ctrl+Shift+L</kbd> Toggle chat</li>
        <li><kbd>Ctrl+L</kbd> Add selection to chat</li>
      </ul>
    </div>
  </div>
</template>

<script>
import { onMounted, ref } from 'vue'

let ipcRenderer = null
try {
  ipcRenderer = require('electron').ipcRenderer
} catch (e) {
  // Outside Electron (tests)
}

const MAX_RECENT = 8

export default {
  name: 'WelcomeScreen',
  emits: ['open-file', 'new-chat', 'open-recent'],

  setup() {
    const recent = ref([])

    onMounted(async () => {
      if (!ipcRenderer) return
      try {
        const files = await ipcRenderer.invoke('get-recent-files')
        recent.value = (files || []).filter(f => f.exists).slice(0, MAX_RECENT)
      } catch (err) {
        console.warn('Could not load recent files:', err)
      }
    })

    const folderOf = (filePath) => {
      const parts = String(filePath).split(/[\\/]/)
      parts.pop()
      const folder = parts.join('/')
      return folder.length > 48 ? `…${folder.slice(-47)}` : folder
    }

    return { recent, folderOf }
  }
}
</script>

<style scoped>
.welcome-screen {
  overflow-y: auto;
  padding: 40px 16px;
  justify-content: flex-start;
}

.welcome-title {
  margin-top: 6vh;
}

.welcome-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 16px;
}

.welcome-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  width: 260px;
  padding: 20px 20px 18px;
  text-align: left;
  background: var(--annotation-bg);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  color: var(--text-color);
  font: inherit;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s, transform 0.15s;
}

.welcome-card:hover,
.welcome-card:focus-visible {
  border-color: var(--primary-color);
  box-shadow: var(--shadow-md);
  transform: translateY(-1px);
  outline: none;
}

.welcome-card-icon {
  width: 28px;
  height: 28px;
  margin-bottom: 6px;
  fill: none;
  stroke: var(--primary-color);
  stroke-width: 1.5;
  stroke-linejoin: round;
  stroke-linecap: round;
}

.welcome-card-title {
  font-size: 15px;
  font-weight: 600;
}

.welcome-card-text {
  font-size: 13px;
  color: var(--text-muted);
  line-height: 1.4;
}

.welcome-card kbd {
  position: absolute;
  top: 18px;
  right: 18px;
  font-size: 11px;
  color: var(--text-muted);
  background: var(--sidebar-bg);
  padding: 2px 6px;
  border-radius: 4px;
  font-family: 'Consolas', monospace;
}

.welcome-hint {
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 12px;
}

.welcome-recent {
  width: min(536px, 100%);
  margin-top: 32px;
}

.welcome-recent h3,
.welcome-shortcuts h3 {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 8px;
  color: var(--text-color);
}

.welcome-recent ul {
  list-style: none;
  padding: 0;
  margin: 0;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;
}

.welcome-recent li + li {
  border-top: 1px solid var(--border-color);
}

.welcome-recent-item {
  display: flex;
  align-items: baseline;
  gap: 10px;
  width: 100%;
  padding: 9px 12px;
  background: var(--annotation-bg);
  border: none;
  color: var(--text-color);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.welcome-recent-item:hover {
  background: var(--sidebar-bg);
}

.welcome-recent-kind {
  flex: none;
  width: 34px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--context-text);
}

.welcome-recent-kind.chat {
  color: var(--context-reply);
}

.welcome-recent-name {
  flex: none;
  max-width: 45%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.welcome-recent-dir {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-muted);
  font-size: 12px;
}

.welcome-shortcuts {
  width: min(536px, 100%);
  margin-top: 28px;
  text-align: left;
  background: var(--sidebar-bg);
  padding: 16px 20px;
  border-radius: 8px;
}

.welcome-shortcuts ul {
  list-style: none;
  padding: 0;
  margin: 0;
  columns: 2;
}

.welcome-shortcuts li {
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 8px;
  display: flex;
  gap: 10px;
  break-inside: avoid;
}

.welcome-shortcuts kbd {
  background: var(--border-color);
  padding: 2px 6px;
  border-radius: 3px;
  font-family: 'Consolas', monospace;
  font-size: 11px;
  min-width: 84px;
  text-align: center;
}
</style>
