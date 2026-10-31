<template>
  <div
    class="chat-message"
    :class="[`chat-message-${message.role}`, { 'chat-message-error': message.error && message.error.code !== 'aborted' }]"
  >
    <!-- Contexts that were attached to this user message -->
    <div
      v-if="message.role === 'user' && message.contexts && message.contexts.length"
      class="chat-message-contexts"
    >
      <button
        v-for="context in message.contexts"
        :key="context.id || context.text"
        class="chat-context-ref"
        :title="`Go to page ${context.page}`"
        @click="$emit('open-context', context)"
      >
        <span class="chat-context-ref-kind">{{ context.kind === 'note' ? 'Note' : 'Text' }}</span>
        <span class="chat-context-ref-page">p. {{ context.page }}</span>
        <span class="chat-context-ref-text">{{ context.text }}</span>
      </button>
    </div>

    <div
      v-if="message.role === 'user'"
      class="chat-bubble"
    >
      {{ message.content }}
    </div>

    <template v-else>
      <details
        v-if="message.reasoning"
        class="chat-reasoning"
      >
        <summary>{{ message.pending && !message.content ? 'Thinking…' : 'Reasoning' }}</summary>
        <div class="chat-reasoning-body">
          {{ message.reasoning }}
        </div>
      </details>

      <div
        v-if="message.content"
        class="chat-answer markdown-body"
        :class="{ 'chat-streaming': message.pending }"
        v-html="rendered"
      />
      <div
        v-else-if="message.pending && !message.reasoning"
        class="chat-typing"
        aria-label="Waiting for reply"
      >
        <span /><span /><span />
      </div>

      <div
        v-if="message.error && message.error.code !== 'aborted'"
        class="chat-error"
      >
        {{ message.error.message }}
      </div>
      <div
        v-else-if="message.error"
        class="chat-stopped"
      >
        Stopped
      </div>

      <div
        v-if="!message.pending"
        class="chat-message-actions"
      >
        <button
          v-if="message.content"
          class="chat-action"
          title="Copy reply"
          @click="copy"
        >
          {{ copied ? 'Copied' : 'Copy' }}
        </button>
        <button
          v-if="isLast"
          class="chat-action"
          title="Generate the reply again"
          @click="$emit('retry')"
        >
          Retry
        </button>
        <span
          v-if="message.model"
          class="chat-message-model"
          :title="message.model"
        >{{ message.model }}</span>
      </div>
    </template>
  </div>
</template>

<script>
import { computed, ref } from 'vue'
import { useStore } from 'vuex'
import { renderMarkdown } from '../../utils/markdown'

let clipboard = null
try {
  clipboard = require('electron').clipboard
} catch (e) {
  // Not running in Electron
}

export default {
  name: 'ChatMessage',

  props: {
    message: { type: Object, required: true },
    isLast: { type: Boolean, default: false }
  },

  emits: ['retry', 'open-context'],

  setup(props) {
    const store = useStore()
    const copied = ref(false)

    // renderMarkdown sanitizes its output (LLM text is untrusted)
    const rendered = computed(() => renderMarkdown(props.message.content, {
      latexMacros: store.getters.latexMacros
    }))

    const copy = async () => {
      const text = props.message.content
      if (clipboard) clipboard.writeText(text)
      else await navigator.clipboard?.writeText(text)
      copied.value = true
      setTimeout(() => { copied.value = false }, 1200)
    }

    return { rendered, copied, copy }
  }
}
</script>

<style scoped>
.chat-message {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-width: 100%;
}

.chat-message-user {
  align-items: flex-end;
}

.chat-bubble {
  max-width: 88%;
  padding: 8px 12px;
  border-radius: 12px 12px 4px 12px;
  background: var(--primary-color);
  color: #fff;
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.chat-message-contexts {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  max-width: 88%;
}

.chat-context-ref {
  display: flex;
  align-items: baseline;
  gap: 6px;
  max-width: 100%;
  padding: 3px 8px;
  border: 1px solid var(--border-color);
  border-left: 3px solid var(--primary-color);
  border-radius: 4px;
  background: var(--annotation-bg);
  color: var(--text-color);
  font-size: 11px;
  cursor: pointer;
  text-align: left;
}

.chat-context-ref:hover {
  border-color: var(--primary-color);
}

.chat-context-ref-kind {
  font-weight: 600;
  color: var(--primary-color);
}

.chat-context-ref-page {
  color: var(--text-muted);
  white-space: nowrap;
}

.chat-context-ref-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.chat-answer {
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-color);
  overflow-wrap: anywhere;
}

