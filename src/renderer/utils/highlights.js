/**
 * Text highlights on PDF pages. A highlight is a set of rectangles in page
 * units (CSS px at 100% zoom, from the page's top-left corner), so it is
 * drawn at any zoom by scaling. Saved in the .pdfmark under
 * highlights: { [pageId]: [{ id, color, rects: [{ x, y, w, h }], text, created }] }.
 */

export const HIGHLIGHT_COLORS = [
  { name: 'Yellow', value: '#facc15' },
  { name: 'Green', value: '#4ade80' },
  { name: 'Blue', value: '#60a5fa' },
  { name: 'Pink', value: '#f472b6' },
  { name: 'Orange', value: '#fb923c' },
  { name: 'Purple', value: '#c084fc' }
]

export const DEFAULT_HIGHLIGHT_COLOR = HIGHLIGHT_COLORS[0].value

/** A #rrggbb color (lower case), or the default for anything else. */
export function normalizeColor(color) {
  const value = String(color ?? '').trim().toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(value)) return value
  if (/^#[0-9a-f]{3}$/.test(value)) return `#${[...value.slice(1)].map(c => c + c).join('')}`
  return DEFAULT_HIGHLIGHT_COLOR
}

const finite = (n) => typeof n === 'number' && Number.isFinite(n)

/**
 * Merge rectangles of the same text line that touch or overlap, so a
 * highlight is one box per line (overlapping translucent boxes would show
 * darker seams). Tiny rectangles (line breaks, empty spans) are dropped.
 * @param {Array<{x, y, w, h}>} rects
 */
export function mergeLineRects(rects) {
  const sorted = rects
    .filter(r => finite(r.x) && finite(r.y) && r.w > 0.5 && r.h > 0.5)
    .map(r => ({ x: r.x, y: r.y, w: r.w, h: r.h }))
    .sort((a, b) => a.y - b.y || a.x - b.x)
  const merged = []
  for (const rect of sorted) {
    const line = merged.find(m => {
      const overlap = Math.min(m.y + m.h, rect.y + rect.h) - Math.max(m.y, rect.y)
      const sameLine = overlap > 0.5 * Math.min(m.h, rect.h)
      const gap = Math.max(m.x, rect.x) - Math.min(m.x + m.w, rect.x + rect.w)
      return sameLine && gap < 0.5 * Math.min(m.h, rect.h)
    })
    if (line) {
      const right = Math.max(line.x + line.w, rect.x + rect.w)
      const bottom = Math.max(line.y + line.h, rect.y + rect.h)
      line.x = Math.min(line.x, rect.x)
      line.y = Math.min(line.y, rect.y)
      line.w = right - line.x
      line.h = bottom - line.y
    } else {
      merged.push(rect)
    }
  }
  return merged.map(r => ({ x: round(r.x), y: round(r.y), w: round(r.w), h: round(r.h) }))
}

const round = (n) => Math.round(n * 100) / 100

function intersects(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

/** Highlights with a rectangle overlapping any of the given rectangles. */
export function overlappingHighlights(highlights, rects) {
  return (highlights || []).filter(h => h.rects.some(hr => rects.some(r => intersects(hr, r))))
}

/** The highlight under a point (the one drawn last, i.e. on top), or null. */
export function highlightAt(highlights, x, y) {
  const list = highlights || []
  for (let i = list.length - 1; i >= 0; i--) {
    const rect = list[i].rects.find(r => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h)
    if (rect) return { highlight: list[i], rect }
  }
  return null
}

/** Valid highlights from a .pdfmark (anything malformed is dropped). */
export function sanitizeHighlights(data) {
  const result = {}
  if (!data || typeof data !== 'object' || Array.isArray(data)) return result
  for (const [pageKey, list] of Object.entries(data)) {
    if (!/^\d+$/.test(pageKey) || !Array.isArray(list)) continue
    const valid = list
      .filter(h => h && typeof h.id === 'string' && Array.isArray(h.rects))
      .map(h => ({
        id: h.id,
        color: normalizeColor(h.color),
        rects: h.rects.filter(r => r && [r.x, r.y, r.w, r.h].every(finite) && r.w > 0 && r.h > 0)
          .map(r => ({ x: r.x, y: r.y, w: r.w, h: r.h })),
        text: typeof h.text === 'string' ? h.text : '',
        created: typeof h.created === 'string' ? h.created : null
      }))
      .filter(h => h.rects.length)
    if (valid.length) result[pageKey] = valid
  }
  return result
}

/**
 * What highlighting a selection does: one new highlight per page covering
 * the selection, merged with the highlights it overlaps (which it replaces),
 * so highlighting across or inside an existing highlight extends or
 * recolors it instead of stacking.
 * @param {Object} highlightsByPage - state.highlights
 * @param {Array<{pageId, rects, text}>} targets - selection, per page
 * @returns {{ removed: Array<{pageId, highlight}>, added: Array<{pageId, rects, text}> }}
 */
export function planHighlight(highlightsByPage, targets) {
  const removed = []
  const added = []
  for (const target of targets) {
    const overlapped = overlappingHighlights(highlightsByPage[target.pageId], target.rects)
    for (const highlight of overlapped) removed.push({ pageId: target.pageId, highlight })
    const rects = mergeLineRects([...target.rects, ...overlapped.flatMap(h => h.rects)])
    // Keep the longest text (a selection inside a highlight recolors it)
    const text = [target.text || '', ...overlapped.map(h => h.text || '')]
      .reduce((longest, t) => (t.length > longest.length ? t : longest), '')
    if (rects.length) added.push({ pageId: target.pageId, rects, text })
  }
  return { removed, added }
}
