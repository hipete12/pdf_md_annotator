<template>
  <div
    class="doc-event"
    :class="event.status"
    :data-event-id="event.id"
  >
    <svg
      class="doc-event-icon"
      viewBox="0 0 16 16"
      aria-hidden="true"
    ><path d="M4 1.5h5.5l3 3v10H4z M9.5 1.5v3h3 M6 8h4.5 M6 10.5h4.5" /></svg>
    <div class="doc-event-main">
      <div class="doc-event-title">
        <template v-if="event.status === 'running'">
          Writing the document…
          <span class="doc-event-meta">{{ formatChars(event.chars) }}</span>
        </template>
        <template v-else-if="event.status === 'done'">
          Document updated
          <span class="doc-event-meta">{{ event.docName }}</span>
        </template>
        <template v-else-if="event.status === 'cancelled'">
          Document generation stopped
        </template>
        <template v-else>
          Document not updated
        </template>
      </div>
      <div
        v-if="event.steer"
        class="doc-event-steer"
      >
        /generate {{ event.steer }}
      </div>
      <div
        v-if="event.status === 'error' && event.error"
        class="doc-event-error"
      >
        {{ event.error }}
      </div>
    </div>
    <button
      v-if="event.status === 'done' && isLatest"
      class="doc-event-btn"
      title="Show the rendered document (/open)"
      @click="$emit('open')"
    >
      Open
    </button>
  </div>
</template>

<script>
export default {
  name: 'ChatDocEvent',

  props: {
    event: { type: Object, required: true },
    // Only the newest successful generation offers "Open"
    isLatest: { type: Boolean, default: false }
  },

  emits: ['open'],

  setup() {
    const formatChars = (n) => {
      const value = n || 0
      if (value < 1000) return `${value} characters`
      return `${(value / 1000).toFixed(1)}k characters`
    }
    return { formatChars }
  }
}
</script>

<style scoped>
.doc-event {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin: 4px 0 12px;
  padding: 10px 12px;
  border: 1px dashed var(--border-color);
  border-radius: 8px;
  font-size: 13px;
  color: var(--text-color);
}

.doc-event.done {
  border-style: solid;
  border-color: color-mix(in srgb, var(--success-color) 45%, var(--border-color));
}

.doc-event.error {
  border-color: color-mix(in srgb, var(--danger-color) 50%, var(--border-color));
}

.doc-event-icon {
  flex: none;
  width: 18px;
  height: 18px;
  margin-top: 1px;
  fill: none;
  stroke: var(--text-muted);
  stroke-width: 1.2;
  stroke-linejoin: round;
}

.doc-event.done .doc-event-icon {
  stroke: var(--success-color);
}

.doc-event.running .doc-event-icon {
  stroke: var(--primary-color);
  animation: doc-pulse 1.2s infinite ease-in-out;
}

@keyframes doc-pulse {
  50% { opacity: 0.35; }
}

.doc-event-main {
  flex: 1;
  min-width: 0;
}

.doc-event-title {
  font-weight: 500;
}

.doc-event-meta {
  margin-left: 6px;
  font-weight: 400;
  color: var(--text-muted);
  font-size: 12px;
}

.doc-event-steer {
  margin-top: 2px;
  font-family: 'Consolas', monospace;
  font-size: 12px;
  color: var(--text-muted);
  overflow-wrap: anywhere;
}

.doc-event-error {
  margin-top: 4px;
  font-size: 12px;
  color: var(--danger-color);
  overflow-wrap: anywhere;
}

.doc-event-btn {
  flex: none;
  padding: 4px 12px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--annotation-bg);
  color: var(--text-color);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.doc-event-btn:hover {
  border-color: var(--primary-color);
  color: var(--primary-color);
}
</style>
