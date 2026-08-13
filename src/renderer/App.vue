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
        @zoom-in="zoomIn"
        @zoom-out="zoomOut"
        @zoom-reset="zoomReset"
        @open-settings="openSettings"
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

// Safely get ipcRenderer
let ipcRenderer = null
try {
  ipcRenderer = require('electron').ipcRenderer
} catch (e) {
  console.warn('Running outside Electron context')
}

// Configure PDF.js worker path
if (typeof window !== 'undefined') {
  const isDev = process.env.NODE_ENV === 'development'
  if (isDev) {
    // Development: use node_modules path
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url
    ).toString()
  } else {
    // Production: worker is bundled in resources
    pdfjsLib.GlobalWorkerOptions.workerSrc = './pdf.worker.min.mjs'
  }
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
    SettingsModal
  },
  
  setup() {
    const store = useStore()
    const pdfViewer = ref(null)
    
    // Track the in-flight PDF loading task so it can be cancelled if the user
    // opens another PDF before the current one finishes loading.
    let currentLoadingTask = null
    
    // Computed properties
    const pdfDocument = computed(() => store.state.pdfDocument)
    const sidebarVisible = computed(() => store.state.sidebarVisible)
    const settingsModalOpen = computed(() => store.state.settingsModalOpen)
    const settings = computed(() => store.state.settings)
    
    // Methods
    const toggleSidebar = () => {
      store.commit('SET_SIDEBAR_VISIBLE', !sidebarVisible.value)
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
        const loadingTask = pdfjsLib.getDocument({
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
    
    const handleToggleSidebar = () => {
      toggleSidebar()
    }
    
    const handleZoomIn = () => zoomIn()
    const handleZoomOut = () => zoomOut()
    const handleZoomReset = () => zoomReset()
    const handleOpenSettings = () => openSettings()
    
    // Lifecycle
    onMounted(() => {
      // Load settings
      store.dispatch('loadSettings')
      
      // Register IPC listeners (only if in Electron)
      if (ipcRenderer) {
        ipcRenderer.on('open-pdf', handleOpenPdf)
        ipcRenderer.on('save-file', handleSaveFile)
        ipcRenderer.on('toggle-sidebar', handleToggleSidebar)
        ipcRenderer.on('zoom-in', handleZoomIn)
        ipcRenderer.on('zoom-out', handleZoomOut)
        ipcRenderer.on('zoom-reset', handleZoomReset)
        ipcRenderer.on('open-settings', handleOpenSettings)
      }
      
      // Global keyboard shortcuts
      window.addEventListener('keydown', handleGlobalKeydown)
    })
    
    onUnmounted(() => {
      if (ipcRenderer) {
        ipcRenderer.removeListener('open-pdf', handleOpenPdf)
        ipcRenderer.removeListener('save-file', handleSaveFile)
        ipcRenderer.removeListener('toggle-sidebar', handleToggleSidebar)
        ipcRenderer.removeListener('zoom-in', handleZoomIn)
        ipcRenderer.removeListener('zoom-out', handleZoomOut)
        ipcRenderer.removeListener('zoom-reset', handleZoomReset)
        ipcRenderer.removeListener('open-settings', handleOpenSettings)
      }
      
      window.removeEventListener('keydown', handleGlobalKeydown)
    })
    
    const handleGlobalKeydown = (e) => {
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
      
      try {
        // Show dialog asking where to concatenate
        const result = await ipcRenderer.invoke('show-pdf-concat-dialog', {
          pdfName: droppedPdfPath.split(/[\\/]/).pop()
        })
        
        if (result === 'cancel') return
        
        const position = result // 'beginning' or 'end'
        const currentPdfPath = store.state.pdfPath
        
        // Get the directory of the current PDF
        const currentDir = currentPdfPath.substring(0, currentPdfPath.lastIndexOf('\\'))
        const droppedFileName = droppedPdfPath.split(/[\\/]/).pop()
        const targetPath = `${currentDir}\\${droppedFileName}`
        
        // Copy the dropped PDF to the same folder (with overwrite confirmation)
        const copyResult = await ipcRenderer.invoke('copy-pdf-file', {
          sourcePath: droppedPdfPath,
          targetPath: targetPath
        })
        
        if (!copyResult.success) {
          console.log('Copy cancelled or failed')
          return
        }
        
        // Get page count of the dropped PDF
        const pageCount = await ipcRenderer.invoke('get-pdf-page-count', targetPath)
        
        // Load the dropped PDF
        const buffer = await ipcRenderer.invoke('read-pdf-file', targetPath)
        const uint8Array = new Uint8Array(buffer)
        const loadingTask = pdfjsLib.getDocument({
          data: uint8Array,
          verbosity: 0,
          stopAtErrors: false,
          isEvalSupported: false,
          useSystemFonts: true
        })
        const droppedPdf = await loadingTask.promise
        
        // Add to store
        store.commit('ADD_CONCATENATED_PDF', {
          position,
          pdfPath: targetPath,
          pageCount,
          document: droppedPdf
        })
        
        // Mark as dirty and save
        store.commit('MARK_DIRTY')
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
      handleDrop
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
