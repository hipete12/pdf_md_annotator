<template>
  <div
    class="chat-message"
    :class="[`chat-message-${message.role}`, { 'chat-message-error': message.error && message.error.code !== 'aborted', editing }]"
    :data-message-id="message.id"
  >
    <!-- Editing a user message before regenerating -->
    <ChatEditBox
      v-if="editing"
      :message="message"
      @submit="$emit('submit-edit', $event)"
      @cancel="$emit('cancel-edit')"
    />

    <!-- Contexts that were attached to this user message -->
    <div
      v-if="!editing && message.role === 'user' && message.contexts && message.contexts.length"
      class="chat-message-contexts"
    >
      <button
        v-for="context in message.contexts"
        :key="context.id || context.text"
        class="chat-context-ref"
        :class="contextClass(context)"
        :title="context.kind === 'reply' ? 'Go to the quoted reply' : context.kind === 'report' ? 'Show in the document' : `Go to page ${context.page}`"
        @click="$emit('open-context', context)"
      >
        <span class="chat-context-ref-kind">{{ contextKindLabel(context) }}</span>
        <span class="chat-context-ref-page">{{ contextLocation(context) }}</span>
        <span class="chat-context-ref-text">{{ context.text }}</span>
      </button>
    </div>

    <template v-if="message.role === 'user' && !editing">
      <div
        v-if="message.content"
        class="chat-bubble"
      >
        {{ message.content }}
      </div>
      <div
        v-if="message.images && message.images.length"
        class="chat-images-note"
        title="These pages were sent to the model as images"
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
        {{ message.images.length === 1 ? 'Page' : 'Pages' }} {{ message.images.map(i => i.page).join(', ') }} sent as {{ message.images.length === 1 ? 'an image' : 'images' }}
      </div>

      <!-- Edit + branch navigation (shown where the conversation diverged) -->
      <div
        class="chat-user-actions"
        :class="{ 'has-branches': siblingCount > 1 }"
      >
        <template v-if="confirmingDelete">
          <span class="chat-branch-confirm">Delete this branch?</span>
          <button
            class="chat-action danger"
            @click="confirmingDelete = false; $emit('delete-branch')"
          >
            Delete
          </button>
          <button
            class="chat-action"
            @click="confirmingDelete = false"
          >
            Cancel
          </button>
        </template>
        <template v-else>
          <div
            v-if="siblingCount > 1"
            class="chat-branch-nav"
          >
            <button
              class="chat-branch-btn"
              title="Previous branch"
              :disabled="locked || siblingIndex <= 1"
              @click="$emit('switch-branch', -1)"
            >
              <svg
                viewBox="0 0 16 16"
                aria-hidden="true"
              ><path d="M10 4L6 8l4 4" /></svg>
            </button>
            <span class="chat-branch-count">{{ siblingIndex }} / {{ siblingCount }}</span>
            <button
              class="chat-branch-btn"
              title="Next branch"
              :disabled="locked || siblingIndex >= siblingCount"
              @click="$emit('switch-branch', 1)"
            >
              <svg
                viewBox="0 0 16 16"
                aria-hidden="true"
              ><path d="M6 4l4 4-4 4" /></svg>
            </button>
          </div>
          <button
            class="chat-branch-btn"
            title="Edit and regenerate"
            :disabled="locked"
            @click="$emit('edit')"
          >
            <svg
              viewBox="0 0 16 16"
              aria-hidden="true"
            ><path d="M11.5 2.5l2 2L6 12H4v-2z" /></svg>
          </button>
          <button
            v-if="siblingCount > 1"
            class="chat-branch-btn"
            title="Delete this branch"
            :disabled="locked"
            @click="confirmingDelete = true"
          >
            <svg
              viewBox="0 0 16 16"
              aria-hidden="true"
            ><path d="M3 4.5h10M6.5 4.5V3h3v1.5M5 4.5l.5 8.5h5l.5-8.5" /></svg>
          </button>
        </template>
      </div>
    </template>

    <template v-else-if="message.role === 'assistant'">
      <ChatToolSteps
        v-if="message.steps && message.steps.length"
        :steps="message.steps"
        :pending="Boolean(message.pending) && !message.content"
      />
      <p
        v-for="notice in message.notices || []"
        :key="notice"
        class="chat-message-notice"
      >
        {{ notice }}
      </p>
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
        <button
          v-if="message.error.code === 'image_unsupported' && isLast"
          class="chat-error-action"
          @click="$emit('retry', { withoutImages: true })"
        >
          Retry without images
        </button>
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
          v-if="message.error && message.error.code !== 'aborted' && isLast"
          class="chat-action"
          title="Try the same request again"
          :disabled="locked"
          @click="$emit('retry')"
        >
          Retry
        </button>
        <button
          class="chat-action"
          title="Edit the question and generate a new reply (creates a branch)"
          :disabled="locked"
          @click="$emit('regenerate')"
        >
          Regenerate
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
import ChatEditBox from './ChatEditBox.vue'
import ChatToolSteps from './ChatToolSteps.vue'
import { contextClass, contextKindLabel, contextLocation } from '../../utils/contextChips'

