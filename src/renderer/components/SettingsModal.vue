<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal">
      <div class="modal-header">
        <h2 class="modal-title">Settings</h2>
        <button class="modal-close" @click="$emit('close')">×</button>
      </div>
      
      <div class="modal-body">
        <!-- Markdown Settings -->
        <div class="settings-section">
          <h3 class="settings-section-title">Markdown Defaults</h3>
          
          <div class="settings-row">
            <label class="settings-label">Default Font Size</label>
            <input 
              type="number" 
              class="settings-input"
              :value="settings.markdown.fontSize"
              @input="updateSetting('markdown.fontSize', parseInt($event.target.value))"
              min="3"
              max="72"
            />
          </div>
          
          <div class="settings-row">
            <label class="settings-label">Default Line Height</label>
            <input 
              type="number" 
              class="settings-input"
              :value="settings.markdown.lineHeight"
              @input="updateSetting('markdown.lineHeight', parseFloat($event.target.value))"
              min="1"
              max="3"
              step="0.1"
            />
          </div>
          
          <div class="settings-row">
            <label class="settings-label">Default Font Family</label>
            <select 
              class="settings-input"
              :value="settings.markdown.fontFamily"
              @change="updateSetting('markdown.fontFamily', $event.target.value)"
            >
              <option value="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif">System Default</option>
              <option value="'Times New Roman', serif">Times New Roman</option>
              <option value="'Georgia', serif">Georgia</option>
              <option value="'Arial', sans-serif">Arial</option>
              <option value="'Consolas', monospace">Consolas</option>
            </select>
          </div>
        </div>
        
        <!-- Annotation Box Settings -->
        <div class="settings-section">
          <h3 class="settings-section-title">Annotation Box Defaults</h3>
          
          <div class="settings-row">
            <label class="settings-label">Default Width</label>
            <input 
              type="number" 
              class="settings-input"
              :value="settings.annotationBox.defaultWidth"
              @input="updateSetting('annotationBox.defaultWidth', parseInt($event.target.value))"
              min="100"
              max="1000"
            />
          </div>
          
          <div class="settings-row">
            <label class="settings-label">Default Height</label>
            <input 
              type="number" 
              class="settings-input"
              :value="settings.annotationBox.defaultHeight"
              @input="updateSetting('annotationBox.defaultHeight', parseInt($event.target.value))"
              min="50"
              max="800"
            />
          </div>
          
          <div class="settings-row">
            <label class="settings-label">Minimum Width</label>
            <input 
              type="number" 
              class="settings-input"
              :value="settings.annotationBox.minWidth"
              @input="updateSetting('annotationBox.minWidth', parseInt($event.target.value))"
              min="50"
              max="300"
            />
          </div>
          
          <div class="settings-row">
            <label class="settings-label">Content Padding (px)</label>
            <input 
              type="number" 
              class="settings-input"
              :value="settings.annotationBox.padding || 4"
              @input="updateSetting('annotationBox.padding', parseInt($event.target.value))"
              min="0"
              max="20"
            />
          </div>
          
          <div class="settings-row">
            <label class="settings-label">Minimum Height</label>
            <input 
              type="number" 
              class="settings-input"
              :value="settings.annotationBox.minHeight"
              @input="updateSetting('annotationBox.minHeight', parseInt($event.target.value))"
              min="30"
              max="200"
            />
          </div>
        </div>
        
        <!-- LaTeX Settings -->
        <div class="settings-section">
          <h3 class="settings-section-title">LaTeX Settings</h3>
          
          <div class="settings-row-full">
            <label class="settings-label">Custom LaTeX Macros (JSON format)</label>
            <textarea 
              class="settings-textarea"
              :value="latexMacrosJson"
              @input="updateLatexMacros($event.target.value)"
              placeholder='{"\\R": "\\mathbb{R}", "\\N": "\\mathbb{N}"}'
            ></textarea>
            <p class="settings-hint">
              Define custom LaTeX macros that will be available in all annotations.
              <br>Example: <code>{"\\R": "\\mathbb{R}", "\\vec": "\\mathbf{#1}"}</code>
            </p>
          </div>
        </div>
        
        <!-- Keyboard Shortcuts -->
        <div class="settings-section">
          <h3 class="settings-section-title">Keyboard Shortcuts</h3>
          
          <div class="settings-row">
            <label class="settings-label">Bold</label>
            <input 
              type="text" 
              class="settings-input shortcut-input"
              :value="settings.shortcuts.bold"
              @keydown="captureShortcut($event, 'shortcuts.bold')"
              readonly
            />
          </div>
          
          <div class="settings-row">
            <label class="settings-label">Italic</label>
            <input 
              type="text" 
              class="settings-input shortcut-input"
              :value="settings.shortcuts.italic"
              @keydown="captureShortcut($event, 'shortcuts.italic')"
              readonly
            />
          </div>
          
          <div class="settings-row">
            <label class="settings-label">Underline</label>
            <input 
              type="text" 
              class="settings-input shortcut-input"
              :value="settings.shortcuts.underline"
              @keydown="captureShortcut($event, 'shortcuts.underline')"
              readonly
            />
          </div>
          
          <div class="settings-row">
            <label class="settings-label">Hide Annotation</label>
            <input 
              type="text" 
              class="settings-input shortcut-input"
              :value="settings.shortcuts.hideAnnotation"
              @keydown="captureShortcut($event, 'shortcuts.hideAnnotation')"
              readonly
            />
          </div>
        </div>
        
        <!-- UI Settings -->
        <div class="settings-section">
          <h3 class="settings-section-title">UI Settings</h3>
          
          <div class="settings-row">
            <label class="settings-label">Theme</label>
            <select 
              class="settings-input"
              :value="settings.ui.theme"
              @change="updateSetting('ui.theme', $event.target.value)"
            >
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>
          
          <div class="settings-row">
            <label class="settings-label">Default Sidebar Width</label>
            <input 
              type="number" 
              class="settings-input"
              :value="settings.ui.sidebarWidth"
              @input="updateSetting('ui.sidebarWidth', parseInt($event.target.value))"
              min="150"
              max="400"
            />
          </div>
        </div>
      </div>
      
      <div class="modal-footer">
        <button class="btn btn-secondary" @click="resetToDefaults">
          Reset to Defaults
        </button>
        <button class="btn btn-primary" @click="saveAndClose">
          Save & Close
        </button>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, computed } from 'vue'
