import { expect } from 'chai'
import {
  DEFAULT_HIGHLIGHT_COLOR, highlightAt, mergeLineRects, normalizeColor, overlappingHighlights, planHighlight, sanitizeHighlights
} from '../../src/renderer/utils/highlights'
import { createAppStore } from '../../src/renderer/store'

const ipc = () => {
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

describe('Text highlights', () => {
  describe('helpers', () => {
    it('normalizes colours', () => {
      expect(normalizeColor('#FB923C')).to.equal('#fb923c')
      expect(normalizeColor('#abc')).to.equal('#aabbcc')
      expect(normalizeColor('red')).to.equal(DEFAULT_HIGHLIGHT_COLOR)
      expect(normalizeColor(undefined)).to.equal(DEFAULT_HIGHLIGHT_COLOR)
    })

    it('merges the boxes of one line and keeps lines apart', () => {
      const merged = mergeLineRects([
        { x: 10, y: 100, w: 40, h: 12 }, // "Apple"
        { x: 50, y: 100.5, w: 5, h: 12 }, // " "
        { x: 55, y: 100, w: 30, h: 12 }, // "pie"
        { x: 10, y: 120, w: 60, h: 12 }, // next line
        { x: 70, y: 100, w: 0, h: 12 } // <br>
      ])
      expect(merged).to.deep.equal([
        { x: 10, y: 100, w: 75, h: 12.5 },
        { x: 10, y: 120, w: 60, h: 12 }
      ])
      // Words far apart on a line stay separate boxes
      expect(mergeLineRects([{ x: 0, y: 0, w: 10, h: 10 }, { x: 100, y: 0, w: 10, h: 10 }])).to.have.length(2)
    })

    it('finds highlights under a point and overlapping a selection', () => {
      const a = { id: 'a', rects: [{ x: 0, y: 0, w: 50, h: 10 }] }
      const b = { id: 'b', rects: [{ x: 40, y: 0, w: 50, h: 10 }] }
      expect(highlightAt([a, b], 45, 5).highlight.id).to.equal('b') // drawn last = on top
      expect(highlightAt([a, b], 10, 5).highlight.id).to.equal('a')
      expect(highlightAt([a, b], 10, 50)).to.equal(null)
      expect(overlappingHighlights([a, b], [{ x: 0, y: 2, w: 5, h: 5 }]).map(h => h.id)).to.deep.equal(['a'])
      expect(overlappingHighlights(undefined, [{ x: 0, y: 0, w: 5, h: 5 }])).to.deep.equal([])
    })

    it('keeps only valid highlights from a file', () => {
      const clean = sanitizeHighlights({
        2: [
          { id: 'ok', color: '#4ADE80', rects: [{ x: 1, y: 2, w: 3, h: 4 }, { x: 'bad' }], text: 'hi' },
          { id: 'no-rects', rects: [] },
          { color: '#fff', rects: [{ x: 1, y: 1, w: 1, h: 1 }] }
        ],
        nope: [{ id: 'x', rects: [{ x: 1, y: 1, w: 1, h: 1 }] }]
      })
      expect(clean).to.deep.equal({ 2: [{ id: 'ok', color: '#4ade80', rects: [{ x: 1, y: 2, w: 3, h: 4 }], text: 'hi', created: null }] })
      expect(sanitizeHighlights(null)).to.deep.equal({})
      expect(sanitizeHighlights([])).to.deep.equal({})
    })

    it('extends the highlights a selection overlaps instead of stacking', () => {
      const existing = { 1: [{ id: 'old', color: '#facc15', rects: [{ x: 0, y: 0, w: 50, h: 10 }], text: 'Apple pie' }] }
      // Selection continues the highlighted line
      const plan = planHighlight(existing, [{ pageId: 1, rects: [{ x: 45, y: 0, w: 40, h: 10 }], text: 'pie and' }])
      expect(plan.removed.map(r => r.highlight.id)).to.deep.equal(['old'])
      expect(plan.added).to.deep.equal([{ pageId: 1, rects: [{ x: 0, y: 0, w: 85, h: 10 }], text: 'Apple pie' }])
      // A new spot on another page is just added
      const fresh = planHighlight(existing, [{ pageId: 2, rects: [{ x: 0, y: 0, w: 5, h: 5 }], text: 'x' }])
      expect(fresh.removed).to.deep.equal([])
      expect(fresh.added).to.have.length(1)
    })
  })

  describe('store', () => {
    let store
    let calls
    const target = (pageId, x = 10, text = 'apple') => ({ pageId, rects: [{ x, y: 100, w: 40, h: 12 }], text })
    const all = () => Object.values(store.state.highlights).flat()

    beforeEach(() => {
      const mock = ipc()
      calls = mock.calls
      store = createAppStore({ ipcRenderer: mock })
      store.state.pdfPath = '/tmp/doc.pdf'
    })

    it('starts with the default colour', () => {
      expect(store.state.settings.ui.highlightColor).to.equal('#facc15')
    })

    it('highlights, recolours and removes, each undoable', async () => {
      await store.dispatch('highlightTargets', { targets: [target(1), target(3)], color: '#60A5FA' })
      expect(Object.keys(store.state.highlights)).to.deep.equal(['1', '3'])
      expect(all().map(h => h.color)).to.deep.equal(['#60a5fa', '#60a5fa'])
      expect(store.state.isDirty).to.equal(true)

      const id = store.state.highlights[1][0].id
      await store.dispatch('recolorHighlights', { ids: [id], color: '#f472b6' })
      expect(store.state.highlights[1][0]).to.include({ id, color: '#f472b6' })
      await store.dispatch('removeHighlights', [id])
      expect(store.state.highlights[1]).to.equal(undefined)

      await store.dispatch('undo') // remove
      expect(store.state.highlights[1][0]).to.include({ id, color: '#f472b6' })
      await store.dispatch('undo') // recolour
      expect(store.state.highlights[1][0].color).to.equal('#60a5fa')
      await store.dispatch('undo') // highlight
      expect(all()).to.deep.equal([])
      await store.dispatch('redo')
      expect(all()).to.have.length(2)
    })

    it('uses the remembered colour and saves a new choice', async () => {
      await store.dispatch('setHighlightColor', '#4ADE80')
      expect(store.state.settings.ui.highlightColor).to.equal('#4ade80')
      expect(calls.some(c => c.channel === 'set-settings' && c.payload.ui.highlightColor === '#4ade80')).to.equal(true)
      await store.dispatch('highlightTargets', { targets: [target(1)] })
      expect(store.state.highlights[1][0].color).to.equal('#4ade80')
    })

    it('saves highlights in the .pdfmark and loads them back', async () => {
      await store.dispatch('highlightTargets', { targets: [target(2)] })
      await store.dispatch('savePdfmark', { commit: false })
      const saved = calls.find(c => c.channel === 'save-pdfmark').payload.data
      expect(saved.highlights[2][0]).to.include({ color: '#facc15', text: 'apple' })

      const other = createAppStore({ ipcRenderer: ipc() })
      await other.dispatch('loadPdfmark', { annotations: {}, highlights: saved.highlights })
      expect(other.state.highlights).to.deep.equal(saved.highlights)
      // Files from before highlights load with none
      await other.dispatch('loadPdfmark', { annotations: {} })
      expect(other.state.highlights).to.deep.equal({})
    })

    it('moves highlights with their pages when a PDF is added in front', async () => {
      store.state.pageOrder = [1, 2]
      await store.dispatch('highlightTargets', { targets: [target(2)] })
      store.commit('ADD_CONCATENATED_PDF', { position: 'beginning', pdfPath: '/tmp/front.pdf', pageCount: 3, document: {} })
      expect(Object.keys(store.state.highlights)).to.deep.equal(['5'])
    })
  })
})
