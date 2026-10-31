import { createStore } from 'vuex'
import { markRaw } from 'vue'
import { v4 as uuidv4 } from 'uuid'
import { createDefaultSettings, mergeSettings, pickSettings } from '../../common/constants'

// Safely get ipcRenderer - may not be available in browser context
let defaultIpcRenderer = null
try {
  defaultIpcRenderer = require('electron').ipcRenderer
} catch (e) {
  console.warn('Running outside Electron context')
}

// Plain deep copy for annotation snapshots kept in the undo/redo history
const clone = (value) => JSON.parse(JSON.stringify(value))

// Debounce helper for auto-save
function debounce(fn, delay) {
  let timeoutId
  return function (...args) {
    clearTimeout(timeoutId)
    timeoutId = setTimeout(() => fn.apply(this, args), delay)
  }
}

/**
 * Build the JSON-serializable .pdfmark contents for the current state
 * (a plain copy avoids "An object could not be cloned" errors over IPC).
 * Records the creation time on the first save of a new .pdfmark.
 */
function snapshotPdfmark(state, commit) {
  const now = new Date().toISOString()
  if (!state.pdfmarkCreated) commit('SET_PDFMARK_CREATED', now)

  return clone({
    version: state.pdfmarkVersion,
    pdfPath: state.pdfPath,
    created: state.pdfmarkCreated,
    modified: now,
    annotations: state.annotations,
    pageOrder: state.pageOrder,
    deletedPages: state.deletedPages,
    concatenatedPdfs: state.concatenatedPdfs,
    settings: {
      markdown: state.settings.markdown,
      latex: state.settings.latex
    }
  })
}

/**
 * Create a new store instance. Tests pass a fake ipcRenderer; the app uses the
 * default store exported below.
 */
