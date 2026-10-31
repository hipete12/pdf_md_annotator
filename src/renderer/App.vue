<template>
  <div 
    class="app-container" 
    :class="{ 'theme-dark': settings?.ui?.theme === 'dark' }"
    @dragover.prevent
    @drop="handleDrop"
  >
    <!-- Sidebar -->
    <Sidebar 
      v-if="pdfDocument"
      :collapsed="!sidebarVisible"
      @toggle="toggleSidebar"
    />
    
    <!-- Sidebar toggle button when collapsed -->
    <button 
      v-if="pdfDocument && !sidebarVisible"
      class="sidebar-expand-btn"
      @click="toggleSidebar"
      title="Show sidebar"
    >
      ▶
    </button>
    
    <!-- Main content -->
    <div class="main-content">
      <!-- Toolbar -->
      <Toolbar 
        v-if="pdfDocument"
        :chat-open="chatVisible"
        @zoom-in="zoomIn"
        @zoom-out="zoomOut"
        @zoom-reset="zoomReset"
        @open-settings="openSettings"
        @toggle-chat="toggleChat"
      />
      
      <!-- PDF Viewer -->
      <PdfViewer 
        v-if="pdfDocument"
        ref="pdfViewer"
      />
      
      <!-- Welcome screen when no PDF is loaded -->
      <WelcomeScreen 
        v-else
        @open-file="openFile"
      />
    </div>
    
    <!-- Chat (right side, resizable; can go full screen) -->
    <ChatPanel
      v-if="pdfDocument && chatVisible"
      @close="toggleChat"
      @open-settings="openSettings"
    />
    
    <!-- Settings Modal -->
    <SettingsModal 
      v-if="settingsModalOpen"
      @close="closeSettings"
    />
  </div>
</template>

<script>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useStore } from 'vuex'
import * as pdfjsLib from 'pdfjs-dist'
import Sidebar from './components/Sidebar.vue'
import Toolbar from './components/Toolbar.vue'
import PdfViewer from './components/PdfViewer.vue'
import WelcomeScreen from './components/WelcomeScreen.vue'
import SettingsModal from './components/SettingsModal.vue'
import ChatPanel from './components/chat/ChatPanel.vue'

// Safely get ipcRenderer
let ipcRenderer = null
try {
  ipcRenderer = require('electron').ipcRenderer
} catch (e) {
  console.warn('Running outside Electron context')
}

const path = require('path')

// Configure PDF.js worker path
if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = './pdf.worker.min.mjs'
}

// Configure PDF.js to handle rendering errors gracefully
const pdfOptions = {
  verbosity: 0, // Reduce console warnings
  standardFontDataUrl: null,
  enableXfa: false,
  isEvalSupported: false,
  disableAutoFetch: false,
  disableStream: false,
  disableFontFace: false
}

