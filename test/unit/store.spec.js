/**
 * Unit tests for the Vuex store
 */

import { createStore } from 'vuex'

// Mock electron ipcRenderer
const mockIpcRenderer = {
  invoke: () => Promise.resolve({}),
  on: () => {},
  removeListener: () => {}
}

// Mock the store module
const createTestStore = () => {
  return createStore({
    state: {
      pdfPath: null,
      pdfDocument: null,
      pageCount: 0,
      currentPage: 1,
      scale: 1.0,
      pageOrder: [],
      deletedPages: [],
      sidebarVisible: true,
      sidebarWidth: 200,
      selectedPages: [],
      annotations: {},
      selectedAnnotation: null,
      settings: {
        markdown: {
          fontSize: 14,
          lineHeight: 1.6,
          fontFamily: 'system-ui'
        },
        annotationBox: {
          defaultWidth: 300,
          defaultHeight: 200,
          minWidth: 100,
          minHeight: 50
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
      settingsModalOpen: false,
      isDirty: false,
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
      latexMacros: (state) => state.settings.latex.macros
    },
    
    mutations: {
      SET_PDF_DOCUMENT(state, { document, path }) {
        state.pdfDocument = document
        state.pdfPath = path
        state.pageCount = document.numPages
        state.pageOrder = Array.from({ length: document.numPages }, (_, i) => i + 1)
        state.deletedPages = []
        state.annotations = {}
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
      ADD_ANNOTATION(state, { pageIndex, annotation }) {
        if (!state.annotations[pageIndex]) {
          state.annotations[pageIndex] = []
        }
        state.annotations[pageIndex].push({
          id: 'test-id-' + Math.random(),
          type: 'markdown',
          x: annotation.x,
          y: annotation.y,
          width: state.settings.annotationBox.defaultWidth,
          height: state.settings.annotationBox.defaultHeight,
          content: '',
          style: { ...state.settings.markdown },
          isCollapsed: false,
          collapsedTitle: '',
          ...annotation
        })
        state.isDirty = true
      },
      UPDATE_ANNOTATION(state, { id, updates }) {
        for (const pageAnnotations of Object.values(state.annotations)) {
          const annotation = pageAnnotations.find(a => a.id === id)
          if (annotation) {
            Object.assign(annotation, updates)
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
        }
        state.isDirty = false
      },
      SET_SETTINGS(state, settings) {
        state.settings = { ...state.settings, ...settings }
      },
      SET_SETTING(state, { path, value }) {
        const keys = path.split('.')
        let obj = state.settings
        for (let i = 0; i < keys.length - 1; i++) {
          obj = obj[keys[i]]
        }
        obj[keys[keys.length - 1]] = value
      },
      SET_SETTINGS_MODAL(state, open) {
        state.settingsModalOpen = open
      },
      MARK_CLEAN(state) {
        state.isDirty = false
      }
    }
  })
}

describe('Vuex Store', () => {
  let store

  beforeEach(() => {
    store = createTestStore()
  })

  describe('Initial State', () => {
    it('should have correct initial values', () => {
      expect(store.state.pdfPath).to.be.null
      expect(store.state.currentPage).to.equal(1)
      expect(store.state.scale).to.equal(1.0)
      expect(store.state.sidebarVisible).to.be.true
      expect(store.state.isDirty).to.be.false
    })

    it('should have default settings', () => {
      expect(store.state.settings.markdown.fontSize).to.equal(14)
      expect(store.state.settings.annotationBox.defaultWidth).to.equal(300)
    })
  })

  describe('Page Navigation', () => {
    it('should set current page', () => {
      store.commit('SET_CURRENT_PAGE', 5)
      expect(store.state.currentPage).to.equal(5)
    })

    it('should set scale within bounds', () => {
      store.commit('SET_SCALE', 2.0)
      expect(store.state.scale).to.equal(2.0)
    })

    it('should clamp scale to minimum', () => {
      store.commit('SET_SCALE', 0.1)
      expect(store.state.scale).to.equal(0.25)
    })

    it('should clamp scale to maximum', () => {
      store.commit('SET_SCALE', 10)
      expect(store.state.scale).to.equal(4)
    })
  })

  describe('Sidebar', () => {
    it('should toggle sidebar visibility', () => {
      store.commit('SET_SIDEBAR_VISIBLE', false)
      expect(store.state.sidebarVisible).to.be.false
      
      store.commit('SET_SIDEBAR_VISIBLE', true)
      expect(store.state.sidebarVisible).to.be.true
    })

    it('should handle page selection', () => {
      store.commit('SET_SELECTED_PAGES', [1, 2, 3])
      expect(store.state.selectedPages).to.deep.equal([1, 2, 3])
    })
  })

  describe('Page Manipulation', () => {
    beforeEach(() => {
      // Setup mock PDF document
      store.commit('SET_PDF_DOCUMENT', {
        document: { numPages: 5 },
        path: '/test.pdf'
      })
    })

    it('should initialize page order correctly', () => {
      expect(store.state.pageOrder).to.deep.equal([1, 2, 3, 4, 5])
    })

    it('should reorder pages', () => {
      store.commit('REORDER_PAGES', { fromIndex: 0, toIndex: 2 })
      expect(store.state.pageOrder).to.deep.equal([2, 3, 1, 4, 5])
      expect(store.state.isDirty).to.be.true
    })

    it('should delete pages', () => {
      store.commit('DELETE_PAGES', [2, 4])
      expect(store.state.deletedPages).to.include(2)
      expect(store.state.deletedPages).to.include(4)
      expect(store.state.isDirty).to.be.true
    })

    it('should compute visible pages correctly', () => {
      store.commit('DELETE_PAGES', [2])
      expect(store.getters.visiblePages).to.deep.equal([1, 3, 4, 5])
    })
  })

  describe('Annotations', () => {
    beforeEach(() => {
      store.commit('SET_PDF_DOCUMENT', {
        document: { numPages: 3 },
        path: '/test.pdf'
      })
    })

    it('should add annotation', () => {
      store.commit('ADD_ANNOTATION', {
        pageIndex: 1,
        annotation: { x: 100, y: 200 }
      })
      
      expect(store.state.annotations[1]).to.have.length(1)
      expect(store.state.annotations[1][0].x).to.equal(100)
      expect(store.state.annotations[1][0].y).to.equal(200)
      expect(store.state.isDirty).to.be.true
    })

    it('should update annotation', () => {
      store.commit('ADD_ANNOTATION', {
        pageIndex: 1,
        annotation: { x: 100, y: 200 }
      })
      
      const id = store.state.annotations[1][0].id
      store.commit('UPDATE_ANNOTATION', {
        id,
        updates: { content: 'New content' }
      })
      
      expect(store.state.annotations[1][0].content).to.equal('New content')
    })

    it('should delete annotation', () => {
      store.commit('ADD_ANNOTATION', {
        pageIndex: 1,
        annotation: { x: 100, y: 200 }
      })
      
      const id = store.state.annotations[1][0].id
      store.commit('DELETE_ANNOTATION', id)
      
      expect(store.state.annotations[1]).to.have.length(0)
    })

    it('should select annotation', () => {
      store.commit('ADD_ANNOTATION', {
        pageIndex: 1,
        annotation: { x: 100, y: 200 }
      })
      
      const id = store.state.annotations[1][0].id
      store.commit('SET_SELECTED_ANNOTATION', id)
      
      expect(store.state.selectedAnnotation).to.equal(id)
    })

    it('should collapse annotation with title', () => {
      store.commit('ADD_ANNOTATION', {
        pageIndex: 1,
        annotation: { x: 100, y: 200 }
      })
      
      const id = store.state.annotations[1][0].id
      store.commit('SET_ANNOTATION_COLLAPSED_TITLE', { id, title: 'My Note' })
      
      expect(store.state.annotations[1][0].isCollapsed).to.be.true
      expect(store.state.annotations[1][0].collapsedTitle).to.equal('My Note')
    })

    it('should get annotations for current page', () => {
      store.commit('ADD_ANNOTATION', {
        pageIndex: 1,
        annotation: { x: 100, y: 200 }
      })
      store.commit('ADD_ANNOTATION', {
        pageIndex: 2,
        annotation: { x: 150, y: 250 }
      })
      
      store.commit('SET_CURRENT_PAGE', 1)
      expect(store.getters.currentPageAnnotations).to.have.length(1)
      
      store.commit('SET_CURRENT_PAGE', 2)
      expect(store.getters.currentPageAnnotations).to.have.length(1)
    })
  })

  describe('Settings', () => {
    it('should update settings', () => {
      store.commit('SET_SETTINGS', {
        markdown: { fontSize: 16 }
      })
      expect(store.state.settings.markdown.fontSize).to.equal(16)
    })

    it('should update individual setting', () => {
      store.commit('SET_SETTING', {
        path: 'markdown.lineHeight',
        value: 2.0
      })
      expect(store.state.settings.markdown.lineHeight).to.equal(2.0)
    })

    it('should toggle settings modal', () => {
      store.commit('SET_SETTINGS_MODAL', true)
      expect(store.state.settingsModalOpen).to.be.true
    })
  })

  describe('Loading Annotations', () => {
    it('should load annotations from pdfmark data', () => {
      store.commit('SET_PDF_DOCUMENT', {
        document: { numPages: 3 },
        path: '/test.pdf'
      })
      
      store.commit('LOAD_ANNOTATIONS', {
        annotations: {
          1: [{ id: 'a1', x: 10, y: 20, content: 'Test' }]
        },
        pageOrder: [3, 2, 1],
        deletedPages: [2]
      })
      
      expect(store.state.annotations[1]).to.have.length(1)
      expect(store.state.pageOrder).to.deep.equal([3, 2, 1])
      expect(store.state.deletedPages).to.include(2)
      expect(store.state.isDirty).to.be.false
    })
  })

  describe('Dirty State', () => {
    it('should mark as dirty on changes', () => {
      store.commit('SET_PDF_DOCUMENT', {
        document: { numPages: 3 },
        path: '/test.pdf'
      })
      
      expect(store.state.isDirty).to.be.false
      
      store.commit('ADD_ANNOTATION', {
        pageIndex: 1,
        annotation: { x: 100, y: 200 }
      })
      
      expect(store.state.isDirty).to.be.true
    })

    it('should mark as clean', () => {
      store.state.isDirty = true
      store.commit('MARK_CLEAN')
      expect(store.state.isDirty).to.be.false
    })

    it('should report unsaved changes via getter', () => {
      store.state.isDirty = true
      expect(store.getters.hasUnsavedChanges).to.be.true
    })
  })
})