export function createAppStore({ ipcRenderer = defaultIpcRenderer } = {}) {
  // Auto-save (debounced per store instance)
  const debouncedAutoSave = debounce(async function({ state, dispatch }) {
    if (state.pdfPath && state.isDirty) {
      await dispatch('savePdfmark', { commit: false })
    }
  }, 2000)

  return createStore({
    state: () => ({
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
      settings: createDefaultSettings(),
    
      // Chat models fetched per provider: { [providerId]: [model, ...] }
      // (see normalizeModelList in common/llm.js). Not persisted.
      llmModels: {},
    
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
      pdfmarkVersion: '1.0.0',
    
      // When the .pdfmark for the current PDF was first created (ISO string),
      // null until it is loaded or first saved
      pdfmarkCreated: null
    }),

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
        // Destroy previous PDF document and additional PDFs to free worker/memory resources.
        // Only destroy if the object exists and exposes a destroy() method; wrap in try/catch
        // because destroy can throw if the document was already destroyed or is mid-load.
        if (state.pdfDocument && typeof state.pdfDocument.destroy === 'function') {
          try {
            state.pdfDocument.destroy()
          } catch (e) {
            // Best-effort cleanup; ignore errors from already-destroyed documents
          }
        }
        if (state.additionalPdfs) {
          for (const doc of Object.values(state.additionalPdfs)) {
            if (doc && typeof doc.destroy === 'function') {
              try {
                doc.destroy()
              } catch (e) {
                // Best-effort cleanup
              }
            }
          }
        }

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
        state.pdfmarkCreated = null
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
          state.pdfmarkCreated = data.created || null
          state.concatenatedPdfs = data.concatenatedPdfs || []
        
          // Merge per-document settings section by section, so keys missing
          // from an older .pdfmark (e.g. markdown.listMargin) keep their
          // current values while values such as latex.macros still replace.
          if (data.settings) {
            const merged = { ...state.settings }
            for (const [section, values] of Object.entries(data.settings)) {
              merged[section] = { ...state.settings[section], ...values }
            }
            state.settings = merged
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
    
      // Apply settings loaded from disk on top of the defaults. Not a user
      // edit, so it must not mark the document as having unsaved changes.
      HYDRATE_SETTINGS(state, settings) {
        state.settings = mergeSettings(createDefaultSettings(), pickSettings(settings))
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
    
      SET_LLM_MODELS(state, { providerId, models }) {
        state.llmModels = { ...state.llmModels, [providerId]: models }
      },
    
      SET_SETTINGS_MODAL(state, open) {
        state.settingsModalOpen = open
      },
    
      SET_PDFMARK_CREATED(state, created) {
        state.pdfmarkCreated = created
      },
    
      MARK_CLEAN(state) {
        state.isDirty = false
      },
    
      // Re-insert an annotation (undo of delete / redo of create)
      INSERT_ANNOTATION(state, { pageIndex, annotation }) {
        if (!state.annotations[pageIndex]) {
          state.annotations[pageIndex] = []
        }
        state.annotations[pageIndex].push(clone(annotation))
        state.isDirty = true
      },
    
      // Undo/Redo mutations
      // Record a new user action; this invalidates anything that could be redone
      PUSH_UNDO(state, action) {
        state.undoStack.push(action)
        if (state.undoStack.length > state.maxUndoSteps) {
          state.undoStack.shift()
        }
        state.redoStack = []
      },
    
      // Move an action back onto the undo stack during redo (keeps redoStack)
      RESTORE_UNDO(state, action) {
        state.undoStack.push(action)
        if (state.undoStack.length > state.maxUndoSteps) {
          state.undoStack.shift()
        }
      },
    
      // Vuex commits cannot return values: read the top entry first, then pop
      POP_UNDO(state) {
        state.undoStack.pop()
      },
    
      PUSH_REDO(state, action) {
        state.redoStack.push(action)
      },
    
      POP_REDO(state) {
        state.redoStack.pop()
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
          commit('HYDRATE_SETTINGS', settings)
        } catch (err) {
          console.error('Failed to load settings:', err)
        }
      },
    
      async saveSettings({ state }) {
        if (!ipcRenderer) return
        try {
          // state.settings is a reactive Proxy, which IPC cannot clone
          await ipcRenderer.invoke('set-settings', clone(state.settings))
        } catch (err) {
          console.error('Failed to save settings:', err)
        }
      },
    
      autoSave: debouncedAutoSave,
    
      async savePdfmark({ state, commit }, { commit: commitFile = true } = {}) {
        if (!state.pdfPath || !ipcRenderer) return
      
        const data = snapshotPdfmark(state, commit)
      
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
    
      // Save As: the main process asks for a new .pdf path, copies the PDF
      // there, writes the matching .pdfmark and reopens the app on the copy.
      // Resolves to the IPC result ({ success, cancelled, pdfPath, error }).
      async savePdfmarkAs({ state, commit }) {
        if (!state.pdfPath || !ipcRenderer) return null
      
        const data = snapshotPdfmark(state, commit)
      
        try {
          const result = await ipcRenderer.invoke('save-pdf-as', {
            sourcePdfPath: state.pdfPath,
            data
          })
          if (result && result.success) commit('MARK_CLEAN')
          return result
        } catch (err) {
          console.error('Failed to save as:', err)
          return { success: false, error: err.message }
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
            annotation: clone(newAnnotation)
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
              previousState: clone(annotation),
              newState: clone({ ...annotation, ...updates })
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
            annotation: clone(annotation)
          })
        }
      
        commit('DELETE_ANNOTATION', id)
        dispatch('autoSave')
      },
    
      // Undo action
      undo({ commit, dispatch, state }) {
        if (state.undoStack.length === 0) return
      
        const action = state.undoStack[state.undoStack.length - 1]
        commit('POP_UNDO')
        commit('PUSH_REDO', action)
      
        switch (action.type) {
          case 'CREATE_ANNOTATION':
            // Undo create = delete the annotation
            commit('DELETE_ANNOTATION', action.annotation.id)
            break
          
          case 'UPDATE_ANNOTATION':
            // Undo update = restore previous state
            commit('UPDATE_ANNOTATION', {
              id: action.id,
              updates: clone(action.previousState)
            })
            break
          
          case 'DELETE_ANNOTATION':
            // Undo delete = recreate the annotation
            commit('INSERT_ANNOTATION', {
              pageIndex: action.pageIndex,
              annotation: action.annotation
            })
            break
        }
      
        dispatch('autoSave')
      },
    
      // Redo action
      redo({ commit, dispatch, state }) {
        if (state.redoStack.length === 0) return
      
        const action = state.redoStack[state.redoStack.length - 1]
        commit('POP_REDO')
        commit('RESTORE_UNDO', action)
      
        switch (action.type) {
          case 'CREATE_ANNOTATION':
            // Redo create = recreate the annotation
            commit('INSERT_ANNOTATION', {
              pageIndex: action.pageIndex,
              annotation: action.annotation
            })
            break
          
          case 'UPDATE_ANNOTATION':
            // Redo update = apply new state
            commit('UPDATE_ANNOTATION', {
              id: action.id,
              updates: clone(action.newState)
            })
            break
          
          case 'DELETE_ANNOTATION':
            // Redo delete = delete again
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
        // Deselect so the annotation immediately renders in its smaller
        // collapsed form instead of remaining expanded while selected.
        commit('SET_SELECTED_ANNOTATION', null)
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
}

export default createAppStore()
