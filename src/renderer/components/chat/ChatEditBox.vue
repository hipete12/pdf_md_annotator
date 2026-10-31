<template>
  <div
    ref="root"
    class="chat-edit"
  >
    <div
      v-if="contexts.length"
      class="chat-edit-contexts"
    >
      <span
        v-for="context in contexts"
        :key="context.id || context.text"
        class="chat-edit-context"
        :title="context.text"
      >
        <span class="chat-edit-context-kind">{{ context.kind === 'note' ? 'Note' : 'Text' }}</span>
        <span class="chat-edit-context-page">p. {{ context.page }}</span>
        <span class="chat-edit-context-text">{{ context.text }}</span>
        <button
          class="chat-edit-context-remove"
          title="Remove from this message"
          @click="removeContext(context)"
        >
          <svg
            viewBox="0 0 16 16"
            aria-hidden="true"
          ><path d="M5 5l6 6M11 5l-6 6" /></svg>
        </button>
      </span>
    </div>

    <textarea
      ref="input"
      v-model="text"
      class="chat-edit-input"
      rows="1"
      aria-label="Edit message"
      @input="autoGrow"
      @keydown="onKeydown"
    />

    <div class="chat-edit-actions">
      <span class="chat-edit-hint">Enter to send · Esc to cancel</span>
      <button
        class="chat-edit-btn"
        @click="$emit('cancel')"
      >
        Cancel
      </button>
      <button
        class="chat-edit-btn primary"
        :disabled="!canSubmit"
        @click="submit"
      >
        Send
      </button>
    </div>
  </div>
</template>

<script>
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'

export default {
  name: 'ChatEditBox',

  props: {
    message: { type: Object, required: true }
  },

  emits: ['submit', 'cancel'],

  setup(props, { emit }) {
    const root = ref(null)
    const input = ref(null)
    const text = ref(props.message.content)
    const contexts = ref(JSON.parse(JSON.stringify(props.message.contexts || [])))

    const canSubmit = computed(() => text.value.trim().length > 0 || contexts.value.length > 0)

    const autoGrow = () => {
      const el = input.value
      if (!el) return
      el.style.height = 'auto'
      el.style.height = `${Math.min(el.scrollHeight, 240)}px`
    }

    const submit = () => {
      if (canSubmit.value) emit('submit', { text: text.value, contexts: contexts.value })
    }

    const removeContext = (context) => {
      contexts.value = contexts.value.filter(c => c !== context)
      input.value?.focus()
    }

    const onKeydown = (event) => {
      // Handled here and stopped, so the app-wide Esc (leave full screen) and
      // note shortcuts never see these keys
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        emit('cancel')
        return
      }
      // Enter sends; Shift+Enter is a newline; never while an IME is composing
      if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey &&
          !event.isComposing && event.keyCode !== 229) {
        event.preventDefault()
        event.stopPropagation()
        submit()
      }
    }

    // Clicking anywhere else (PDF, notes, the chat box, other messages, the
    // session list...) cancels the edit. Mouse-based on purpose: switching to
    // another window must not cancel.
    const onDocumentMouseDown = (event) => {
      if (root.value && !root.value.contains(event.target)) emit('cancel')
    }
    // Keyboard focus moving into another text field (e.g. Tab) cancels too
    const onDocumentFocusIn = (event) => {
      const target = event.target
      if (!root.value || root.value.contains(target)) return
      if (target.closest?.('textarea, input, select, [contenteditable]:not([contenteditable="false"])')) emit('cancel')
    }

    onMounted(async () => {
      document.addEventListener('mousedown', onDocumentMouseDown, true)
      document.addEventListener('focusin', onDocumentFocusIn, true)
      await nextTick()
      autoGrow()
      const el = input.value
      if (el) {
        el.focus()
        el.setSelectionRange(el.value.length, el.value.length)
      }
    })

    onUnmounted(() => {
      document.removeEventListener('mousedown', onDocumentMouseDown, true)
      document.removeEventListener('focusin', onDocumentFocusIn, true)
    })

    return { root, input, text, contexts, canSubmit, autoGrow, submit, removeContext, onKeydown }
  }
}
</script>

<style scoped>
.chat-edit {
  width: 92%;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border: 1px solid var(--primary-color);
  border-radius: 10px;
  background: var(--annotation-bg);
  box-shadow: 0 0 0 3px var(--selection-color);
}

.chat-edit-contexts {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.chat-edit-context {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 4px 2px 8px;
  border: 1px solid var(--border-color);
  border-left: 3px solid var(--primary-color);
  border-radius: 4px;
  font-size: 11px;
  color: var(--text-color);
}

.chat-edit-context-kind {
  flex: none;
  font-weight: 600;
  color: var(--primary-color);
}

.chat-edit-context-page {
  flex: none;
  color: var(--text-muted);
}

.chat-edit-context-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-edit-context-remove {
  flex: none;
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 3px;
  background: none;
  color: var(--text-muted);
  cursor: pointer;
}

.chat-edit-context-remove:hover {
  background: var(--border-color);
  color: var(--text-color);
}

.chat-edit-context-remove svg {
  width: 11px;
  height: 11px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: round;
}

.chat-edit-input {
  width: 100%;
  min-height: 24px;
  max-height: 240px;
  padding: 2px;
  border: none;
  outline: none;
  resize: none;
  background: transparent;
  color: var(--text-color);
  font: inherit;
  font-size: 13px;
  line-height: 1.5;
}

.chat-edit-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.chat-edit-hint {
  margin-right: auto;
  font-size: 10px;
  color: var(--text-muted);
}

.chat-edit-btn {
  padding: 3px 10px;
  border: 1px solid var(--border-color);
  border-radius: 5px;
  background: var(--bg-color);
  color: var(--text-color);
  font-size: 12px;
  cursor: pointer;
}

.chat-edit-btn.primary {
  border-color: var(--primary-color);
  background: var(--primary-color);
  color: #fff;
}

.chat-edit-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
