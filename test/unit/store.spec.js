/**
 * Unit tests for the Vuex store (src/renderer/store)
 */

import { createAppStore } from '../../src/renderer/store'

// Records every ipcRenderer.invoke call so save behaviour can be asserted
const createMockIpc = () => {
  const calls = []
  return {
    calls,
    invoke: (channel, payload) => {
      calls.push({ channel, payload })
      return Promise.resolve({ success: true })
    },
    on: () => {},
    removeListener: () => {}
  }
}

const createTestStore = (ipcRenderer = createMockIpc()) => createAppStore({ ipcRenderer })


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

describe('Settings hydration', () => {
  it('starts with the shared defaults', () => {
    const store = createTestStore()
    expect(store.state.settings.annotationBox.minWidth).to.equal(30)
    expect(store.state.settings.markdown.listMargin).to.equal(0.5)
  })

  it('HYDRATE_SETTINGS does not mark the document dirty', () => {
    const store = createTestStore()
    store.commit('SET_PDF_DOCUMENT', { document: { numPages: 1 }, path: '/a.pdf' })
    store.commit('HYDRATE_SETTINGS', { markdown: { fontSize: 18 } })
    expect(store.state.isDirty).to.be.false
    expect(store.state.settings.markdown.fontSize).to.equal(18)
  })

  it('HYDRATE_SETTINGS keeps nested defaults missing from saved settings', () => {
    const store = createTestStore()
    // Shape written by older versions: no listMargin / padding
    store.commit('HYDRATE_SETTINGS', {
      markdown: { fontSize: 16, lineHeight: 1.6, fontFamily: 'serif' },
      annotationBox: { defaultWidth: 250, defaultHeight: 200, minWidth: 100, minHeight: 50 }
    })
    expect(store.state.settings.markdown.fontSize).to.equal(16)
    expect(store.state.settings.markdown.listMargin).to.equal(0.5)
    expect(store.state.settings.annotationBox.padding).to.equal(4)
  })

  it('loadSettings ignores non-settings keys such as recentFiles', async () => {
    const ipc = createMockIpc()
    ipc.invoke = () => Promise.resolve({ markdown: { fontSize: 20 }, recentFiles: ['/x.pdf'] })
    const store = createTestStore(ipc)
    await store.dispatch('loadSettings')
    expect(store.state.settings.markdown.fontSize).to.equal(20)
    expect(store.state.settings).to.not.have.property('recentFiles')
    expect(store.state.isDirty).to.be.false
  })

  it('LOAD_ANNOTATIONS merges document settings per section', () => {
    const store = createTestStore()
    store.commit('SET_PDF_DOCUMENT', { document: { numPages: 1 }, path: '/a.pdf' })
    store.commit('SET_SETTING', { path: 'latex.macros', value: { '\\A': 'a' } })
    store.commit('LOAD_ANNOTATIONS', {
      settings: {
        markdown: { fontSize: 12 },
        latex: { macros: { '\\B': 'b' } }
      }
    })
    expect(store.state.settings.markdown.fontSize).to.equal(12)
    expect(store.state.settings.markdown.listMargin).to.equal(0.5)
    expect(store.state.settings.latex.macros).to.deep.equal({ '\\B': 'b' })
  })

  it('default settings are not shared between store instances', () => {
    const a = createTestStore()
    const b = createTestStore()
    a.commit('SET_SETTING', { path: 'markdown.fontSize', value: 30 })
    expect(b.state.settings.markdown.fontSize).to.equal(14)
  })
})

