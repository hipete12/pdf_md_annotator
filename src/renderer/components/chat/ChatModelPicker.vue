<template>
  <div
    ref="root"
    class="model-picker"
  >
    <button
      class="model-picker-button"
      :class="{ open, custom: !current.isDefault }"
      :title="buttonTitle"
      :disabled="disabled"
      @click="toggle"
    >
      <span class="model-picker-name">{{ current.model || 'Choose a model' }}</span>
      <svg
        viewBox="0 0 16 16"
        aria-hidden="true"
      ><path d="M4.5 9.5L8 6l3.5 3.5" /></svg>
    </button>

    <div
      v-if="open"
      class="model-picker-menu"
      role="dialog"
      aria-label="Model for this session"
      @keydown.esc.stop.prevent="close"
    >
      <div class="model-picker-head">
        <select
          v-model="providerId"
          class="model-picker-provider"
          aria-label="Provider"
        >
          <option
            v-for="p in providers"
            :key="p.id"
            :value="p.id"
          >
            {{ p.label }}
          </option>
        </select>
        <input
          ref="search"
          v-model="query"
          class="model-picker-search"
          type="text"
          placeholder="Search or type a model id"
          spellcheck="false"
          @keydown.enter.prevent="chooseFirst"
          @keydown.down.prevent="focusList"
        >
      </div>

      <button
        class="model-picker-default"
        :class="{ active: current.isDefault }"
        @click="useDefault"
      >
        <span>Use default</span>
        <span class="model-picker-sub">{{ defaultLabel }}</span>
      </button>

      <div
        ref="list"
        class="model-picker-list"
      >
        <p
          v-if="loading"
          class="model-picker-note"
        >
          Loading models…
        </p>
        <p
          v-else-if="error"
          class="model-picker-note error"
        >
          {{ error }}
          <button
            class="model-picker-link"
            @click="load(true)"
          >
            Retry
          </button>
        </p>

        <button
          v-for="m in filtered"
          :key="m.id"
          class="model-picker-item"
          :class="{ active: !current.isDefault && current.providerId === providerId && current.model === m.id }"
          :title="m.id"
          @click="choose(m.id)"
        >
          <span class="model-picker-item-name">{{ m.name }}</span>
          <span
            v-if="m.name !== m.id"
            class="model-picker-sub"
          >{{ m.id }}</span>
          <span class="model-picker-badges">
            <span
              v-if="m.vision"
              class="model-picker-badge"
            >vision</span>
            <span
              v-if="m.contextLength"
              class="model-picker-badge muted"
            >{{ formatContext(m.contextLength) }}</span>
          </span>
        </button>

        <button
          v-if="customId"
          class="model-picker-item"
          @click="choose(customId)"
        >
          <span class="model-picker-item-name">Use “{{ customId }}”</span>
          <span class="model-picker-sub">model id not in the list</span>
        </button>

        <p
          v-if="!loading && !error && models.length === 0 && !customId"
          class="model-picker-note"
        >
          No models listed. Type a model id above.
        </p>
      </div>
    </div>
  </div>
</template>

<script>
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { useStore } from 'vuex'
import { LLM_PROVIDERS } from '../../../common/llm'

