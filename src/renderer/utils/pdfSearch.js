/**
 * Find in the PDF: matching over PDF.js text items and highlighting in the
 * text layer. Matching ignores case and treats any run of whitespace
 * (including line ends) as one space. Each match maps back to the text
 * items it covers, and text item i is text layer span i (TextLayer renders
 * one span per item with a string, in order).
 */

/** Lower-case query with whitespace collapsed; '' when there is nothing to find. */
export function normalizeQuery(query) {
  return String(query ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
}

// Indexes are cached per items array (getPageTextItems returns one array per page)
const indexCache = new WeakMap()

/**
 * Searchable text of a page, with the text item and offset of each character.
 * @param {Array<{str: string, hasEOL?: boolean}>} items
 * @returns {{ text: string, itemOf: number[], offsetOf: number[], lengths: number[] }}
 */
export function buildPageIndex(items) {
  const cached = indexCache.get(items)
  if (cached) return cached

  let text = ''
  const itemOf = []
  const offsetOf = []
  const lengths = []
  let afterSpace = true // no leading space
  const push = (chars, item, offset) => {
    text += chars
    for (let k = 0; k < chars.length; k++) {
      itemOf.push(item)
      offsetOf.push(offset)
    }
  }
  items.forEach((item, i) => {
    const str = typeof item.str === 'string' ? item.str : ''
    lengths.push(str.length)
    for (let offset = 0; offset < str.length; offset++) {
      const ch = str[offset]
      if (/\s/.test(ch)) {
        if (!afterSpace) push(' ', i, offset)
        afterSpace = true
      } else {
        push(ch.toLowerCase(), i, offset)
        afterSpace = false
      }
    }
    // A line end separates words like a space; it has no character in the
    // span, so it maps to the end of the item
    if (item.hasEOL && !afterSpace) {
      push(' ', i, str.length)
      afterSpace = true
    }
  })

  const index = { text, itemOf, offsetOf, lengths }
  if (items && typeof items === 'object') indexCache.set(items, index)
  return index
}

// Text item ranges covered by text[start, end)
function toSegments(index, start, end) {
  const segments = []
  for (let k = start; k < end; k++) {
    const item = index.itemOf[k]
    const offset = index.offsetOf[k]
    if (offset >= index.lengths[item]) continue // line end
    const last = segments[segments.length - 1]
    if (last && last.item === item) last.end = offset + 1
    else segments.push({ item, start: offset, end: offset + 1 })
  }
  return segments
}

/**
 * Matches of a query in a page index, in reading order (not overlapping).
 * @returns {Array<Array<{item: number, start: number, end: number}>>} one list of item ranges per match
 */
export function findMatches(index, query) {
  const needle = normalizeQuery(query)
  if (!needle) return []
  const matches = []
  let from = 0
  for (;;) {
    const start = index.text.indexOf(needle, from)
    if (start === -1) break
    const segments = toSegments(index, start, start + needle.length)
    if (segments.length) matches.push(segments)
    from = start + needle.length
  }
  return matches
}

/**
 * Index of the match to show first: the first one on or after the page in
 * view, else the first one.
 * @param {Array<{pageId: number}>} matches
 * @param {number[]} pages - page ids in display order
 */
export function firstMatchFrom(matches, pages, viewPageId) {
  if (!matches.length) return -1
  const viewIndex = Math.max(0, pages.indexOf(viewPageId))
  const found = matches.findIndex(match => pages.indexOf(match.pageId) >= viewIndex)
  return found === -1 ? 0 : found
}

/** Put the original text back into text layer spans. */
export function restoreTextDivs(textDivs, itemsStr, indices) {
  for (const i of indices) {
    if (textDivs[i] && typeof itemsStr[i] === 'string') textDivs[i].textContent = itemsStr[i]
  }
}

/**
 * Wrap the matched text of text layer spans in <span class="search-hit">
 * ("search-hit selected" for the current match).
 * @param {HTMLElement[]} textDivs - TextLayer.textDivs
 * @param {string[]} itemsStr - TextLayer.textContentItemsStr
 * @param {Array<{segments: Array<{item, start, end}>, selected?: boolean}>} hits
 * @returns {number[]} indices of the spans that changed (for restoreTextDivs)
 */
export function highlightTextDivs(textDivs, itemsStr, hits) {
  const byItem = new Map()
  for (const hit of hits) {
    for (const segment of hit.segments) {
      if (!byItem.has(segment.item)) byItem.set(segment.item, [])
      byItem.get(segment.item).push({ ...segment, selected: Boolean(hit.selected) })
    }
  }

  const changed = []
  for (const [i, segments] of byItem) {
    const div = textDivs[i]
    const str = itemsStr[i]
    if (!div || typeof str !== 'string') continue
    const doc = div.ownerDocument
    const fragment = doc.createDocumentFragment()
    let pos = 0
    segments.sort((a, b) => a.start - b.start)
    for (const segment of segments) {
      const start = Math.max(segment.start, pos)
      const end = Math.min(segment.end, str.length)
      if (end <= start) continue
      if (start > pos) fragment.append(str.slice(pos, start))
      const mark = doc.createElement('span')
      mark.className = segment.selected ? 'search-hit selected' : 'search-hit'
      mark.textContent = str.slice(start, end)
      fragment.append(mark)
      pos = end
    }
    if (pos < str.length) fragment.append(str.slice(pos))
    div.replaceChildren(fragment)
    changed.push(i)
  }
  return changed
}
