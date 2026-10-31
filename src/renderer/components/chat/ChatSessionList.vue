<template>
  <div
    class="chat-sessions"
    role="dialog"
    aria-label="Chat sessions"
  >
    <div class="chat-sessions-head">
      <span>Sessions</span>
      <button
        class="chat-sessions-new"
        @click="$emit('new')"
      >
        + New session
      </button>
    </div>

    <p
      v-if="sessions.length === 0"
      class="chat-sessions-empty"
    >
      No sessions yet for this document.
    </p>

    <ul class="chat-sessions-list">
      <li
        v-for="session in sessions"
        :key="session.id"
        class="chat-session"
        :class="{ active: session.id === activeId }"
      >
        <template v-if="editingId === session.id">
          <input
            ref="renameInput"
            v-model="draft"
            class="chat-session-rename"
            @keydown.enter.prevent="commitRename(session.id)"
            @keydown.esc.stop.prevent="editingId = null"
            @blur="commitRename(session.id)"
          >
        </template>

        <template v-else-if="confirmingId === session.id">
          <span class="chat-session-confirm">Delete this session?</span>
          <button
            class="chat-session-btn danger"
            @click="remove(session.id)"
          >
            Delete
          </button>
          <button
            class="chat-session-btn"
            @click="confirmingId = null"
          >
            Cancel
          </button>
        </template>

        <template v-else>
          <button
            class="chat-session-main"
            @click="$emit('select', session.id)"
          >
            <span class="chat-session-title">{{ session.title }}</span>
            <span class="chat-session-meta">
              {{ formatDate(session.modified) }} · {{ countLabel(session) }}
            </span>
          </button>
          <button
            class="chat-session-icon"
            title="Rename"
            @click="startRename(session)"
          >
            <svg
              viewBox="0 0 16 16"
              aria-hidden="true"
            ><path d="M11.5 2.5l2 2L6 12H4v-2z" /></svg>
          </button>
          <button
            class="chat-session-icon"
            title="Delete"
            @click="confirmingId = session.id"
          >
            <svg
              viewBox="0 0 16 16"
              aria-hidden="true"
            ><path d="M3 4.5h10M6.5 4.5V3h3v1.5M5 4.5l.5 8.5h5l.5-8.5" /></svg>
          </button>
        </template>
      </li>
    </ul>
  </div>
</template>

<script>
import { nextTick, ref } from 'vue'

export default {
  name: 'ChatSessionList',

  props: {
    sessions: { type: Array, required: true },
    activeId: { type: String, default: null }
  },

  emits: ['select', 'new', 'rename', 'delete'],

  setup(props, { emit }) {
    const editingId = ref(null)
    const confirmingId = ref(null)
    const draft = ref('')
    const renameInput = ref(null)

    const startRename = async (session) => {
      confirmingId.value = null
      editingId.value = session.id
      draft.value = session.title
      await nextTick()
      const input = Array.isArray(renameInput.value) ? renameInput.value[0] : renameInput.value
      input?.focus()
      input?.select()
    }

    const commitRename = (id) => {
      if (editingId.value !== id) return
      if (draft.value.trim()) emit('rename', { id, title: draft.value })
      editingId.value = null
    }

    const remove = (id) => {
      confirmingId.value = null
      emit('delete', id)
    }

    const formatDate = (iso) => {
      const date = new Date(iso)
      const today = new Date()
      if (date.toDateString() === today.toDateString()) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }
      return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric' })
    }

    const countLabel = (session) => {
      const n = session.messages.filter(m => m.role === 'user').length
      return n === 1 ? '1 question' : `${n} questions`
    }

    return { editingId, confirmingId, draft, renameInput, startRename, commitRename, remove, formatDate, countLabel }
  }
}
</script>

<style scoped>
.chat-sessions {
  position: absolute;
  top: 44px;
  left: 8px;
  right: 8px;
  max-height: min(60%, 420px);
  display: flex;
  flex-direction: column;
  background: var(--annotation-bg);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  box-shadow: var(--shadow-lg);
  z-index: 20;
  overflow: hidden;
}

.chat-sessions-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border-color);
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
}

.chat-sessions-new {
  background: none;
  border: none;
  color: var(--primary-color);
  font-size: 12px;
  cursor: pointer;
}

.chat-sessions-empty {
  margin: 0;
  padding: 12px 10px;
  font-size: 12px;
  color: var(--text-muted);
}

.chat-sessions-list {
  list-style: none;
  margin: 0;
  padding: 4px;
  overflow-y: auto;
}

.chat-session {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border-radius: 6px;
}

.chat-session:hover,
.chat-session.active {
  background: var(--sidebar-bg);
}

.chat-session.active .chat-session-title {
  color: var(--primary-color);
}

.chat-session-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  padding: 5px 6px;
  background: none;
  border: none;
  text-align: left;
  cursor: pointer;
  color: var(--text-color);
}

.chat-session-title {
  max-width: 100%;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-session-meta {
  font-size: 11px;
  color: var(--text-muted);
}

.chat-session-icon {
  flex: none;
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  border-radius: 4px;
  color: var(--text-muted);
  cursor: pointer;
  opacity: 0;
}

.chat-session:hover .chat-session-icon,
.chat-session-icon:focus-visible {
  opacity: 1;
}

.chat-session-icon:hover {
  color: var(--text-color);
  background: var(--border-color);
}

.chat-session-icon svg {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.3;
  stroke-linejoin: round;
}

.chat-session-rename {
  flex: 1;
  margin: 3px;
  padding: 4px 6px;
  border: 1px solid var(--primary-color);
  border-radius: 4px;
  font-size: 13px;
  background: var(--annotation-bg);
  color: var(--text-color);
}

.chat-session-confirm {
  flex: 1;
  padding: 6px;
  font-size: 12px;
  color: var(--text-color);
}

.chat-session-btn {
  padding: 3px 8px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  background: var(--annotation-bg);
  color: var(--text-color);
  font-size: 11px;
  cursor: pointer;
}

.chat-session-btn.danger {
  border-color: var(--danger-color);
  color: var(--danger-color);
}
</style>
