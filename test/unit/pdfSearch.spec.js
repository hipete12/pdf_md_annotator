import { expect } from 'chai'
import { createStore } from 'vuex'
import {
  buildPageIndex, findMatches, firstMatchFrom, highlightTextDivs, normalizeQuery, restoreTextDivs
} from '../../src/renderer/utils/pdfSearch'
import { getPageText, getPageTextItems } from '../../src/renderer/utils/documentText'
import { createSearchModule } from '../../src/renderer/store/search'

const items = (...strs) => strs.map(s => (typeof s === 'string' ? { str: s, hasEOL: false } : s))

describe('Find in the PDF', () => {
  describe('matching', () => {
    it('normalizes the query', () => {
      expect(normalizeQuery('  Self\n  Attention ')).to.equal('self attention')
      expect(normalizeQuery('   ')).to.equal('')
      expect(normalizeQuery(undefined)).to.equal('')
    })

    it('ignores case and maps matches back to text items', () => {
      const index = buildPageIndex(items('The Transformer', ' ', 'uses attention.'))
      expect(findMatches(index, 'transformer')).to.deep.equal([[{ item: 0, start: 4, end: 15 }]])
      expect(findMatches(index, 'ATTENTION')).to.deep.equal([[{ item: 2, start: 5, end: 14 }]])
    })

    it('matches across items, extra spaces and line ends', () => {
      const index = buildPageIndex([
        { str: 'multi-head', hasEOL: true },
        { str: 'attention   is', hasEOL: false },
        { str: ' all', hasEOL: false }
      ])
      expect(findMatches(index, 'head attention is all')).to.deep.equal([[
        { item: 0, start: 6, end: 10 },
        { item: 1, start: 0, end: 14 },
        { item: 2, start: 0, end: 4 }
      ]])
    })

    it('finds every match in reading order without overlaps', () => {
      const index = buildPageIndex(items('aaaa a'))
      expect(findMatches(index, 'aa')).to.have.length(2)
      expect(findMatches(buildPageIndex(items('no luck')), 'zebra')).to.deep.equal([])
      expect(findMatches(buildPageIndex(items('anything')), '  ')).to.deep.equal([])
    })

    it('caches the index of a page', () => {
      const page = items('cached text')
      expect(buildPageIndex(page)).to.equal(buildPageIndex(page))
    })

    it('starts at the first match on or after the page in view', () => {
      const matches = [{ pageId: 1 }, { pageId: 3 }, { pageId: 3 }]
      expect(firstMatchFrom(matches, [1, 2, 3], 2)).to.equal(1)
      expect(firstMatchFrom(matches, [1, 2, 3], 1)).to.equal(0)
      // Pages in a custom order: page 3 shown first
      expect(firstMatchFrom(matches, [3, 2, 1], 2)).to.equal(0)
      expect(firstMatchFrom(matches, [1, 2, 3, 4], 4)).to.equal(0) // wraps
      expect(firstMatchFrom([], [1], 1)).to.equal(-1)
    })
  })

  describe('highlighting text layer spans', () => {
    const spans = (strs) => strs.map(str => {
      const span = window.document.createElement('span')
      span.textContent = str
      return span
    })

    it('wraps matches, marks the current one and restores the text', () => {
      const strs = ['The attention layer', ' ', 'attends']
      const divs = spans(strs)
      const hits = [
        { segments: [{ item: 0, start: 4, end: 13 }], selected: true },
        { segments: [{ item: 0, start: 14, end: 19 }, { item: 2, start: 0, end: 3 }] }
      ]
      const changed = highlightTextDivs(divs, strs, hits)
      expect(changed).to.deep.equal([0, 2])
      expect(divs[0].innerHTML).to.equal(
        'The <span class="search-hit selected">attention</span> <span class="search-hit">layer</span>')
      expect(divs[2].innerHTML).to.equal('<span class="search-hit">att</span>ends')
      // The text itself is unchanged (selection, copy and layout use it)
      expect(divs.map(d => d.textContent)).to.deep.equal(strs)

      restoreTextDivs(divs, strs, changed)
      expect(divs[0].innerHTML).to.equal('The attention layer')
    })

    it('skips ranges past the end of a span and missing spans', () => {
      const strs = ['short']
      const divs = spans(strs)
      expect(highlightTextDivs(divs, strs, [{ segments: [{ item: 0, start: 3, end: 99 }, { item: 5, start: 0, end: 1 }] }]))
        .to.deep.equal([0])
      expect(divs[0].innerHTML).to.equal('sho<span class="search-hit">rt</span>')
    })
  })

  describe('page text', () => {
    it('shares one extraction between the chat text and Find', async () => {
      let loads = 0
      const doc = {
        getPage: async () => {
          loads++
          return { getTextContent: async () => ({ items: [{ str: 'Hello', hasEOL: true }, { type: 'beginMarkedContent' }, { str: 'world' }] }) }
        }
      }
      expect(await getPageTextItems(doc, 1)).to.deep.equal([{ str: 'Hello', hasEOL: true }, { str: 'world', hasEOL: false }])
      expect(await getPageText(doc, 1)).to.equal('Hello\nworld')
      expect(loads).to.equal(1)
    })
  })

  describe('store', () => {
    // Pages 1-3; page 2 has no text; the user moved page 3 first
    const pageItems = {
      1: items('Alpha beta', ' gamma beta'),
      2: [],
      3: items('beta blocker')
    }
    const makeStore = ({ visiblePages = [3, 1, 2], viewPage = null } = {}) => createStore({
      state: { viewPage },
      getters: {
        visiblePages: () => visiblePages,
        getPageSource: () => (pageId) => ({ document: { pageId }, actualPage: pageId })
      },
      modules: {
        search: createSearchModule({ getPageTextItems: async (doc) => pageItems[doc.pageId] })
      }
    })

    it('finds matches across pages in display order and steps through them', async () => {
      const store = makeStore()
      await store.dispatch('search/open')
      store.commit('search/SET_QUERY', 'BETA')
      expect(store.getters['search/stale']).to.equal(true)
      await store.dispatch('search/run')
      expect(store.state.search.matches.map(m => m.pageId)).to.deep.equal([3, 1, 1])
      expect(store.state.search.current).to.equal(0)
      expect(store.getters['search/stale']).to.equal(false)

      await store.dispatch('search/step', 1)
      await store.dispatch('search/step', 1)
      expect(store.state.search.current).to.equal(2)
      await store.dispatch('search/step', 1) // wraps to the first
      expect(store.state.search.current).to.equal(0)
      await store.dispatch('search/step', -1) // and back to the last
      expect(store.state.search.current).to.equal(2)
    })

    it('starts at the page in view and asks the viewer to scroll there', async () => {
      const store = makeStore({ viewPage: 1 })
      const before = store.state.search.revealNonce
      await store.dispatch('search/open', { query: 'beta' })
      expect(store.state.search.current).to.equal(1) // first match on page 1
      expect(store.state.search.revealNonce).to.be.greaterThan(before)

      // Stepping with a single match still asks to scroll to it
      store.commit('search/SET_QUERY', 'blocker')
      await store.dispatch('search/step', 1) // a new query is searched first
      expect(store.getters['search/total']).to.equal(1)
      const nonce = store.state.search.revealNonce
      await store.dispatch('search/step', 1)
      expect(store.state.search.current).to.equal(0)
      expect(store.state.search.revealNonce).to.equal(nonce + 1)
    })

    it('clears results for an empty query and on close, and drops late results', async () => {
      const store = makeStore()
      await store.dispatch('search/open', { query: 'gamma' })
      expect(store.getters['search/total']).to.equal(1)

      store.commit('search/SET_QUERY', '   ')
      await store.dispatch('search/run')
      expect(store.getters['search/total']).to.equal(0)
      expect(store.state.search.current).to.equal(-1)

      store.commit('search/SET_QUERY', 'beta')
      const pending = store.dispatch('search/run')
      store.dispatch('search/close')
      await pending
      expect(store.state.search.open).to.equal(false)
      expect(store.getters['search/total']).to.equal(0)
    })
  })
})
