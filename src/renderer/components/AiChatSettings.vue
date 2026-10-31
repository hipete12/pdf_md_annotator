<template>
  <div class="settings-section ai-settings">
    <h3 class="settings-section-title">AI Chat</h3>

    <!-- Provider -->
    <div class="settings-row">
      <label class="settings-label" for="ai-provider">Provider</label>
      <select
        id="ai-provider"
        class="settings-input"
        :value="llm.provider"
        @change="changeProvider($event.target.value)"
      >
        <option v-for="p in providers" :key="p.id" :value="p.id">{{ p.label }}</option>
      </select>
    </div>

    <div class="settings-row">
      <label class="settings-label" for="ai-base-url">Base URL</label>
      <div class="ai-inline">
        <input
          id="ai-base-url"
          type="text"
          class="settings-input ai-wide"
          :value="baseUrl"
          :placeholder="provider.baseUrl || 'https://host/v1'"
          spellcheck="false"
          @change="setBaseUrl($event.target.value)"
        />
        <button
          v-if="provider.baseUrl && baseUrl !== provider.baseUrl"
          class="ai-link"
          title="Restore the default URL"
          @click="setBaseUrl(provider.baseUrl)"
        >Default</button>
      </div>
    </div>

    <!-- API key (write-only: the stored key is never shown) -->
    <div v-if="!provider.local" class="settings-row">
      <label class="settings-label" for="ai-key">
        API Key<span v-if="!provider.requiresKey" class="ai-muted"> (optional)</span>
      </label>
      <div class="ai-inline">
        <input
          id="ai-key"
          v-model="keyDraft"
          type="password"
          class="settings-input ai-wide"
          :placeholder="hasKey ? '•••••••• saved' : 'Paste your API key'"
          autocomplete="off"
          spellcheck="false"
          @keydown.enter="saveKey"
        />
        <button class="btn btn-secondary ai-btn" :disabled="!keyDraft.trim()" @click="saveKey">Save</button>
        <button v-if="hasKey" class="ai-link ai-danger" @click="removeKey">Remove</button>
      </div>
    </div>
    <p v-if="!provider.local && keyStorageWeak" class="settings-hint ai-warning">
      No system keyring was found, so the key is only obfuscated on disk. Install and unlock
      a keyring (e.g. GNOME Keyring or KWallet) for proper encryption.
    </p>

    <!-- Models -->
    <div class="settings-row">
      <label class="settings-label" for="ai-model">Model</label>
      <div class="ai-inline">
        <input
          id="ai-model"
          type="text"
          class="settings-input ai-wide"
          list="ai-model-list"
          :value="modelId"
          placeholder="Load models or type an id"
          spellcheck="false"
          @change="setModel($event.target.value)"
        />
        <datalist id="ai-model-list">
          <option v-for="m in models" :key="m.id" :value="m.id">
            {{ m.name }}{{ m.vision ? ' · vision' : '' }}
          </option>
        </datalist>
        <button class="btn btn-secondary ai-btn" :disabled="loadingModels" @click="loadModels">
          {{ loadingModels ? 'Loading…' : (models.length ? 'Refresh' : 'Load models') }}
        </button>
      </div>
    </div>
    <p v-if="connection.message" class="settings-hint" :class="connection.ok ? 'ai-ok' : 'ai-error'">
      {{ connection.message }}
    </p>

    <div v-if="modelId" class="settings-row">
      <label class="settings-label" for="ai-vision-override">Image input</label>
      <div class="ai-inline">
        <span class="ai-badge" :class="visionBadge.cls" :title="visionBadge.title">{{ visionBadge.text }}</span>
        <select
          id="ai-vision-override"
          class="settings-input ai-narrow"
          :value="visionOverride"
          @change="setVisionOverride($event.target.value)"
        >
          <option value="auto">Auto-detect</option>
          <option value="true">Supports images</option>
          <option value="false">Text only</option>
        </select>
      </div>
    </div>

    <!-- Vision -->
    <div class="settings-row">
      <label class="settings-label" for="ai-vision">Send page images</label>
      <input
        id="ai-vision"
        type="checkbox"
        :checked="chat.visionEnabled"
        :disabled="effectiveVision === false && !chat.visionEnabled"
        @change="updateSetting('chat.visionEnabled', $event.target.checked)"
      />
    </div>
    <p v-if="chat.visionEnabled && effectiveVision === false" class="settings-hint ai-warning">
      The selected model is text-only, so page images will not be sent.
    </p>
    <p v-else-if="chat.visionEnabled && effectiveVision === null && modelId" class="settings-hint ai-warning">
      Image support for this model is unknown. If the provider rejects images you can retry without them.
    </p>
    <template v-if="chat.visionEnabled">
      <div class="settings-row">
        <label class="settings-label" for="ai-vision-pages">Pages to send</label>
        <select
          id="ai-vision-pages"
          class="settings-input"
          :value="chat.visionPages"
          @change="updateSetting('chat.visionPages', $event.target.value)"
        >
          <option value="context">Attached context (or current page)</option>
          <option value="all">All pages</option>
        </select>
      </div>
      <div class="settings-row">
        <label class="settings-label" for="ai-vision-max">Max images per message</label>
        <input
          id="ai-vision-max"
          type="number"
          class="settings-input"
          :value="chat.maxVisionPages"
          min="1"
          max="20"
          @change="updateSetting('chat.maxVisionPages', clampInt($event.target.value, 1, 20))"
        />
      </div>
    </template>

    <!-- Request parameters -->
    <div class="settings-row">
      <label class="settings-label" for="ai-temp">Temperature</label>
      <input
        id="ai-temp"
        type="number"
        class="settings-input"
        :value="llm.temperature"
        min="0"
        max="2"
        step="0.1"
        @change="updateSetting('llm.temperature', clampFloat($event.target.value, 0, 2))"
      />
    </div>
    <div class="settings-row">
      <label class="settings-label" for="ai-budget">Document text budget (tokens)</label>
      <input
        id="ai-budget"
        type="number"
        class="settings-input"
        :value="llm.contextBudgetTokens"
        min="1000"
        step="1000"
        @change="updateSetting('llm.contextBudgetTokens', clampInt($event.target.value, 1000, 2000000))"
      />
    </div>
    <p class="settings-hint">
      Documents larger than this send only the relevant pages instead of the full text.
    </p>

    <!-- Prompt templates -->
    <div class="settings-row-full">
      <div class="ai-template-head">
        <label class="settings-label" for="ai-system-template">System prompt template</label>
        <button class="ai-link" @click="updateSetting('llm.systemTemplate', defaults.systemTemplate)">Reset</button>
      </div>
      <textarea
        id="ai-system-template"
        class="settings-textarea"
        rows="8"
        :value="llm.systemTemplate"
        spellcheck="false"
        @change="updateSetting('llm.systemTemplate', $event.target.value)"
      ></textarea>
    </div>
    <div class="settings-row-full">
      <div class="ai-template-head">
        <label class="settings-label" for="ai-user-template">User message template</label>
        <button class="ai-link" @click="updateSetting('llm.userTemplate', defaults.userTemplate)">Reset</button>
      </div>
      <textarea
        id="ai-user-template"
        class="settings-textarea"
        rows="3"
        :value="llm.userTemplate"
        spellcheck="false"
        @change="updateSetting('llm.userTemplate', $event.target.value)"
      ></textarea>
      <p class="settings-hint">
        Placeholders: <code v-pre>{{title}}</code>, <code v-pre>{{document}}</code> (page text),
        <code v-pre>{{selections}}</code> (attached text and notes), <code v-pre>{{input}}</code> (your message).
      </p>
    </div>
  </div>