.chat-answer :deep(p) {
  margin: 0 0 0.6em;
}

.chat-answer :deep(p:last-child) {
  margin-bottom: 0;
}

.chat-answer :deep(ul),
.chat-answer :deep(ol) {
  margin: 0.3em 0 0.6em;
  padding-left: 1.4em;
}

.chat-answer :deep(h1),
.chat-answer :deep(h2),
.chat-answer :deep(h3) {
  font-size: 1.05em;
  margin: 0.8em 0 0.4em;
}

.chat-answer :deep(pre) {
  margin: 0.5em 0;
  padding: 10px;
  border-radius: 6px;
  overflow-x: auto;
  font-size: 12px;
}

.chat-answer :deep(code) {
  font-size: 0.92em;
}

.chat-answer :deep(:not(pre) > code) {
  padding: 1px 4px;
  border-radius: 3px;
  background: var(--sidebar-bg);
}

.chat-answer :deep(.math-block) {
  overflow-x: auto;
  padding: 2px 0;
}

.chat-answer :deep(table) {
  border-collapse: collapse;
  margin: 0.5em 0;
  font-size: 12px;
}

.chat-answer :deep(th),
.chat-answer :deep(td) {
  border: 1px solid var(--border-color);
  padding: 4px 8px;
}

.chat-answer :deep(blockquote) {
  margin: 0.5em 0;
  padding-left: 10px;
  border-left: 3px solid var(--border-color);
  color: var(--text-muted);
}

.chat-answer :deep(a) {
  color: var(--primary-color);
}

.chat-streaming::after {
  content: '';
  display: inline-block;
  width: 7px;
  height: 1em;
  margin-left: 2px;
  vertical-align: text-bottom;
  background: var(--primary-color);
  animation: chat-blink 1s steps(2) infinite;
}

@keyframes chat-blink {
  50% { opacity: 0; }
}

.chat-typing {
  display: flex;
  gap: 4px;
  padding: 6px 0;
}

.chat-typing span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-muted);
  animation: chat-bounce 1.2s infinite ease-in-out;
}

.chat-typing span:nth-child(2) { animation-delay: 0.15s; }
.chat-typing span:nth-child(3) { animation-delay: 0.3s; }

@keyframes chat-bounce {
  0%, 80%, 100% { opacity: 0.3; transform: translateY(0); }
  40% { opacity: 1; transform: translateY(-3px); }
}

.chat-reasoning {
  font-size: 12px;
  color: var(--text-muted);
}

.chat-reasoning summary {
  cursor: pointer;
  user-select: none;
}

.chat-reasoning-body {
  margin-top: 4px;
  padding-left: 10px;
  border-left: 2px solid var(--border-color);
  white-space: pre-wrap;
  max-height: 200px;
  overflow-y: auto;
}

.chat-error {
  padding: 8px 10px;
  border: 1px solid var(--danger-color);
  border-radius: 6px;
  background: rgba(239, 68, 68, 0.08);
  color: var(--danger-color);
  font-size: 12px;
  overflow-wrap: anywhere;
}

.chat-stopped {
  font-size: 11px;
  color: var(--text-muted);
  font-style: italic;
}

.chat-message-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 18px;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.chat-message:hover .chat-message-actions,
.chat-message-error .chat-message-actions,
.chat-message-actions:focus-within {
  opacity: 1;
}

.chat-action {
  background: none;
  border: none;
  padding: 0;
  font-size: 11px;
  color: var(--text-muted);
  cursor: pointer;
}

.chat-action:hover {
  color: var(--primary-color);
}

.chat-message-model {
  margin-left: auto;
  font-size: 10px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 50%;
}
</style>
