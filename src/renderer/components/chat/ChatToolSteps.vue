<template>
  <details
    class="tool-steps"
    :open="pending"
  >
    <summary>
      <svg
        viewBox="0 0 16 16"
        aria-hidden="true"
      ><circle
        cx="8"
        cy="8"
        r="5.5"
      /><path d="M2.5 8h11M8 2.5c-2 2.2-2 8.8 0 11M8 2.5c2 2.2 2 8.8 0 11" /></svg>
      <span>{{ summary }}</span>
    </summary>
    <ol>
      <li
        v-for="step in steps"
        :key="step.id"
        :class="['tool-step', step.status]"
      >
        <span
          class="tool-step-dot"
          aria-hidden="true"
        />
        <div class="tool-step-body">
          <template v-if="step.type === 'fetch'">
            <span class="tool-step-verb">{{ step.status === 'running' ? 'Reading' : 'Read' }}</span>
            <a
              v-if="isWebUrl(step.url)"
              :href="step.url"
              target="_blank"
              rel="noopener noreferrer"
              :title="step.url"
            >{{ shortUrl(step.url) }}</a>
            <span v-else>{{ step.url }}</span>
            <span
              v-if="step.truncated"
              class="tool-step-note"
            >(long page, truncated)</span>
          </template>
          <template v-else>
            <span class="tool-step-verb">{{ step.status === 'running' ? 'Searching' : 'Searched' }}</span>
            <q>{{ step.query }}</q>
            <span
              v-if="step.results"
              class="tool-step-note"
            >{{ step.results.length }} result{{ step.results.length === 1 ? '' : 's' }}</span>
            <ul
              v-if="step.results && step.results.length"
              class="tool-step-results"
            >
              <li
                v-for="result in step.results.slice(0, 5)"
                :key="result.url"
              >
                <a
                  v-if="isWebUrl(result.url)"
                  :href="result.url"
                  target="_blank"
                  rel="noopener noreferrer"
                  :title="result.url"
                >{{ result.title || shortUrl(result.url) }}</a>
                <span class="tool-step-host">{{ hostOf(result.url) }}</span>
              </li>
            </ul>
          </template>
          <div
            v-if="step.error"
            class="tool-step-error"
          >
            {{ step.error }}
          </div>
        </div>
      </li>
    </ol>
  </details>
</template>

<script>
import { computed } from 'vue'

export default {
  name: 'ChatToolSteps',

  props: {
    steps: { type: Array, required: true },
    pending: { type: Boolean, default: false }
  },

  setup(props) {
    const summary = computed(() => {
      const running = props.steps.find(s => s.status === 'running')
      if (running) return running.type === 'fetch' ? 'Reading a page…' : 'Searching the web…'
      const n = props.steps.length
      const searches = props.steps.filter(s => s.type === 'search').length
      const pages = n - searches
      const parts = []
      if (searches) parts.push(`${searches} search${searches === 1 ? '' : 'es'}`)
      if (pages) parts.push(`${pages} page${pages === 1 ? '' : 's'} read`)
      return `Used the web · ${parts.join(', ')}`
    })

    const isWebUrl = (url) => /^https?:\/\//i.test(String(url || ''))
    const hostOf = (url) => {
      try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' }
    }
    const shortUrl = (url) => {
      try {
        const u = new URL(url)
        const path = u.pathname === '/' ? '' : u.pathname
        const text = `${u.hostname.replace(/^www\./, '')}${path}`
        return text.length > 60 ? `${text.slice(0, 59)}…` : text
      } catch {
        return url
      }
    }

    return { summary, isWebUrl, hostOf, shortUrl }
  }
}
</script>

<style scoped>
.tool-steps {
  font-size: 12px;
  color: var(--text-muted);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--sidebar-bg);
}

.tool-steps summary {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  cursor: pointer;
  user-select: none;
  list-style: none;
}

.tool-steps summary::-webkit-details-marker {
  display: none;
}

.tool-steps summary svg {
  width: 14px;
  height: 14px;
  flex: none;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.3;
}

.tool-steps ol {
  list-style: none;
  margin: 0;
  padding: 2px 10px 8px;
}

.tool-step {
  display: flex;
  gap: 8px;
  padding: 3px 0;
}

.tool-step-dot {
  flex: none;
  width: 6px;
  height: 6px;
  margin-top: 6px;
  border-radius: 50%;
  background: var(--success-color);
}

.tool-step.running .tool-step-dot {
  background: var(--primary-color);
  animation: tool-pulse 1s infinite ease-in-out;
}

.tool-step.error .tool-step-dot {
  background: var(--danger-color);
}

@keyframes tool-pulse {
  50% { opacity: 0.3; }
}

.tool-step-body {
  min-width: 0;
  overflow-wrap: anywhere;
}

.tool-step-verb {
  color: var(--text-color);
  margin-right: 4px;
}

.tool-step-note {
  margin-left: 6px;
}

.tool-step a {
  color: var(--primary-color);
  text-decoration: none;
}

.tool-step a:hover {
  text-decoration: underline;
}

.tool-step-results {
  list-style: none;
  margin: 3px 0 0;
  padding: 0 0 0 2px;
}

.tool-step-results li {
  display: flex;
  gap: 6px;
  align-items: baseline;
  min-width: 0;
  padding: 1px 0;
}

.tool-step-results a {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-step-host {
  flex: none;
  font-size: 11px;
}

.tool-step-error {
  color: var(--danger-color);
}
</style>
