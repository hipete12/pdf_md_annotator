/**
 * Renders PDF pages to JPEG data URLs for vision-capable models. Uses its own
 * offscreen canvas so the viewer's canvases and render queue are untouched.
 */

/**
 * @param {object} document - PDF.js document
 * @param {number} pageNumber - page within that document (1-based)
 * @param {object} [options]
 * @param {number} [options.maxSide=1024] - longest side in pixels
 * @param {number} [options.quality=0.8] - JPEG quality
 * @returns {Promise<string>} data:image/jpeg;base64,...
 */
export async function renderPageImage(document, pageNumber, { maxSide = 1024, quality = 0.8 } = {}) {
  const page = await document.getPage(pageNumber)
  const base = page.getViewport({ scale: 1 })
  const scale = maxSide / Math.max(base.width, base.height)
  const viewport = page.getViewport({ scale })

  const canvas = window.document.createElement('canvas')
  canvas.width = Math.round(viewport.width)
  canvas.height = Math.round(viewport.height)
  const context = canvas.getContext('2d')
  // JPEG has no alpha: paint white so transparent pages don't turn black
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)

  try {
    await page.render({ canvasContext: context, viewport }).promise
    return canvas.toDataURL('image/jpeg', quality)
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
}

/**
 * Choose which pages to send as images.
 * @param {object} params
 * @param {'context'|'all'} params.mode
 * @param {Array<{pageId: number}>} params.contexts - contexts attached to the message
 * @param {number[]} params.visiblePages - page ids in display order
 * @param {number|null} params.viewPage - page id being read
 * @param {number} params.max
 * @returns {number[]} page ids in display order
 */
export function selectVisionPages({ mode, contexts, visiblePages, viewPage, max }) {
  let pageIds
  if (mode === 'all') {
    pageIds = [...visiblePages]
  } else {
    pageIds = [...new Set((contexts || []).map(c => c.pageId).filter(id => visiblePages.includes(id)))]
    if (pageIds.length === 0 && viewPage != null && visiblePages.includes(viewPage)) pageIds = [viewPage]
    if (pageIds.length === 0 && visiblePages.length) pageIds = [visiblePages[0]]
  }
  return pageIds
    .sort((a, b) => visiblePages.indexOf(a) - visiblePages.indexOf(b))
    .slice(0, Math.max(0, max))
}
