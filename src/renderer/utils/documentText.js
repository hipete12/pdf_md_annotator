/**
 * Extracts page text from the loaded PDF.js documents for the chat prompt.
 * Results are cached per PDF.js document object and page number, so reordering
 * or deleting pages does not trigger re-extraction.
 */

// WeakMap<PDFDocumentProxy, Map<pageNumber, Promise<Array<{str, hasEOL}>>>>
// Shared by the chat (page text) and Find (text items)
const itemsCache = new WeakMap()

/**
 * Join PDF.js text items into plain text, keeping line breaks.
 * @param {{items: Array<{str?: string, hasEOL?: boolean}>}} textContent
 */
export function textContentToString(textContent) {
  let text = ''
  for (const item of textContent?.items || []) {
    if (typeof item.str !== 'string') continue // marked-content markers
    text += item.str
    if (item.hasEOL) text += '\n'
  }
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Text items of one page of a PDF.js document (cached): the items with a
 * string, in the order PDF.js renders them as text layer spans.
 * @returns {Promise<Array<{str: string, hasEOL: boolean}>>}
 */
export function getPageTextItems(document, pageNumber) {
  let pages = itemsCache.get(document)
  if (!pages) {
    pages = new Map()
    itemsCache.set(document, pages)
  }
  if (!pages.has(pageNumber)) {
    const promise = document.getPage(pageNumber)
      .then(page => page.getTextContent())
      .then(content => (content?.items || [])
        .filter(item => typeof item.str === 'string')
        .map(item => ({ str: item.str, hasEOL: Boolean(item.hasEOL) })))
      .catch(() => [])
    pages.set(pageNumber, promise)
  }
  return pages.get(pageNumber)
}

/**
 * Text of one page of a PDF.js document (cached).
 */
export async function getPageText(document, pageNumber) {
  return textContentToString({ items: await getPageTextItems(document, pageNumber) })
}

/**
 * Text of every visible page, in the user's page order.
 * @param {number[]} visiblePages - virtual page ids in display order (store getter visiblePages)
 * @param {(pageId: number) => {document: object, actualPage: number}} getPageSource - store getter
 * @returns {Promise<Array<{page: number, pageId: number, text: string}>>} page = 1-based display number
 */
export async function extractDocumentPages(visiblePages, getPageSource) {
  return Promise.all(visiblePages.map(async (pageId, index) => {
    const source = getPageSource(pageId)
    const text = source?.document ? await getPageText(source.document, source.actualPage) : ''
    return { page: index + 1, pageId, text }
  }))
}
