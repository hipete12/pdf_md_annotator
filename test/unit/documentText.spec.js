/**
 * Unit tests for PDF text extraction helpers
 */
import { textContentToString, getPageText, extractDocumentPages } from '../../src/renderer/utils/documentText'

const fakeDocument = (pages) => {
  const calls = []
  return {
    calls,
    getPage: async (n) => {
      calls.push(n)
      return { getTextContent: async () => ({ items: pages[n - 1] }) }
    }
  }
}

describe('documentText', () => {
  it('joins text items and keeps line breaks', () => {
    const text = textContentToString({
      items: [
        { str: 'Attention', hasEOL: false }, { str: ' ', hasEOL: false }, { str: 'Is All', hasEOL: true },
        { type: 'beginMarkedContent' },
        { str: 'You   Need   ', hasEOL: true }, { str: '', hasEOL: true }, { str: '', hasEOL: true },
        { str: 'Abstract', hasEOL: false }
      ]
    })
    expect(text).to.equal('Attention Is All\nYou Need\n\nAbstract')
  })

  it('caches per document and page', async () => {
    const doc = fakeDocument([[{ str: 'one' }], [{ str: 'two' }]])
    expect(await getPageText(doc, 2)).to.equal('two')
    expect(await getPageText(doc, 2)).to.equal('two')
    expect(doc.calls).to.deep.equal([2])
  })

  it('returns empty text for pages that fail to load', async () => {
    const doc = { getPage: async () => { throw new Error('broken') } }
    expect(await getPageText(doc, 1)).to.equal('')
  })

  it('extracts visible pages in display order across concatenated documents', async () => {
    const main = fakeDocument([[{ str: 'm1' }], [{ str: 'm2' }]])
    const extra = fakeDocument([[{ str: 'e1' }]])
    // virtual pages: 1,2 = main; 3 = extra. User moved page 3 first and deleted page 1.
    const sources = { 1: { document: main, actualPage: 1 }, 2: { document: main, actualPage: 2 }, 3: { document: extra, actualPage: 1 } }
    const pages = await extractDocumentPages([3, 2], id => sources[id])
    expect(pages).to.deep.equal([
      { page: 1, pageId: 3, text: 'e1' },
      { page: 2, pageId: 2, text: 'm2' }
    ])
  })
})