export default {
  name: 'App',
  
  components: {
    Sidebar,
    Toolbar,
    PdfViewer,
    WelcomeScreen,
    SettingsModal,
    ChatPanel
  },
  
  setup() {
    const store = useStore()
    const pdfViewer = ref(null)
    
    // Track the in-flight PDF loading task so it can be cancelled if the user
    // opens another PDF before the current one finishes loading.
    let currentLoadingTask = null

    // PDF-only select-all mode used to keep copied text free of annotations.
    let pdfSelectAllActive = false
    let pdfSelectAllText = ''
    
    // Computed properties
    const pdfDocument = computed(() => store.state.pdfDocument)
    const sidebarVisible = computed(() => store.state.sidebarVisible)
    const settingsModalOpen = computed(() => store.state.settingsModalOpen)
    const settings = computed(() => store.state.settings)
    const chatVisible = computed(() => Boolean(store.state.settings.chat?.panelVisible))
    
    // Methods
    const toggleSidebar = () => {
      store.commit('SET_SIDEBAR_VISIBLE', !sidebarVisible.value)
    }
    
    const toggleChat = () => {
      const visible = !chatVisible.value
      store.commit('SET_SETTING', { path: 'chat.panelVisible', value: visible })
      if (!visible) store.dispatch('chat/setFullscreen', false)
      store.dispatch('saveSettings')
    }
    
    const zoomIn = () => {
      store.commit('SET_SCALE', store.state.scale + 0.25)
    }
    
    const zoomOut = () => {
      store.commit('SET_SCALE', store.state.scale - 0.25)
    }
    
    const zoomReset = () => {
      store.commit('SET_SCALE', 1.0)
    }
    
    const openSettings = () => {
      store.commit('SET_SETTINGS_MODAL', true)
    }
    
    const closeSettings = () => {
      store.commit('SET_SETTINGS_MODAL', false)
    }
    
    const openFile = async () => {
      if (!ipcRenderer) return
      await ipcRenderer.invoke('open-file-dialog')
    }
    
    const loadPdf = async (filePath, annotations) => {
      if (!ipcRenderer) return
      let loadingTask = null
      try {
        // If a previous load is still in flight, cancel/destroy it before starting a new one
        if (currentLoadingTask) {
          try {
            currentLoadingTask.destroy()
          } catch (e) {
            // Best-effort cleanup; ignore errors from already-settled tasks
          }
          currentLoadingTask = null
        }
        
        console.log('Loading PDF:', filePath)
        const buffer = await ipcRenderer.invoke('read-pdf-file', filePath)
        if (!buffer) {
          console.error('Failed to read PDF file')
          return
        }
        
        console.log('Buffer received, length:', buffer.length || buffer.byteLength)
        
        // Convert Buffer to Uint8Array for PDF.js
        const uint8Array = new Uint8Array(buffer)
        console.log('Uint8Array created, length:', uint8Array.length)
        
        // Load PDF with error handling options
        loadingTask = pdfjsLib.getDocument({
          data: uint8Array,
          verbosity: 0, // Suppress non-critical warnings
          standardFontDataUrl: null,
          stopAtErrors: false, // Continue even if some pages have errors
          isEvalSupported: false,
          useSystemFonts: true,
          disableFontFace: false,
          fontExtraProperties: false,
          pdfBug: false,
          maxImageSize: -1, // Allow large images
          cMapUrl: null,
          cMapPacked: false
        })
        currentLoadingTask = loadingTask
        
        const pdf = await loadingTask.promise
        if (currentLoadingTask === loadingTask) currentLoadingTask = null
        console.log('PDF loaded, pages:', pdf.numPages)
        
        store.commit('SET_PDF_DOCUMENT', { document: pdf, path: filePath })
        
        if (annotations) {
          store.dispatch('loadPdfmark', annotations)
          
          // Load concatenated PDFs if any
          if (annotations.concatenatedPdfs && annotations.concatenatedPdfs.length > 0) {
            await loadConcatenatedPdfs(annotations.concatenatedPdfs)
          }
        }
      } catch (err) {
        if (currentLoadingTask === loadingTask) currentLoadingTask = null
        console.error('Failed to load PDF:', err)
      }
    }
    
    // Load additional concatenated PDFs from saved .pdfmark data
    const loadConcatenatedPdfs = async (concatenatedPdfs) => {
      if (!ipcRenderer) return
      
      for (const concat of concatenatedPdfs) {
        try {
          console.log('Loading concatenated PDF:', concat.pdfPath)
          const buffer = await ipcRenderer.invoke('read-pdf-file', concat.pdfPath)
          if (!buffer) {
            console.warn('Could not load concatenated PDF:', concat.pdfPath)
            continue
          }
          
          const uint8Array = new Uint8Array(buffer)
          const loadingTask = pdfjsLib.getDocument({
            data: uint8Array,
            verbosity: 0,
            stopAtErrors: false,
            isEvalSupported: false,
            useSystemFonts: true
          })
          const pdf = await loadingTask.promise
          
          // Store the document reference without modifying page order (it's already correct from saved data)
          store.commit('SET_ADDITIONAL_PDF', { pdfPath: concat.pdfPath, document: pdf })
        } catch (err) {
          console.error('Failed to load concatenated PDF:', concat.pdfPath, err)
        }
      }
    }
    
    // IPC event handlers
    const handleOpenPdf = (event, { filePath, annotations }) => {
      loadPdf(filePath, annotations)
    }
    
    const handleSaveFile = () => {
      store.dispatch('savePdfmark', { commit: true })
    }
    
    const handleSaveFileAs = () => {
      store.dispatch('savePdfmarkAs')
    }
    
    const handleToggleSidebar = () => {
      toggleSidebar()
    }
    
    const handleZoomIn = () => zoomIn()
    const handleZoomOut = () => zoomOut()
    const handleZoomReset = () => zoomReset()
    const handleOpenSettings = () => openSettings()
    const handleToggleChat = () => {
      if (pdfDocument.value) toggleChat()
    }
    
    // Lifecycle
    onMounted(() => {
      // Load settings
      store.dispatch('loadSettings')
      
      // Register IPC listeners (only if in Electron)
      if (ipcRenderer) {
        ipcRenderer.on('open-pdf', handleOpenPdf)
        ipcRenderer.on('save-file', handleSaveFile)
        ipcRenderer.on('save-file-as', handleSaveFileAs)
        ipcRenderer.on('toggle-sidebar', handleToggleSidebar)
        ipcRenderer.on('zoom-in', handleZoomIn)
        ipcRenderer.on('zoom-out', handleZoomOut)
        ipcRenderer.on('zoom-reset', handleZoomReset)
        ipcRenderer.on('open-settings', handleOpenSettings)
        ipcRenderer.on('toggle-chat', handleToggleChat)
      }
      
      // Global keyboard shortcuts
      window.addEventListener('keydown', handleGlobalKeydown)

      // Clean PDF-only copy handling for Ctrl+A selections
      document.addEventListener('copy', handlePdfSelectAllCopy)
      document.addEventListener('mousedown', clearPdfSelectAllMode, true)
      document.addEventListener('selectionchange', handlePdfSelectionChange)
    })
    
    onUnmounted(() => {
      if (ipcRenderer) {
        ipcRenderer.removeListener('open-pdf', handleOpenPdf)
        ipcRenderer.removeListener('save-file', handleSaveFile)
        ipcRenderer.removeListener('save-file-as', handleSaveFileAs)
        ipcRenderer.removeListener('toggle-sidebar', handleToggleSidebar)
        ipcRenderer.removeListener('zoom-in', handleZoomIn)
        ipcRenderer.removeListener('zoom-out', handleZoomOut)
        ipcRenderer.removeListener('zoom-reset', handleZoomReset)
        ipcRenderer.removeListener('open-settings', handleOpenSettings)
        ipcRenderer.removeListener('toggle-chat', handleToggleChat)
      }
      
      window.removeEventListener('keydown', handleGlobalKeydown)
      document.removeEventListener('copy', handlePdfSelectAllCopy)
      document.removeEventListener('mousedown', clearPdfSelectAllMode, true)
      document.removeEventListener('selectionchange', handlePdfSelectionChange)
    })
    
    const getElementTarget = (target) => {
      if (!target) return null
      if (target.nodeType === Node.ELEMENT_NODE) return target
      return target.parentElement || null
    }

    const isTextEntryTarget = (target) => {
      const element = getElementTarget(target)
      if (!element || typeof element.closest !== 'function') return false
      return Boolean(element.closest(
        'textarea, input, select, [contenteditable]:not([contenteditable="false"])'
      ))
    }

    const clearPdfSelectAllMode = () => {
      pdfSelectAllActive = false
      pdfSelectAllText = ''
      document.querySelector('.pdf-pages-container')
        ?.classList.remove('pdf-select-all-mode')
    }

    const selectAllPdfText = () => {
      const selection = window.getSelection()
      if (!selection) return false

      const annotationLayers = Array.from(
        document.querySelectorAll('.pdf-pages-container .annotation-layer')
      )
      const previousDisplays = annotationLayers.map(layer => layer.style.display)
      let text = ''

      try {
        // Hide annotation overlays so their text/emoji cannot enter the Range.
        for (const layer of annotationLayers) {
          layer.style.display = 'none'
        }

        const layers = document.querySelectorAll('.pdf-pages-container .textLayer')
        let firstNode = null
        let lastNode = null

        for (const layer of layers) {
          const walker = document.createTreeWalker(
            layer,
            NodeFilter.SHOW_TEXT,
            {
              acceptNode(node) {
                return node.nodeValue && node.nodeValue.length > 0
                  ? NodeFilter.FILTER_ACCEPT
                  : NodeFilter.FILTER_REJECT
              }
            }
          )
          let node = walker.nextNode()
          while (node) {
            if (!firstNode) firstNode = node
            lastNode = node
            node = walker.nextNode()
          }
        }

        if (!firstNode || !lastNode) return false

        const range = document.createRange()
        range.setStart(firstNode, 0)
        range.setEnd(lastNode, lastNode.nodeValue.length)
        selection.removeAllRanges()
        selection.addRange(range)
        text = selection.toString()
      } finally {
        annotationLayers.forEach((layer, index) => {
          layer.style.display = previousDisplays[index]
        })
      }

      document.querySelector('.pdf-pages-container')
        ?.classList.add('pdf-select-all-mode')
      pdfSelectAllActive = true
      pdfSelectAllText = text
      return true
    }

    const handlePdfSelectAllCopy = (event) => {
      if (!pdfSelectAllActive || !pdfSelectAllText) return
      if (!event.clipboardData) return
      event.clipboardData.setData('text/plain', pdfSelectAllText)
      event.preventDefault()
    }

    const handlePdfSelectionChange = () => {
      if (!pdfSelectAllActive) return
      const selection = window.getSelection()
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
        clearPdfSelectAllMode()
      }
    }

    const handleGlobalKeydown = (e) => {
      // Esc leaves full-screen chat (unless a modal is open on top of it)
      if (e.key === 'Escape' && !e.defaultPrevented && store.state.chat.fullscreen && !settingsModalOpen.value) {
        e.preventDefault()
        store.dispatch('chat/setFullscreen', false)
        return
      }

      // Ctrl+A / Cmd+A selects only the rendered PDF text, unless focus is in
      // a native text field where select-all should behave normally.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        if (!isTextEntryTarget(e.target) && selectAllPdfText()) {
          e.preventDefault()
        }
        return
      }

      // Ctrl+, to open settings
      if (e.ctrlKey && e.key === ',') {
        e.preventDefault()
        openSettings()
      }

      // Ctrl+S to save
      if (e.ctrlKey && e.key === 's') {
        e.preventDefault()
        store.dispatch('savePdfmark', { commit: true })
      }
      
      // Ctrl+Z to undo
      if (e.ctrlKey && e.key === 'z' && !e.shiftKey) {
        // Don't undo if user is typing in an input
        if (e.target.closest('textarea, input')) return
        
        e.preventDefault()
        store.dispatch('undo')
      }
      
      // Ctrl+Y or Ctrl+Shift+Z to redo
      if ((e.ctrlKey && e.key === 'y') || (e.ctrlKey && e.shiftKey && e.key === 'Z')) {
        // Don't redo if user is typing in an input
        if (e.target.closest('textarea, input')) return
        
        e.preventDefault()
        store.dispatch('redo')
      }
      
      // Ctrl++ to zoom in (both = and + keys)
      if (e.ctrlKey && (e.key === '+' || e.key === '=')) {
        e.preventDefault()
        zoomIn()
      }
      
      // Ctrl+- to zoom out
      if (e.ctrlKey && e.key === '-') {
        e.preventDefault()
        zoomOut()
      }
      
      // Ctrl+0 to reset zoom
      if (e.ctrlKey && e.key === '0') {
        e.preventDefault()
        zoomReset()
      }
    }
    
    // Handle PDF drop for concatenation
    const handleDrop = async (e) => {
      e.preventDefault()
      
      const files = Array.from(e.dataTransfer.files)
      const pdfFile = files.find(f => f.name.toLowerCase().endsWith('.pdf'))
      
      if (!pdfFile) return
      
      // If no PDF is open, just open this one
      if (!pdfDocument.value) {
        if (ipcRenderer) {
          await ipcRenderer.invoke('open-pdf-at-path', pdfFile.path)
        }
        return
      }
      
      // A PDF is already open - ask about concatenation
      await handleConcatenatePdf(pdfFile.path)
    }
    
    const handleConcatenatePdf = async (droppedPdfPath) => {
      if (!ipcRenderer) return

      const currentPdfPath = store.state.pdfPath
      if (!currentPdfPath) return
      
      try {
        // Show dialog asking where to concatenate
        const result = await ipcRenderer.invoke('show-pdf-concat-dialog', {
          pdfName: droppedPdfPath.split(/[\\/]/).pop()
        })
        
        if (result === 'cancel') return
        
        const position = result // 'beginning' or 'end'
        const targetPath = path.join(
          path.dirname(currentPdfPath),
          path.basename(droppedPdfPath)
        )
        
        // Copy the dropped PDF to the same folder (with overwrite confirmation)
        const copyResult = await ipcRenderer.invoke('copy-pdf-file', {
          sourcePath: droppedPdfPath,
          targetPath: targetPath
        })
        
        if (!copyResult.success) {
          console.log('Copy cancelled or failed')
          return
        }
        
        // Load the dropped PDF
        const buffer = await ipcRenderer.invoke('read-pdf-file', targetPath)
        if (!buffer) {
          console.error('Failed to read dropped PDF:', targetPath)
          return
        }
        const uint8Array = new Uint8Array(buffer)
        const loadingTask = pdfjsLib.getDocument({
          data: uint8Array,
          verbosity: 0,
          stopAtErrors: false,
          isEvalSupported: false,
          useSystemFonts: true
        })
        const droppedPdf = await loadingTask.promise
        
        // Add to store (page count comes from PDF.js, which parses the file
        // properly, including page objects inside compressed object streams)
        store.commit('ADD_CONCATENATED_PDF', {
          position,
          pdfPath: targetPath,
          pageCount: droppedPdf.numPages,
          document: droppedPdf
        })
        
        // Save the updated annotation data
        store.dispatch('savePdfmark', { commit: true })
        
      } catch (err) {
        console.error('Failed to concatenate PDF:', err)
      }
    }
    
    return {
      pdfViewer,
      pdfDocument,
      sidebarVisible,
      settingsModalOpen,
      settings,
      toggleSidebar,
      zoomIn,
      zoomOut,
      zoomReset,
      openSettings,
      closeSettings,
      openFile,
      handleDrop,
      chatVisible,
      toggleChat
    }
  }
}
</script>

<style scoped>
.sidebar-expand-btn {
  position: fixed;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  background: var(--sidebar-bg);
  border: 1px solid var(--border-color);
  border-left: none;
  border-radius: 0 4px 4px 0;
  padding: 12px 6px;
  cursor: pointer;
  z-index: 100;
  color: var(--text-muted);
  font-size: 12px;
}

.sidebar-expand-btn:hover {
  background: var(--border-color);
  color: var(--text-color);
}
</style>
