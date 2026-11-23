<template>
  <div
    class="pdf-search"
    role="search"
  >
    <svg
      class="pdf-search-icon"
      viewBox="0 0 16 16"
      aria-hidden="true"
    ><circle
      cx="7"
      cy="7"
      r="4.5"
    /><path d="M10.5 10.5L14 14" /></svg>
    <input
      ref="input"
      :value="query"
      class="pdf-search-input"
      type="text"
      placeholder="Find in PDF"
      aria-label="Find in PDF"
      spellcheck="false"
      autocomplete="off"
      @input="onInput"
      @keydown="onKeydown"
    >
    <span
      class="pdf-search-count"
      :class="{ empty: noResults }"
      aria-live="polite"
    >{{ countLabel }}</span>
    <button
      class="pdf-search-btn"
      title="Previous match (Shift+Enter)"
      aria-label="Previous match"
      :disabled="!total"
      @mousedown.prevent
      @click="step(-1)"
    >
      <svg
        viewBox="0 0 16 16"
        aria-hidden="true"
      ><path d="M4 10l4-4 4 4" /></svg>
    </button>
    <button
      class="pdf-search-btn"
      title="Next match (Enter)"
      aria-label="Next match"
      :disabled="!total"
      @mousedown.prevent
      @click="step(1)"
    >
      <svg
        viewBox="0 0 16 16"
        aria-hidden="true"
      ><path d="M4 6l4 4 4-4" /></svg>
    </button>
    <button
      class="pdf-search-btn"
      title="Close (Esc)"
      aria-label="Close search"
      @click="close"
    >
      <svg
        viewBox="0 0 16 16"
        aria-hidden="true"
      ><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" /></svg>
    </button>
  </div>
</template>

<script>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useStore } from 'vuex'
import { normalizeQuery } from '../utils/pdfSearch'

// Search while typing, once the typing pauses
const SEARCH_DELAY = 200

export default {
  name: 'PdfSearchBar',

  setup() {
    const store = useStore()
    const input = ref(null)
    const search = computed(() => store.state.search)
    const query = computed(() => search.value.query)
    const total = computed(() => store.getters['search/total'])
    const stale = computed(() => store.getters['search/stale'])
    const hasQuery = computed(() => Boolean(normalizeQuery(query.value)))
    const noResults = computed(() => hasQuery.value && !stale.value && !search.value.searching && total.value === 0)

    const countLabel = computed(() => {
      if (!hasQuery.value) return ''
      if (search.value.searching || stale.value) return total.value ? `${search.value.current + 1} of ${total.value}` : 'Searching…'
      if (!total.value) return 'No results'
      return `${search.value.current + 1} of ${total.value}`
    })

    let timer = null
    const runSoon = () => {
      clearTimeout(timer)
      timer = setTimeout(() => store.dispatch('search/run'), SEARCH_DELAY)
    }

    const onInput = (event) => {
      store.commit('search/SET_QUERY', event.target.value)
      runSoon()
    }

    const step = (direction) => {
      clearTimeout(timer)
      store.dispatch('search/step', direction)
    }

    const close = () => {
      clearTimeout(timer)
      store.dispatch('search/close')
    }

    const onKeydown = (event) => {
      if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault()
        step(event.shiftKey ? -1 : 1)
      } else if (event.key === 'Escape') {
        // Handled here so the app-wide Esc (e.g. leave full-screen chat) and
        // the note shortcuts don't also act on it
        event.preventDefault()
        event.stopPropagation()
        close()
      }
    }

    // Opening (or Ctrl+F while open) puts the cursor in the field with the
    // query selected, ready to type over
    const focusInput = async () => {
      await nextTick()
      input.value?.focus()
      input.value?.select()
    }
    watch(() => search.value.focusNonce, focusInput)
    onMounted(focusInput)
    onUnmounted(() => clearTimeout(timer))

    return { input, query, total, noResults, countLabel, onInput, onKeydown, step, close }
  }
}
</script>

<style scoped>
.pdf-search {
  position: absolute;
  /* Below the toolbar, clear of the viewer's scrollbar */
  top: 56px;
  right: 24px;
  z-index: 1000;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 4px 4px 10px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--annotation-bg);
  box-shadow: var(--shadow-lg);
  color: var(--text-color);
}

.pdf-search-icon {
  flex: none;
  width: 14px;
  height: 14px;
  fill: none;
  stroke: var(--text-muted);
  stroke-width: 1.5;
  stroke-linecap: round;
}

.pdf-search .pdf-search-input {
  width: 200px;
  padding: 4px 2px;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text-color);
  font-size: 13px;
}

.pdf-search-count {
  min-width: 64px;
  padding: 0 4px;
  color: var(--text-muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  text-align: right;
  white-space: nowrap;
}

.pdf-search-count.empty {
  color: var(--danger-color);
}

.pdf-search-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: none;
  border-radius: 5px;
  background: none;
  color: var(--text-color);
  cursor: pointer;
}

.pdf-search-btn:hover:not(:disabled) {
  background: var(--menu-hover);
}

.pdf-search-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.pdf-search-btn svg {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}
</style>