let clipboard = null
try {
  clipboard = require('electron').clipboard
} catch (e) {
  // Not running in Electron
}

export default {
  name: 'ChatMessage',

  components: { ChatEditBox, ChatToolSteps },

  props: {
    message: { type: Object, required: true },
    isLast: { type: Boolean, default: false },
    editing: { type: Boolean, default: false },
    // Branch controls are disabled while a reply streams
    locked: { type: Boolean, default: false },
    // Position among the alternatives at this message's fork
    siblingIndex: { type: Number, default: 1 },
    siblingCount: { type: Number, default: 1 }
  },

  emits: ['retry', 'regenerate', 'edit', 'submit-edit', 'cancel-edit', 'switch-branch', 'delete-branch', 'open-context'],

  setup(props) {
    const store = useStore()
    const copied = ref(false)
    const confirmingDelete = ref(false)

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

    return { rendered, copied, copy, confirmingDelete, contextClass, contextKindLabel, contextLocation }
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
  border-left: 3px solid var(--ctx, var(--primary-color));
  border-radius: 4px;
  background: var(--annotation-bg);
  color: var(--text-color);
  font-size: 11px;
  cursor: pointer;
  text-align: left;
}

.chat-context-ref:hover {
  border-color: var(--ctx, var(--primary-color));
}

.chat-context-ref-kind {
  font-weight: 600;
  color: var(--ctx, var(--primary-color));
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

.chat-message-notice {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
  font-style: italic;
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

.chat-error-action {
  display: block;
  margin-top: 6px;
  padding: 3px 8px;
  border: 1px solid var(--danger-color);
  border-radius: 4px;
  background: var(--annotation-bg);
  color: var(--danger-color);
  font-size: 11px;
  cursor: pointer;
}

.chat-images-note {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-muted);
}

.chat-images-note svg {
  width: 13px;
  height: 13px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.3;
  stroke-linejoin: round;
}

.chat-message.editing {
  align-items: flex-end;
}

.chat-user-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  min-height: 20px;
  opacity: 0;
  transition: opacity 0.15s ease;
}

/* Where the conversation diverged, the branch arrows stay visible */
.chat-message:hover .chat-user-actions,
.chat-user-actions.has-branches,
.chat-user-actions:focus-within {
  opacity: 1;
}

.chat-branch-nav {
  display: flex;
  align-items: center;
  gap: 1px;
  margin-right: 2px;
  padding: 0 2px;
  border: 1px solid var(--border-color);
  border-radius: 999px;
}

.chat-branch-count {
  min-width: 34px;
  font-size: 11px;
  text-align: center;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.chat-branch-btn {
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 4px;
  background: none;
  color: var(--text-muted);
  cursor: pointer;
}

.chat-branch-btn:hover:not(:disabled) {
  background: var(--sidebar-bg);
  color: var(--text-color);
}

.chat-branch-btn:disabled {
  opacity: 0.35;
  cursor: default;
}

.chat-branch-btn svg {
  width: 13px;
  height: 13px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.4;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.chat-branch-confirm {
  font-size: 11px;
  color: var(--text-color);
  margin-right: 4px;
}

.chat-action.danger {
  color: var(--danger-color);
}

.chat-action:disabled {
  opacity: 0.4;
  cursor: default;
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