</template>

<script>
import { computed, onMounted, ref, watch } from 'vue'
import { useStore } from 'vuex'
import { LLM_PROVIDERS, resolveVisionSupport } from '../../common/llm'
import { DEFAULT_SETTINGS } from '../../common/constants'

let ipcRenderer = null
try {
  ipcRenderer = require('electron').ipcRenderer
} catch (e) {
  // Not running in Electron
}

export default {
  name: 'AiChatSettings',

  setup() {
    const store = useStore()
    const providers = Object.values(LLM_PROVIDERS)
    const defaults = DEFAULT_SETTINGS.llm

    const llm = computed(() => store.state.settings.llm)
    const chat = computed(() => store.state.settings.chat)
    const provider = computed(() => LLM_PROVIDERS[llm.value.provider] || LLM_PROVIDERS.openrouter)
    const baseUrl = computed(() => llm.value.baseUrls?.[provider.value.id] ?? provider.value.baseUrl)
    const modelId = computed(() => llm.value.models?.[provider.value.id] || '')
    const models = computed(() => store.state.llmModels[provider.value.id] || [])
    const selectedModel = computed(() => models.value.find(m => m.id === modelId.value))

    const keyDraft = ref('')
    const keyStatus = ref({})
    const keyStorageWeak = ref(false)
    const hasKey = computed(() => Boolean(keyStatus.value[provider.value.id]))
    const loadingModels = ref(false)
    const connection = ref({ ok: false, message: '' })

    const updateSetting = (path, value) => store.commit('SET_SETTING', { path, value })

    // Model ids contain dots and slashes, so nested maps are replaced whole
    // rather than addressed with a dotted path.
    const updateMap = (key, id, value) => {
      updateSetting(`llm.${key}`, { ...(llm.value[key] || {}), [id]: value })
    }

    const changeProvider = (id) => {
      updateSetting('llm.provider', id)
      keyDraft.value = ''
      connection.value = { ok: false, message: '' }
    }

    const setBaseUrl = (url) => updateMap('baseUrls', provider.value.id, url.trim())
    const setModel = (id) => updateMap('models', provider.value.id, id.trim())

    const visionOverride = computed(() => {
      const value = llm.value.visionOverrides?.[modelId.value]
      return value === true ? 'true' : value === false ? 'false' : 'auto'
    })

    const setVisionOverride = (value) => {
      const next = { ...(llm.value.visionOverrides || {}) }
      if (value === 'auto') delete next[modelId.value]
      else next[modelId.value] = value === 'true'
      updateSetting('llm.visionOverrides', next)
    }

    const effectiveVision = computed(() => {
      if (!modelId.value) return null
      return resolveVisionSupport(selectedModel.value, llm.value.visionOverrides, modelId.value)
    })

    const visionBadge = computed(() => {
      const value = effectiveVision.value
      const override = visionOverride.value !== 'auto'
      const source = override ? 'set manually' : selectedModel.value?.visionSource === 'provider'
        ? 'reported by provider' : value === true ? 'guessed from the model name' : 'not reported'
      if (value === true) return { text: 'Vision', cls: 'ai-badge-yes', title: `Accepts images (${source})` }
      if (value === false) return { text: 'Text only', cls: 'ai-badge-no', title: `Text only (${source})` }
      return { text: 'Unknown', cls: 'ai-badge-unknown', title: 'The provider does not report image support' }
    })

    const refreshKeyStatus = async () => {
      if (!ipcRenderer) return
      const status = await ipcRenderer.invoke('llm:key-status')
      keyStatus.value = status.keys
      keyStorageWeak.value = status.storage.weak
    }

    const saveKey = async () => {
      if (!ipcRenderer || !keyDraft.value.trim()) return
      const result = await ipcRenderer.invoke('llm:set-key', { providerId: provider.value.id, apiKey: keyDraft.value })
      if (result.success) {
        keyStatus.value = result.keys
        keyDraft.value = ''
        connection.value = { ok: true, message: 'API key saved.' }
      } else {
        connection.value = { ok: false, message: result.error }
      }
    }

    const removeKey = async () => {
      if (!ipcRenderer) return
      const result = await ipcRenderer.invoke('llm:set-key', { providerId: provider.value.id, apiKey: '' })
      if (result.success) keyStatus.value = result.keys
      store.commit('SET_LLM_MODELS', { providerId: provider.value.id, models: [] })
      connection.value = { ok: false, message: '' }
    }

    const loadModels = async () => {
      if (!ipcRenderer) return
      loadingModels.value = true
      connection.value = { ok: false, message: '' }
      try {
        const providerId = provider.value.id
        const result = await ipcRenderer.invoke('llm:list-models', { providerId, baseUrl: baseUrl.value })
        if (result.success) {
          store.commit('SET_LLM_MODELS', { providerId, models: result.models })
          const vision = result.models.filter(m => m.vision).length
          connection.value = {
            ok: true,
            message: `Connected: ${result.models.length} models (${vision} with image input).`
          }
          if (!modelId.value && result.models.length === 1) setModel(result.models[0].id)
        } else {
          connection.value = { ok: false, message: result.error }
        }
      } finally {
        loadingModels.value = false
      }
    }

    const clampInt = (value, min, max) => Math.min(max, Math.max(min, parseInt(value, 10) || min))
    const clampFloat = (value, min, max) => {
      const n = parseFloat(value)
      return Math.min(max, Math.max(min, Number.isFinite(n) ? n : min))
    }

    watch(() => provider.value.id, () => { keyDraft.value = '' })
    onMounted(refreshKeyStatus)

    return {
      providers,
      defaults,
      llm,
      chat,
      provider,
      baseUrl,
      modelId,
      models,
      keyDraft,
      hasKey,
      keyStorageWeak,
      loadingModels,
      connection,
      visionOverride,
      visionBadge,
      effectiveVision,
      updateSetting,
      changeProvider,
      setBaseUrl,
      setModel,
      setVisionOverride,
      saveKey,
      removeKey,
      loadModels,
      clampInt,
      clampFloat
    }
  }
}
</script>

