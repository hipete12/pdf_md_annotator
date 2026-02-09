import { createStore } from 'vuex'
import { markRaw } from 'vue'
import { v4 as uuidv4 } from 'uuid'

// Safely get ipcRenderer - may not be available in browser context
let ipcRenderer = null
try {
  ipcRenderer = require('electron').ipcRenderer
} catch (e) {
  console.warn('Running outside Electron context')
}

// Debounce helper for auto-save
function debounce(fn, delay) {
  let timeoutId
  return function (...args) {
    clearTimeout(timeoutId)
    timeoutId = setTimeout(() => fn.apply(this, args), delay)
  }
}

export default createStore({
  state: {
    // PDF state
    pdfPath: null,
    pdfDocument: null,
    pageCount: 0,
    currentPage: 1,
    scale: 1.0,
    pageOrder: [], // Array of page indices for reordering
    deletedPages: [], // Track deleted pages
    
    // Sidebar state
    sidebarVisible: true,
    sidebarWidth: 200,
    selectedPages: [], // Multi-select support
    
    // Annotations
    annotations: {}, // { pageIndex: [annotation, ...] }
    selectedAnnotation: null,
    
    // Settings
    settings: {
      markdown: {
        fontSize: 14,
        lineHeight: 1.6,
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
      },
      annotationBox: {
        defaultWidth: 300,
        defaultHeight: 200,
        minWidth: 30,
        minHeight: 20
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
    },
    
    // UI state
    settingsModalOpen: false,
    isDirty: false, // Track unsaved changes
    
    // Undo/Redo history
    undoStack: [],
    redoStack: [],
    maxUndoSteps: 50,
    
    // Concatenated PDFs tracking
    // Each entry: { pdfPath: string, pageStart: number, pageCount: number, position: string }
    concatenatedPdfs: [],
    
    // Additional loaded PDF documents (for concatenated PDFs)
    // Keyed by pdfPath, values are PDF.js document objects
    additionalPdfs: {},
    
    // .pdfmark file version for extensibility
    pdfmarkVersion: '1.0.0'
  },

  getters: {
    currentPageAnnotations: (state) => {
      return state.annotations[state.currentPage] || []
    },
    
    visiblePages: (state) => {
      return state.pageOrder.filter(idx => !state.deletedPages.includes(idx))
    },
    
    hasUnsavedChanges: (state) => state.isDirty,
    
    annotationById: (state) => (id) => {
      for (const pageAnnotations of Object.values(state.annotations)) {
        const found = pageAnnotations.find(a => a.id === id)
        if (found) return found
      }
      return null
    },
    
    latexMacros: (state) => state.settings.latex.macros,
    
    // Map a virtual page number to its source PDF and actual page within that PDF
    // Returns { document, actualPage } where document is the PDF.js document
    getPageSource: (state) => (virtualPage) => {
      // If no concatenated PDFs, all pages are from main document
      if (!state.concatenatedPdfs || state.concatenatedPdfs.length === 0) {
        return { 
          document: state.pdfDocument, 
          actualPage: virtualPage, 
          pdfPath: state.pdfPath 
        }
      }
      
      // Check concatenated PDFs first
      for (const concat of state.concatenatedPdfs) {
        const pageEnd = concat.pageStart + concat.pageCount - 1
        if (virtualPage >= concat.pageStart && virtualPage <= pageEnd) {
          const actualPage = virtualPage - concat.pageStart + 1
          const document = state.additionalPdfs[concat.pdfPath]
          return { document, actualPage, pdfPath: concat.pdfPath }
        }
      }
      
      // Otherwise it's from the main PDF
      // Need to account for shifted page numbers if PDFs were added to beginning
      let mainPageOffset = 0
      for (const concat of state.concatenatedPdfs) {
        if (concat.position === 'beginning') {
          mainPageOffset += concat.pageCount
        }
      }
      
      // The actual page in main PDF
      const actualPage = virtualPage - mainPageOffset
      return { 
        document: state.pdfDocument, 
        actualPage, 
        pdfPath: state.pdfPath 
      }
    }
  },

  mutations: {
    SET_PDF_DOCUMENT(state, { document, path }) {
      // Use markRaw to prevent Vue's Proxy from wrapping the PDF document
      // PDF.js uses private class fields (#) which don't work through Proxy
      state.pdfDocument = markRaw(document)
      state.pdfPath = path
      state.pageCount = document.numPages
      state.pageOrder = Array.from({ length: document.numPages }, (_, i) => i + 1)
      state.deletedPages = []
      state.annotations = {}
      state.concatenatedPdfs = []
      state.additionalPdfs = {}
      state.currentPage = 1
      state.isDirty = false
    },
    
    SET_CURRENT_PAGE(state, page) {
      state.currentPage = page
    },
    
    SET_SCALE(state, scale) {
      state.scale = Math.max(0.25, Math.min(4, scale))
    },
    
    SET_SIDEBAR_VISIBLE(state, visible) {
      state.sidebarVisible = visible
    },
    
    SET_SIDEBAR_WIDTH(state, width) {
      state.sidebarWidth = width
    },
    
    SET_SELECTED_PAGES(state, pages) {
      state.selectedPages = pages
    },
    
    REORDER_PAGES(state, { fromIndex, toIndex }) {
      const [removed] = state.pageOrder.splice(fromIndex, 1)
      state.pageOrder.splice(toIndex, 0, removed)
      state.isDirty = true
    },
    
    DELETE_PAGES(state, pageIndices) {
      pageIndices.forEach(idx => {
        if (!state.deletedPages.includes(idx)) {
          state.deletedPages.push(idx)
        }
      })
      state.selectedPages = []
      state.isDirty = true
    },
    
    RESTORE_PAGE(state, pageIndex) {
      state.deletedPages = state.deletedPages.filter(idx => idx !== pageIndex)
      state.isDirty = true
    },
    
    ADD_ANNOTATION(state, { pageIndex, annotation }) {
      if (!state.annotations[pageIndex]) {
        state.annotations[pageIndex] = []
      }
      state.annotations[pageIndex].push({
        id: uuidv4(),
        type: 'markdown',
        x: annotation.x,
        y: annotation.y,
        width: state.settings.annotationBox.defaultWidth,
        height: state.settings.annotationBox.defaultHeight,
        content: '',
        style: { ...state.settings.markdown },
        isCollapsed: false,
        collapsedTitle: '',
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        ...annotation
      })
      state.isDirty = true
    },
    
    UPDATE_ANNOTATION(state, { id, updates }) {
      for (const pageAnnotations of Object.values(state.annotations)) {
        const annotation = pageAnnotations.find(a => a.id === id)
        if (annotation) {
          Object.assign(annotation, updates, { modified: new Date().toISOString() })
          state.isDirty = true
          break
        }
      }
    },
    
    DELETE_ANNOTATION(state, id) {
      for (const [pageIndex, pageAnnotations] of Object.entries(state.annotations)) {
        const index = pageAnnotations.findIndex(a => a.id === id)
        if (index !== -1) {
          pageAnnotations.splice(index, 1)
          state.isDirty = true
          break
        }
      }
    },
    
    SET_SELECTED_ANNOTATION(state, id) {
      state.selectedAnnotation = id
    },
    
    TOGGLE_ANNOTATION_COLLAPSED(state, id) {
      for (const pageAnnotations of Object.values(state.annotations)) {
        const annotation = pageAnnotations.find(a => a.id === id)
        if (annotation) {
          annotation.isCollapsed = !annotation.isCollapsed
          state.isDirty = true
          break
        }
      }
    },
    
    SET_ANNOTATION_COLLAPSED_TITLE(state, { id, title }) {
      for (const pageAnnotations of Object.values(state.annotations)) {
        const annotation = pageAnnotations.find(a => a.id === id)
        if (annotation) {
          annotation.collapsedTitle = title
          annotation.isCollapsed = true
          state.isDirty = true
          break
        }
      }
    },
    
    LOAD_ANNOTATIONS(state, data) {
      if (data) {
        state.annotations = data.annotations || {}
        state.pageOrder = data.pageOrder || state.pageOrder
        state.deletedPages = data.deletedPages || []
        state.pdfmarkVersion = data.version || '1.0.0'
        state.concatenatedPdfs = data.concatenatedPdfs || []
        
        // Merge settings if present
        if (data.settings) {
          state.settings = { ...state.settings, ...data.settings }
        }
      }
      state.isDirty = false
    },
    
    // Set an additional PDF document (for loading saved concatenated PDFs)
    SET_ADDITIONAL_PDF(state, { pdfPath, document }) {
      if (!state.additionalPdfs) {
        state.additionalPdfs = {}
      }
      state.additionalPdfs[pdfPath] = markRaw(document)
    },
    
    // Add concatenated PDF info and update pages
    ADD_CONCATENATED_PDF(state, { position, pdfPath, pageCount, document }) {
      const currentPageCount = state.pageOrder.length
      
      // Create entry for saving (without document reference)
      const entry = { 
        pdfPath, 
        pageCount,
        position,
        pageStart: position === 'beginning' ? 1 : currentPageCount + 1
      }
      
      if (position === 'beginning') {
        // Shift existing page numbers in pageOrder
        const shiftedPageOrder = state.pageOrder.map(p => p + pageCount)
        const newPages = Array.from({ length: pageCount }, (_, i) => i + 1)
        state.pageOrder = [...newPages, ...shiftedPageOrder]
        
        // Shift annotations page keys
        const shiftedAnnotations = {}
        for (const [pageKey, annotations] of Object.entries(state.annotations)) {
          shiftedAnnotations[parseInt(pageKey) + pageCount] = annotations
        }
        state.annotations = shiftedAnnotations
        
        // Shift deleted pages
        state.deletedPages = state.deletedPages.map(p => p + pageCount)
        
        // Shift existing concatenatedPdfs page starts
        state.concatenatedPdfs.forEach(pdf => {
          pdf.pageStart += pageCount
        })
        state.concatenatedPdfs.unshift(entry)
      } else {
        // Add to end
        const newPages = Array.from({ length: pageCount }, (_, i) => currentPageCount + i + 1)
        state.pageOrder = [...state.pageOrder, ...newPages]
        state.concatenatedPdfs.push(entry)
      }
      
      // Store the document reference (using markRaw to avoid Vue proxy issues)
      if (!state.additionalPdfs) {
        state.additionalPdfs = {}
      }
      state.additionalPdfs[pdfPath] = markRaw(document)
      
      state.pageCount = state.pageOrder.length
      state.isDirty = true
    },
    
    SET_SETTINGS(state, settings) {
      state.settings = { ...state.settings, ...settings }
      state.isDirty = true
    },
    
    SET_SETTING(state, { path, value }) {
      const keys = path.split('.')
      let obj = state.settings
      for (let i = 0; i < keys.length - 1; i++) {
        obj = obj[keys[i]]
      }
      obj[keys[keys.length - 1]] = value
      state.isDirty = true
    },
    
    SET_SETTINGS_MODAL(state, open) {
      state.settingsModalOpen = open
    },
    
    MARK_CLEAN(state) {
      state.isDirty = false
    },
    
    // Undo/Redo mutations
    PUSH_UNDO(state, action) {
      state.undoStack.push(action)
      if (state.undoStack.length > state.maxUndoSteps) {
        state.undoStack.shift()
      }
      // Clear redo stack when new action is performed
      state.redoStack = []
    },
    
    POP_UNDO(state) {
      return state.undoStack.pop()
    },
    
    PUSH_REDO(state, action) {
      state.redoStack.push(action)
    },
    
    POP_REDO(state) {
      return state.redoStack.pop()
    },
    
    CLEAR_HISTORY(state) {
      state.undoStack = []
      state.redoStack = []
    }
  },

  actions: {
    async loadSettings({ commit }) {
      if (!ipcRenderer) return
      try {
        const settings = await ipcRenderer.invoke('get-settings')
        commit('SET_SETTINGS', settings)
      } catch (err) {
        console.error('Failed to load settings:', err)
      }
    },
    
    async saveSettings({ state }) {
      if (!ipcRenderer) return
      try {
        await ipcRenderer.invoke('set-settings', state.settings)
      } catch (err) {
        console.error('Failed to save settings:', err)
      }
    },
    
    // Auto-save (debounced)
    autoSave: debounce(async function({ state, dispatch }) {
      if (state.pdfPath && state.isDirty) {
        await dispatch('savePdfmark', { commit: false })
      }
    }, 2000),
    
    async savePdfmark({ state, commit }, { commit: commitFile = true } = {}) {
      if (!state.pdfPath || !ipcRenderer) return
      
      // Create a plain JSON-serializable copy of the data
      // This avoids "An object could not be cloned" errors with IPC
      const data = JSON.parse(JSON.stringify({
        version: state.pdfmarkVersion,
        pdfPath: state.pdfPath,
        created: new Date().toISOString(),
        annotations: state.annotations,
        pageOrder: state.pageOrder,
        deletedPages: state.deletedPages,
        concatenatedPdfs: state.concatenatedPdfs,
        settings: {
          markdown: state.settings.markdown,
          latex: state.settings.latex
        }
      }))
      
      try {
        await ipcRenderer.invoke('save-pdfmark', {
          pdfPath: state.pdfPath,
          data
        })
        
        if (commitFile) {
          await ipcRenderer.invoke('commit-pdfmark', {
            pdfPath: state.pdfPath
          })
          commit('MARK_CLEAN')
        }
      } catch (err) {
        console.error('Failed to save .pdfmark:', err)
      }
    },
    
    loadPdfmark({ commit }, data) {
      commit('LOAD_ANNOTATIONS', data)
      commit('CLEAR_HISTORY')
    },
    
    createAnnotation({ commit, state, getters }, { pageIndex, x, y }) {
      commit('ADD_ANNOTATION', {
        pageIndex,
        annotation: { x, y }
      })
      
      // Find the newly created annotation (last one on the page)
      const pageAnnotations = state.annotations[pageIndex] || []
      const newAnnotation = pageAnnotations[pageAnnotations.length - 1]
      if (newAnnotation) {
        commit('PUSH_UNDO', {
          type: 'CREATE_ANNOTATION',
          pageIndex,
          annotation: JSON.parse(JSON.stringify(newAnnotation))
        })
      }
    },
    
    updateAnnotation({ commit, dispatch, getters }, { id, updates, skipUndo = false }) {
      // Save previous state for undo (unless skipping)
      if (!skipUndo) {
        const annotation = getters.annotationById(id)
        if (annotation) {
          commit('PUSH_UNDO', {
            type: 'UPDATE_ANNOTATION',
            id,
            previousState: JSON.parse(JSON.stringify(annotation)),
            newState: { ...annotation, ...updates }
          })
        }
      }
      
      commit('UPDATE_ANNOTATION', { id, updates })
      dispatch('autoSave')
    },
    
    deleteAnnotation({ commit, dispatch, getters, state }, id) {
      // Save for undo
      const annotation = getters.annotationById(id)
      let pageIndex = null
      
      // Find which page this annotation is on
      for (const [page, annotations] of Object.entries(state.annotations)) {
        if (annotations.find(a => a.id === id)) {
          pageIndex = parseInt(page)
          break
        }
      }
      
      if (annotation && pageIndex !== null) {
        commit('PUSH_UNDO', {
          type: 'DELETE_ANNOTATION',
          pageIndex,
          annotation: JSON.parse(JSON.stringify(annotation))
        })
      }
      
      commit('DELETE_ANNOTATION', id)
      dispatch('autoSave')
    },
    
    // Undo action
    undo({ commit, dispatch, state }) {
      if (state.undoStack.length === 0) return
      
      const action = state.undoStack.pop()
      
      switch (action.type) {
        case 'CREATE_ANNOTATION':
          // Undo create = delete the annotation
          commit('PUSH_REDO', action)
          commit('DELETE_ANNOTATION', action.annotation.id)
          break
          
        case 'UPDATE_ANNOTATION':
          // Undo update = restore previous state
          commit('PUSH_REDO', action)
          commit('UPDATE_ANNOTATION', {
            id: action.id,
            updates: action.previousState
          })
          break
          
        case 'DELETE_ANNOTATION':
          // Undo delete = recreate the annotation
          commit('PUSH_REDO', action)
          if (!state.annotations[action.pageIndex]) {
            state.annotations[action.pageIndex] = []
          }
          state.annotations[action.pageIndex].push(action.annotation)
          break
      }
      
      dispatch('autoSave')
    },
    
    // Redo action
    redo({ commit, dispatch, state }) {
      if (state.redoStack.length === 0) return
      
      const action = state.redoStack.pop()
      
      switch (action.type) {
        case 'CREATE_ANNOTATION':
          // Redo create = recreate the annotation
          commit('PUSH_UNDO', action)
          if (!state.annotations[action.pageIndex]) {
            state.annotations[action.pageIndex] = []
          }
          state.annotations[action.pageIndex].push(action.annotation)
          break
          
        case 'UPDATE_ANNOTATION':
          // Redo update = apply new state
          commit('PUSH_UNDO', action)
          commit('UPDATE_ANNOTATION', {
            id: action.id,
            updates: action.newState
          })
          break
          
        case 'DELETE_ANNOTATION':
          // Redo delete = delete again
          commit('PUSH_UNDO', action)
          commit('DELETE_ANNOTATION', action.annotation.id)
          break
      }
      
      dispatch('autoSave')
    },
    
    selectAnnotation({ commit, state }, id) {
      // If selecting a different annotation, collapse the previously selected one if it has a title
      if (state.selectedAnnotation && state.selectedAnnotation !== id) {
        const prevAnnotation = this.getters.annotationById(state.selectedAnnotation)
        if (prevAnnotation && prevAnnotation.collapsedTitle) {
          commit('UPDATE_ANNOTATION', {
            id: state.selectedAnnotation,
            updates: { isCollapsed: true }
          })
        }
      }
      
      // Expand the newly selected annotation
      if (id) {
        commit('UPDATE_ANNOTATION', {
          id,
          updates: { isCollapsed: false }
        })
      }
      
      commit('SET_SELECTED_ANNOTATION', id)
    },
    
    hideAnnotation({ commit, state }, { id, title }) {
      commit('SET_ANNOTATION_COLLAPSED_TITLE', { id, title })
    },
    
    unhideAnnotation({ commit }, id) {
      commit('UPDATE_ANNOTATION', {
        id,
        updates: { isCollapsed: false, collapsedTitle: '' }
      })
    },
    
    reorderPages({ commit, dispatch }, payload) {
      commit('REORDER_PAGES', payload)
      dispatch('autoSave')
    },
    
    deletePages({ commit, dispatch }, pageIndices) {
      commit('DELETE_PAGES', pageIndices)
      dispatch('autoSave')
    }
  }
})
