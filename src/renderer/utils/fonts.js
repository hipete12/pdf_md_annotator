/**
 * Font family values as used by the <option>s of the font pickers.
 *
 * The default setting writes "Segoe UI" in double quotes while the pickers'
 * options use single quotes, so the saved value never matched an option and
 * the picker showed blank. Normalising the quotes makes them match.
 */

export const SYSTEM_FONT_STACK = "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"

/**
 * @param {string} [fontFamily] - stored CSS font-family value
 * @returns {string} value matching the pickers' options
 */
export function fontOptionValue(fontFamily) {
  if (!fontFamily || fontFamily.trim() === 'system-ui') return SYSTEM_FONT_STACK
  return fontFamily.replace(/"/g, "'")
}