<style scoped>
.ai-inline {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ai-wide {
  width: 260px;
}

.ai-narrow {
  width: 150px;
}

.ai-btn {
  padding: 6px 10px;
  white-space: nowrap;
}

.ai-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.ai-link {
  background: none;
  border: none;
  padding: 0;
  font-size: 12px;
  color: var(--primary-color);
  cursor: pointer;
}

.ai-link:hover {
  text-decoration: underline;
}

.ai-danger {
  color: var(--danger-color);
}

.ai-muted {
  color: var(--text-muted);
}


/* .settings-hint / .settings-row-full are scoped to SettingsModal, so this
   child component needs its own copies */
.settings-hint {
  font-size: 11px;
  color: var(--text-muted);
  margin: -6px 0 12px;
}

.settings-hint code {
  background: var(--sidebar-bg);
  padding: 2px 4px;
  border-radius: 3px;
  font-size: 10px;
}

.settings-row-full {
  margin-bottom: 16px;
}

.settings-row-full .settings-label {
  display: block;
  margin-bottom: 8px;
}

.settings-row-full .settings-hint {
  margin-top: 6px;
}

.settings-hint.ai-ok {
  color: var(--success-color);
}

.settings-hint.ai-error {
  color: var(--danger-color);
}

.settings-hint.ai-warning {
  color: var(--warning-color);
}

.ai-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid currentColor;
}

.ai-badge-yes {
  color: var(--success-color);
}

.ai-badge-no {
  color: var(--text-muted);
}

.ai-badge-unknown {
  color: var(--warning-color);
}

.ai-template-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}
</style>