export default {
  name: 'ChatModelPicker',

  props: {
    disabled: { type: Boolean, default: false }
  },

  setup() {
    const store = useStore()
    const root = ref(null)
    const search = ref(null)
    const list = ref(null)
    const open = ref(false)
    const query = ref('')
    const loading = ref(false)
    const error = ref('')
    const providers = Object.values(LLM_PROVIDERS)

    const current = computed(() => store.getters['chat/sessionModel'])
    const providerId = ref(current.value.providerId)
    const models = computed(() => store.state.llmModels[providerId.value] || [])

    const filtered = computed(() => {
      const q = query.value.trim().toLowerCase()
      if (!q) return models.value
      return models.value.filter(m => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q))
    })

    // Offer the typed text as a model id when it looks like one (ids have no
    // spaces) and is not already an exact id or name in the list
    const customId = computed(() => {
      const q = query.value.trim()
      if (!q || /\s/.test(q)) return ''
      const lower = q.toLowerCase()
      if (models.value.some(m => m.id.toLowerCase() === lower || m.name.toLowerCase() === lower)) return ''
      return q
    })

    const defaultLabel = computed(() => {
      const llm = store.state.settings.llm
      const model = llm.models?.[llm.provider]
      return model ? `${LLM_PROVIDERS[llm.provider]?.label || llm.provider} · ${model}` : 'not set in Settings'
    })

    const buttonTitle = computed(() => {
      const label = LLM_PROVIDERS[current.value.providerId]?.label || current.value.providerId
      return current.value.isDefault
        ? `Model: ${current.value.model || 'none'} (${label}, default from Settings). Click to choose a model for this session.`
        : `Model for this session: ${current.value.model} (${label}). Click to change.`
    })

    const load = async (force = false) => {
      if (!force && store.state.llmModels[providerId.value]) return
      loading.value = true
      error.value = ''
      try {
        const result = await store.dispatch('chat/loadModels', providerId.value)
        if (!result?.success) error.value = result?.error || 'Could not load models'
      } finally {
        loading.value = false
      }
    }

    watch(providerId, () => {
      query.value = ''
      load()
    })

    const onDocumentMouseDown = (event) => {
      if (root.value && !root.value.contains(event.target)) close()
    }

    const toggle = async () => {
      if (open.value) return close()
      providerId.value = current.value.providerId
      query.value = ''
      open.value = true
      document.addEventListener('mousedown', onDocumentMouseDown, true)
      await nextTick()
      search.value?.focus()
      load()
    }

    function close() {
      open.value = false
      document.removeEventListener('mousedown', onDocumentMouseDown, true)
    }

    const choose = (model) => {
      store.dispatch('chat/setSessionModel', { providerId: providerId.value, model })
      close()
    }

    const useDefault = () => {
      store.dispatch('chat/setSessionModel', { providerId: null, model: null })
      close()
    }

    const chooseFirst = () => {
      if (filtered.value.length) choose(filtered.value[0].id)
      else if (customId.value) choose(customId.value)
    }

    const focusList = () => list.value?.querySelector('.model-picker-item')?.focus()

    const formatContext = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1000)}k`)

    onUnmounted(() => document.removeEventListener('mousedown', onDocumentMouseDown, true))

    return {
      root,
      search,
      list,
      open,
      query,
      loading,
      error,
      providers,
      providerId,
      current,
      models,
      filtered,
      customId,
      defaultLabel,
      buttonTitle,
      load,
      toggle,
      close,
      choose,
      useDefault,
      chooseFirst,
      focusList,
      formatContext
    }
  }
}
</script>

<style scoped>
.model-picker {
  position: relative;
  min-width: 0;
}

.model-picker-button {
  display: flex;
  align-items: center;
  gap: 3px;
  max-width: 220px;
  padding: 1px 4px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: none;
  color: var(--text-muted);
  font-size: 11px;
  cursor: pointer;
}

.model-picker-button:hover:not(:disabled),
.model-picker-button.open {
  border-color: var(--border-color);
  color: var(--text-color);
}

.model-picker-button.custom {
  color: var(--primary-color);
}

.model-picker-button:disabled {
  cursor: default;
}

.model-picker-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-picker-button svg {
  flex: none;
  width: 11px;
  height: 11px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.model-picker-menu {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 0;
  width: min(340px, 80vw);
  max-height: 380px;
  display: flex;
  flex-direction: column;
  background: var(--annotation-bg);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  box-shadow: var(--shadow-lg);
  z-index: 40;
  overflow: hidden;
}

.model-picker-head {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border-bottom: 1px solid var(--border-color);
}

.model-picker-provider,
.model-picker-search {
  width: 100%;
  padding: 5px 8px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  background: var(--bg-color);
  color: var(--text-color);
  font-size: 12px;
}

.model-picker-search:focus,
.model-picker-provider:focus {
  outline: none;
  border-color: var(--primary-color);
}

.model-picker-default {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  padding: 7px 10px;
  border: none;
  border-bottom: 1px solid var(--border-color);
  background: none;
  color: var(--text-color);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.model-picker-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px;
}

.model-picker-item {
  width: 100%;
  display: grid;
  grid-template-columns: 1fr auto;
  column-gap: 8px;
  align-items: center;
  padding: 6px 8px;
  border: none;
  border-radius: 5px;
  background: none;
  color: var(--text-color);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.model-picker-item .model-picker-sub {
  grid-column: 1;
}

.model-picker-badges {
  grid-column: 2;
  grid-row: 1 / span 2;
  display: flex;
  gap: 4px;
}

.model-picker-item:hover,
.model-picker-item:focus-visible,
.model-picker-default:hover {
  background: var(--sidebar-bg);
  outline: none;
}

.model-picker-item.active,
.model-picker-default.active {
  color: var(--primary-color);
  background: var(--selection-color);
}

.model-picker-item-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-picker-sub {
  font-size: 10px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-picker-badge {
  padding: 0 5px;
  border: 1px solid var(--success-color);
  border-radius: 999px;
  color: var(--success-color);
  font-size: 10px;
}

.model-picker-badge.muted {
  border-color: var(--border-color);
  color: var(--text-muted);
}

.model-picker-note {
  margin: 0;
  padding: 10px;
  font-size: 12px;
  color: var(--text-muted);
}

.model-picker-note.error {
  color: var(--danger-color);
}

.model-picker-link {
  background: none;
  border: none;
  padding: 0;
  margin-left: 4px;
  color: var(--primary-color);
  font-size: 12px;
  cursor: pointer;
}
</style>
