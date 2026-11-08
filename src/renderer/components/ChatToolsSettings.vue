<template>
  <div class="settings-section tools-settings">
    <h3 class="settings-section-title">
      Web Search
    </h3>

    <div class="settings-row">
      <label
        class="settings-label"
        for="tools-tavily-key"
      >Tavily API key</label>
      <div class="ai-inline">
        <input
          id="tools-tavily-key"
          v-model="keyDraft"
          type="password"
          class="settings-input ai-wide"
          :placeholder="hasKey ? '•••••••• saved' : 'tvly-…'"
          autocomplete="off"
          spellcheck="false"
          @keydown.enter="saveKey"
        >
        <button
          class="btn btn-secondary ai-btn"
          :disabled="!keyDraft.trim()"
          @click="saveKey"
        >
          Save
        </button>
        <button
          v-if="hasKey"
          class="ai-link ai-danger"
          @click="removeKey"
        >
          Remove
        </button>
      </div>
    </div>
    <p
      class="settings-hint"
      :class="{ 'ai-error': keyMessage.error, 'ai-ok': keyMessage.ok }"
    >
      {{ keyMessage.text || 'Used for web_search and web_fetch. Get a key at tavily.com.' }}
    </p>

    <div class="settings-row">
      <label
        class="settings-label"
        for="tools-web-standalone"
      >On by default in standalone chats</label>
      <input
        id="tools-web-standalone"
        type="checkbox"
        :checked="tools.webStandalone"
        @change="updateSetting('tools.webStandalone', $event.target.checked)"
      >
    </div>
    <div class="settings-row">
      <label
        class="settings-label"
        for="tools-web-pdf"
      >On by default in PDF chats</label>
      <input
        id="tools-web-pdf"
        type="checkbox"
        :checked="tools.webPdf"
        @change="updateSetting('tools.webPdf', $event.target.checked)"
      >
    </div>
    <div class="settings-row">
      <label
        class="settings-label"
        for="tools-max-steps"
      >Tool calls per reply</label>
      <input
        id="tools-max-steps"
        type="number"
        class="settings-input"
        :value="tools.maxSteps"
        min="1"
        max="20"
        @change="updateSetting('tools.maxSteps', clampInt($event.target.value, 1, 20))"
      >
    </div>
    <p class="settings-hint">
      The globe button in the chat box turns web search on or off per session. After this many
      searches and page reads the model must answer with what it found.
    </p>

    <div class="settings-row-full">
      <div class="ai-template-head">
        <label
          class="settings-label"
          for="tools-instruction"
        >Web tools instruction</label>
        <button
          class="ai-link"
          @click="updateSetting('llm.toolsInstruction', defaults.llm.toolsInstruction)"
        >
          Reset
        </button>
      </div>
      <textarea
        id="tools-instruction"
        class="settings-textarea"
        rows="5"
        :value="llm.toolsInstruction"
        spellcheck="false"
        @change="updateSetting('llm.toolsInstruction', $event.target.value)"
      />
      <p class="settings-hint">
        Added to the system prompt when web search is on.
      </p>
    </div>

    <h3 class="settings-section-title tools-subtitle">
      Standalone Chats
    </h3>
    <div class="settings-row">
      <label
        class="settings-label"
        for="tools-chats-folder"
      >Chats folder</label>
      <input
        id="tools-chats-folder"
        type="text"
        class="settings-input ai-wide"
        :value="chat.chatsFolder"
        :placeholder="defaultFolder"
        spellcheck="false"
        @change="updateSetting('chat.chatsFolder', $event.target.value.trim())"
      >
    </div>
    <p class="settings-hint">
      New chats are saved here as untitled1.chat, untitled2.chat, … Leave empty for the default.
    </p>
    <div class="settings-row-full">
      <div class="ai-template-head">
        <label
          class="settings-label"
          for="tools-standalone-template"
        >System prompt for standalone chats</label>
        <button
          class="ai-link"
          @click="updateSetting('llm.standaloneSystemTemplate', defaults.llm.standaloneSystemTemplate)"
        >
          Reset
        </button>
      </div>
      <textarea
        id="tools-standalone-template"
        class="settings-textarea"
        rows="7"
        :value="llm.standaloneSystemTemplate"
        spellcheck="false"
        @change="updateSetting('llm.standaloneSystemTemplate', $event.target.value)"
      />
      <p class="settings-hint">
        Placeholder: <code v-pre>{{title}}</code> (the chat's name).
      </p>
    </div>

    <h3 class="settings-section-title tools-subtitle">
      Documents
    </h3>
    <div class="settings-row">
      <label
        class="settings-label"
        for="tools-quarto-path"
      >Quarto</label>
      <div class="ai-inline">
        <input
          id="tools-quarto-path"
          type="text"
          class="settings-input ai-wide"
          :value="quartoPath"
          placeholder="Find automatically"
          spellcheck="false"
          @change="setQuartoPath($event.target.value.trim())"
        >
        <button
          class="ai-link"
          @click="checkQuarto"
        >
          Check
        </button>
      </div>
    </div>
    <p
      class="settings-hint"
      :class="{ 'ai-ok': quarto.found, 'ai-error': quarto.checked && !quarto.found }"
    >
      <template v-if="!quarto.checked">
        Checking for Quarto…
      </template>
      <template v-else-if="quarto.found">
        Quarto {{ quarto.version }} at {{ quarto.path }}
      </template>
      <template v-else>
        Quarto was not found. /open needs it: install it from quarto.org, or enter the path to the quarto binary.
      </template>
    </p>
    <div class="settings-row-full">
      <div class="ai-template-head">
        <label
          class="settings-label"
          for="tools-generate-template"
        ><code>/generate</code> instruction</label>
        <button
          class="ai-link"
          @click="updateSetting('llm.generateTemplate', defaults.llm.generateTemplate)"
        >
          Reset
        </button>
      </div>
      <textarea
        id="tools-generate-template"
        class="settings-textarea"
        rows="10"
        :value="llm.generateTemplate"
        spellcheck="false"
        @change="updateSetting('llm.generateTemplate', $event.target.value)"
      />
      <p class="settings-hint">
        Placeholders: <code v-pre>{{conversation}}</code>, <code v-pre>{{current_document}}</code>,
        <code v-pre>{{steer}}</code> (text after /generate), <code v-pre>{{title}}</code>.
        The document is saved as &lt;chat name&gt;.qmd next to the chat.
      </p>
    </div>
  </div>
</template>

<script>
import { computed, onMounted, ref } from 'vue'
import { useStore } from 'vuex'
import { DEFAULT_SETTINGS } from '../../common/constants'

let ipcRenderer = null
try {
  ipcRenderer = require('electron').ipcRenderer
} catch (e) {
  // Not running in Electron
}

export default {
  name: 'ChatToolsSettings',

  setup() {
    const store = useStore()
    const defaults = DEFAULT_SETTINGS
    const llm = computed(() => store.state.settings.llm)
    const chat = computed(() => store.state.settings.chat)
    const tools = computed(() => store.state.settings.tools)
    const updateSetting = (path, value) => store.commit('SET_SETTING', { path, value })
    const clampInt = (value, min, max) => Math.min(max, Math.max(min, parseInt(value, 10) || min))

    // Quarto (needed by /open)
    const quarto = ref({ checked: false, found: false })
    const quartoPath = computed(() => store.state.settings.quarto?.path || '')
    const checkQuarto = async () => {
      if (!ipcRenderer) return
      quarto.value = { checked: false, found: false }
      const status = await ipcRenderer.invoke('quarto:status', { refresh: true })
      quarto.value = { checked: true, ...status }
    }
    // The main process reads quarto.path from the saved settings
    const setQuartoPath = async (value) => {
      updateSetting('quarto.path', value)
      await store.dispatch('saveSettings')
      checkQuarto()
    }

    const keyDraft = ref('')
    const hasKey = ref(false)
    const keyMessage = ref({ text: '' })
    const defaultFolder = ref('Documents/PDF Annotator/Chats')

    onMounted(async () => {
      if (!ipcRenderer) return
      checkQuarto()
      const status = await ipcRenderer.invoke('llm:key-status')
      hasKey.value = Boolean(status?.keys?.tavily)
      if (!chat.value.chatsFolder) {
        defaultFolder.value = await ipcRenderer.invoke('get-chats-folder').catch(() => defaultFolder.value)
      }
    })

    const setKey = async (apiKey) => {
      if (!ipcRenderer) return
      const result = await ipcRenderer.invoke('llm:set-key', { providerId: 'tavily', apiKey })
      if (result.success) {
        hasKey.value = Boolean(result.keys.tavily)
        keyDraft.value = ''
        keyMessage.value = { text: apiKey ? 'Tavily key saved.' : 'Tavily key removed.', ok: Boolean(apiKey) }
      } else {
        keyMessage.value = { text: result.error, error: true }
      }
    }
    const saveKey = () => keyDraft.value.trim() && setKey(keyDraft.value)
    const removeKey = () => setKey('')

    return { quarto, quartoPath, checkQuarto, setQuartoPath, defaults, llm, chat, tools, updateSetting, clampInt, keyDraft, hasKey, keyMessage, saveKey, removeKey, defaultFolder }
  }
}
</script>

<style scoped>
.tools-subtitle {
  margin-top: 24px;
}

.ai-inline {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ai-wide {
  width: 260px;
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

.settings-hint.ai-ok {
  color: var(--success-color);
}

.settings-hint.ai-error {
  color: var(--danger-color);
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

.ai-template-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}
</style>
