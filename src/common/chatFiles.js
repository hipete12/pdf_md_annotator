/**
 * Naming rules for standalone chat files. A standalone chat is stored as
 * "<name>.chat" in the chats folder; its generated Quarto document is
 * "<name>.qmd" next to it (one document per chat).
 * Pure helpers shared by the main process and the renderer.
 */

export const CHAT_EXTENSION = '.chat'
export const DOC_EXTENSION = '.qmd'
export const UNTITLED_PREFIX = 'untitled'

export function isPdfFile(filePath) {
  return /\.pdf$/i.test(String(filePath || ''))
}

export function isChatFile(filePath) {
  return /\.chat$/i.test(String(filePath || ''))
}

/** File name without folder and extension: "/a/untitled3.chat" -> "untitled3" */
export function chatBaseName(filePath) {
  const name = String(filePath || '').split(/[\\/]/).pop()
  return name.replace(/\.chat$/i, '')
}

/** "/a/untitled3.chat" -> "/a/untitled3.qmd" */
export function docPathFor(chatPath) {
  return String(chatPath).replace(/\.chat$/i, DOC_EXTENSION)
}

/** Make sure a path chosen in a save dialog ends in .chat */
export function withChatExtension(filePath) {
  return isChatFile(filePath) ? filePath : `${filePath}${CHAT_EXTENSION}`
}

/**
 * Lowest "untitledN" (N >= 1) for which neither untitledN.chat nor
 * untitledN.qmd is among the existing file names (case-insensitive).
 * @param {string[]} existingNames - file names in the chats folder
 * @returns {string} base name, e.g. "untitled2"
 */
export function nextUntitledName(existingNames) {
  const taken = new Set((existingNames || []).map(n => String(n).toLowerCase()))
  for (let n = 1; ; n++) {
    const base = `${UNTITLED_PREFIX}${n}`
    if (!taken.has(`${base}${CHAT_EXTENSION}`) && !taken.has(`${base}${DOC_EXTENSION}`)) return base
  }
}
