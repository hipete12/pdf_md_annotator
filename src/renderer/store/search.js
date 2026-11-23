/**
 * Find in the PDF (Vuex module, namespaced as "search"). Ctrl+F opens the
 * search bar; matches cover the visible pages in display order.
 */
import { buildPageIndex, findMatches, firstMatchFrom, normalizeQuery } from '../utils/pdfSearch'
import { getPageTextItems as defaultGetPageTextItems } from '../utils/documentText'

const NO_MATCHES = Object.freeze([])

export function createSearchModule({ getPageTextItems = defaultGetPageTextItems } = {}) {
  // Results of an older search that finishes late are dropped
  let generation = 0

  return {
    namespaced: true,

    state: () => ({
      open: false,
      // Bumped by every Ctrl+F so the open bar focuses its input again
      focusNonce: 0,
      query: '',
      // Normalized query the matches belong to
      searchedQuery: '',
      searching: false,
      // [{ pageId, segments: [{ item, start, end }] }], frozen (not reactive)
      matches: NO_MATCHES,
      current: -1,
      // Bumped whenever the viewer should scroll to the current match (also
      // when it stays the same, e.g. the only match after scrolling away)
      revealNonce: 0
    }),

    getters: {
      total: state => state.matches.length,
      currentMatch: state => state.matches[state.current] || null,
      // The typed query differs from the one the matches belong to
      stale: state => normalizeQuery(state.query) !== state.searchedQuery
    },

    mutations: {
      OPEN(state) {
        state.open = true
        state.focusNonce++
      },
      CLOSE(state) {
        state.open = false
        state.searching = false
        state.searchedQuery = ''
        state.matches = NO_MATCHES
        state.current = -1
      },
      SET_QUERY(state, query) {
        state.query = query
      },
      SET_SEARCHING(state, searching) {
        state.searching = searching
      },
      SET_RESULTS(state, { query, matches, current }) {
        state.searchedQuery = query
        state.matches = Object.freeze(matches)
        state.current = current
        state.revealNonce++
      },
      SET_CURRENT(state, index) {
        state.current = index
        state.revealNonce++
      }
    },

    actions: {
      // query: text to search for (e.g. the selected PDF text); omitted keeps the last one
      async open({ commit, dispatch }, { query } = {}) {
        commit('OPEN')
        if (typeof query === 'string' && query.trim()) {
          commit('SET_QUERY', query)
          await dispatch('run')
        }
      },

      close({ commit }) {
        generation++
        commit('CLOSE')
      },

      // Search the visible pages for the current query
      async run({ state, commit, rootState, rootGetters }) {
        const token = ++generation
        const query = normalizeQuery(state.query)
        if (!query) {
          commit('SET_RESULTS', { query: '', matches: [], current: -1 })
          commit('SET_SEARCHING', false)
          return
        }
        commit('SET_SEARCHING', true)
        const pages = rootGetters.visiblePages
        const perPage = await Promise.all(pages.map(async (pageId) => {
          const source = rootGetters.getPageSource(pageId)
          const items = source?.document ? await getPageTextItems(source.document, source.actualPage) : []
          return findMatches(buildPageIndex(items), query).map(segments => ({ pageId, segments }))
        }))
        if (token !== generation || !state.open) return
        const matches = perPage.flat()
        commit('SET_RESULTS', { query, matches, current: firstMatchFrom(matches, pages, rootState.viewPage) })
        commit('SET_SEARCHING', false)
      },

      // Next (1) or previous (-1) match, wrapping around. A query typed but
      // not searched yet is searched first (showing its first match).
      async step({ state, getters, commit, dispatch }, direction = 1) {
        if (getters.stale) {
          await dispatch('run')
          return
        }
        const total = state.matches.length
        if (!total) return
        const next = state.current < 0 ? 0 : (state.current + (direction < 0 ? -1 : 1) + total) % total
        commit('SET_CURRENT', next)
      }
    }
  }
}