import { useStore } from 'vuex'

export default {
  name: 'SettingsModal',
  
  emits: ['close'],
  
  setup(props, { emit }) {
    const store = useStore()
    
    const settings = computed(() => store.state.settings)
    
    const latexMacrosJson = computed(() => {
      return JSON.stringify(settings.value.latex.macros, null, 2)
    })
    
    const updateSetting = (path, value) => {
      store.commit('SET_SETTING', { path, value })
    }
    
    const updateLatexMacros = (jsonStr) => {
      try {
        const macros = JSON.parse(jsonStr)
        updateSetting('latex.macros', macros)
      } catch (err) {
        // Invalid JSON, ignore
      }
    }
    
    const captureShortcut = (event, path) => {
      event.preventDefault()
      
      const parts = []
      if (event.ctrlKey) parts.push('Ctrl')
      if (event.altKey) parts.push('Alt')
      if (event.shiftKey) parts.push('Shift')
      
      if (event.key && !['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) {
        parts.push(event.key.toUpperCase())
      }
      
      if (parts.length > 1) {
        const shortcut = parts.join('+')
        updateSetting(path, shortcut)
      }
    }
    
    const resetToDefaults = () => {
      const defaults = {
        markdown: {
          fontSize: 14,
          lineHeight: 1.6,
          fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
        },
        annotationBox: {
          defaultWidth: 300,
          defaultHeight: 200,
          minWidth: 100,
          minHeight: 50,
          padding: 4
        },
        latex: {
          macros: {},
          throwOnError: false
        },
        shortcuts: {
          bold: 'Ctrl+B',
          italic: 'Ctrl+I',
          underline: 'Ctrl+U',
          save: 'Ctrl+S',
          hideAnnotation: 'Ctrl+H'
        },
        ui: {
          sidebarWidth: 200,
          sidebarVisible: true,
          theme: 'light'
        }
      }
      
      store.commit('SET_SETTINGS', defaults)
    }
    
    const saveAndClose = async () => {
      await store.dispatch('saveSettings')
      emit('close')
    }
    
    return {
      settings,
      latexMacrosJson,
      updateSetting,
      updateLatexMacros,
      captureShortcut,
      resetToDefaults,
      saveAndClose
    }
  }
}
</script>

<style scoped>
.settings-row-full {
  margin-bottom: 16px;
}

.settings-row-full .settings-label {
  display: block;
  margin-bottom: 8px;
  font-size: 13px;
}

.settings-hint {
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 6px;
}

.settings-hint code {
  background: var(--sidebar-bg);
  padding: 2px 4px;
  border-radius: 3px;
  font-size: 10px;
}

.shortcut-input {
  cursor: pointer;
  text-align: center;
  font-family: 'Consolas', monospace;
}
</style>
