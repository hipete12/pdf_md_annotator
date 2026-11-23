// Zoom of the chat text (Ctrl +/- while the chat has focus), separate from
// the PDF zoom. Steps follow the browser's zoom levels.
export const CHAT_ZOOM_LEVELS = [0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]
export const DEFAULT_CHAT_ZOOM = 1

const MIN_ZOOM = CHAT_ZOOM_LEVELS[0]
const MAX_ZOOM = CHAT_ZOOM_LEVELS[CHAT_ZOOM_LEVELS.length - 1]
const EPSILON = 1e-6

/** A usable zoom factor from a stored setting (bad values → 100%). */
export function normalizeChatZoom(value) {
  const zoom = Number(value)
  if (value === null || value === '' || !Number.isFinite(zoom) || zoom <= 0) return DEFAULT_CHAT_ZOOM
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

/**
 * The next zoom level up (direction > 0) or down (direction < 0). Stays at
 * the limit when there is no further level.
 */
export function stepChatZoom(current, direction) {
  const zoom = normalizeChatZoom(current)
  if (direction > 0) return CHAT_ZOOM_LEVELS.find(level => level > zoom + EPSILON) ?? MAX_ZOOM
  return [...CHAT_ZOOM_LEVELS].reverse().find(level => level < zoom - EPSILON) ?? MIN_ZOOM
}

/** New zoom for a zoom action: 'in', 'out' or 'reset'. */
export function applyChatZoomAction(current, action) {
  if (action === 'reset') return DEFAULT_CHAT_ZOOM
  return stepChatZoom(current, action === 'in' ? 1 : -1)
}