describe('Saving .pdfmark', () => {
  const savedData = (ipc) => ipc.calls.filter(c => c.channel === 'save-pdfmark').map(c => c.payload.data)

  it('keeps the created timestamp from the loaded file and sets modified', async () => {
    const ipc = createMockIpc()
    const store = createTestStore(ipc)
    store.commit('SET_PDF_DOCUMENT', { document: { numPages: 1 }, path: '/a.pdf' })
    store.commit('LOAD_ANNOTATIONS', { version: '1.0.0', created: '2020-01-01T00:00:00.000Z' })

    await store.dispatch('savePdfmark')
    await store.dispatch('savePdfmark')

    const [first, second] = savedData(ipc)
    expect(first.created).to.equal('2020-01-01T00:00:00.000Z')
    expect(second.created).to.equal('2020-01-01T00:00:00.000Z')
    expect(Date.parse(second.modified)).to.be.greaterThan(Date.parse(first.created))
  })

  it('sets created on the first save of a new .pdfmark and keeps it afterwards', async () => {
    const ipc = createMockIpc()
    const store = createTestStore(ipc)
    store.commit('SET_PDF_DOCUMENT', { document: { numPages: 1 }, path: '/a.pdf' })

    await store.dispatch('savePdfmark')
    await new Promise(resolve => setTimeout(resolve, 5))
    await store.dispatch('savePdfmark')

    const [first, second] = savedData(ipc)
    expect(first.created).to.be.a('string')
    expect(second.created).to.equal(first.created)
    expect(second.modified).to.not.equal(first.created)
  })

  it('resets created when a different PDF is opened', async () => {
    const ipc = createMockIpc()
    const store = createTestStore(ipc)
    store.commit('SET_PDF_DOCUMENT', { document: { numPages: 1 }, path: '/a.pdf' })
    store.commit('LOAD_ANNOTATIONS', { created: '2020-01-01T00:00:00.000Z' })
    store.commit('SET_PDF_DOCUMENT', { document: { numPages: 1 }, path: '/b.pdf' })
    expect(store.state.pdfmarkCreated).to.be.null
  })
})

describe('Undo / Redo', () => {
  let store
  const allAnnotations = () => Object.values(store.state.annotations).flat()

  beforeEach(() => {
    store = createTestStore()
    store.commit('SET_PDF_DOCUMENT', { document: { numPages: 3 }, path: '/a.pdf' })
  })

  it('undoes and redoes creating an annotation', () => {
    store.dispatch('createAnnotation', { pageIndex: 1, x: 10, y: 20 })
    const id = store.state.annotations[1][0].id

    store.dispatch('undo')
    expect(allAnnotations()).to.have.length(0)

    store.dispatch('redo')
    expect(store.state.annotations[1].map(a => a.id)).to.deep.equal([id])
  })

  it('undoes and redoes deleting an annotation', () => {
    store.dispatch('createAnnotation', { pageIndex: 2, x: 10, y: 20 })
    const id = store.state.annotations[2][0].id
    store.dispatch('deleteAnnotation', id)
    expect(allAnnotations()).to.have.length(0)

    store.dispatch('undo')
    expect(store.state.annotations[2].map(a => a.id)).to.deep.equal([id])

    store.dispatch('redo')
    expect(allAnnotations()).to.have.length(0)
  })

  it('undoes and redoes an update', () => {
    store.dispatch('createAnnotation', { pageIndex: 1, x: 10, y: 20 })
    const id = store.state.annotations[1][0].id
    store.dispatch('updateAnnotation', { id, updates: { content: 'hello' } })

    store.dispatch('undo')
    expect(store.getters.annotationById(id).content).to.equal('')

    store.dispatch('redo')
    expect(store.getters.annotationById(id).content).to.equal('hello')
  })

  it('can redo several steps in a row', () => {
    store.dispatch('createAnnotation', { pageIndex: 1, x: 10, y: 20 })
    const id = store.state.annotations[1][0].id
    store.dispatch('updateAnnotation', { id, updates: { content: 'one' } })
    store.dispatch('updateAnnotation', { id, updates: { content: 'two' } })

    store.dispatch('undo')
    store.dispatch('undo')
    store.dispatch('undo')
    expect(allAnnotations()).to.have.length(0)
    expect(store.state.redoStack).to.have.length(3)

    store.dispatch('redo')
    store.dispatch('redo')
    store.dispatch('redo')
    expect(store.getters.annotationById(id).content).to.equal('two')
    expect(store.state.redoStack).to.have.length(0)
    expect(store.state.undoStack).to.have.length(3)
  })

  it('clears the redo stack when a new action is performed', () => {
    store.dispatch('createAnnotation', { pageIndex: 1, x: 10, y: 20 })
    store.dispatch('undo')
    store.dispatch('createAnnotation', { pageIndex: 1, x: 30, y: 40 })
    expect(store.state.redoStack).to.have.length(0)
  })

  it('does not share annotation objects with the history stacks', () => {
    store.dispatch('createAnnotation', { pageIndex: 1, x: 10, y: 20 })
    const id = store.state.annotations[1][0].id
    store.dispatch('undo')
    store.dispatch('redo')
    store.commit('UPDATE_ANNOTATION', { id, updates: { content: 'changed' } })
    expect(store.state.redoStack).to.have.length(0)
    expect(store.state.undoStack[0].annotation.content).to.equal('')
  })
})
