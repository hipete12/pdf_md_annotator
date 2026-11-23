/**
 * Images pasted into the chat (screenshots, copied pictures). They are kept
 * as data URLs in the message, so they are scaled down first: providers
 * resize large images anyway, and the chat file stays reasonably small.
 */
import { v4 as uuidv4 } from 'uuid'

// Longest side sent to the model (larger images are scaled down)
export const MAX_IMAGE_SIDE = 2048
// Images per message
export const MAX_IMAGES_PER_MESSAGE = 8
// Above this size (data URL characters) a PNG is re-encoded as JPEG
const MAX_PNG_DATA_URL = 3 * 1024 * 1024

/** Size that fits within max × max, keeping the aspect ratio (never upscales). */
export function fitWithin(width, height, max = MAX_IMAGE_SIDE) {
  const scale = Math.min(1, max / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/** Image files in a paste (or drop) event's DataTransfer. */
export function imageFilesFrom(dataTransfer) {
  if (!dataTransfer) return []
  const fromItems = [...(dataTransfer.items || [])]
    .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
    .map(item => item.getAsFile())
    .filter(Boolean)
  if (fromItems.length) return fromItems
  return [...(dataTransfer.files || [])].filter(file => file.type.startsWith('image/'))
}

/**
 * A pasted image file as a chat attachment:
 * { id, type: 'image', mime, dataUrl, width, height, name }.
 * Scaled to MAX_IMAGE_SIDE; PNG is kept (sharp text in screenshots) unless
 * it is very large, then JPEG.
 */
export async function prepareImage(file) {
  const bitmap = await createImageBitmap(file)
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, width, height)

    let mime = 'image/png'
    let dataUrl = canvas.toDataURL(mime)
    if (dataUrl.length > MAX_PNG_DATA_URL) {
      // JPEG has no transparency: put the image on white
      ctx.globalCompositeOperation = 'destination-over'
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, width, height)
      mime = 'image/jpeg'
      dataUrl = canvas.toDataURL(mime, 0.9)
    }
    return { id: uuidv4(), type: 'image', mime, dataUrl, width, height, name: file.name || '' }
  } finally {
    bitmap.close?.()
  }
}

/** Valid image attachments from a saved message (anything malformed is dropped). */
export function sanitizeAttachments(attachments) {
  if (!Array.isArray(attachments)) return []
  return attachments
    .filter(a => a && a.type === 'image' && typeof a.dataUrl === 'string' && a.dataUrl.startsWith('data:image/'))
    .map(a => ({
      id: typeof a.id === 'string' ? a.id : uuidv4(),
      type: 'image',
      mime: typeof a.mime === 'string' ? a.mime : a.dataUrl.slice(5, a.dataUrl.indexOf(';')),
      dataUrl: a.dataUrl,
      width: Number(a.width) || 0,
      height: Number(a.height) || 0,
      name: typeof a.name === 'string' ? a.name : ''
    }))
}
