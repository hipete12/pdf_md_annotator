/**
 * Plain-data view of the application menu, for the in-app title bar.
 *
 * On Windows and Linux the window has no native frame: the renderer draws the
 * title bar and menu bar itself so they follow the app theme (GNOME and
 * Windows draw the native ones in the system theme, whatever the app uses).
 * The main process keeps the real Electron menu, which still handles the
 * keyboard accelerators, and sends this serialized copy to the renderer.
 * Menu items are addressed by their index path, e.g. [0, 2] for File > Save.
 */

/**
 * Whether the window draws its own title bar (no native frame)
 * @param {string} platform - process.platform
 * @returns {boolean}
 */
export function usesCustomTitleBar(platform) {
  return platform === 'win32' || platform === 'linux'
}

/**
 * Serialize Electron MenuItems (or plain objects with the same shape)
 * @param {Array} items - menu.items
 * @returns {Array<{type: string, label: string, enabled: boolean, visible: boolean, checked?: boolean, accelerator: string, submenu?: Array}>}
 */
export function serializeMenu(items) {
  return (items || []).map((item) => {
    const isCheck = item.type === 'checkbox' || item.type === 'radio'
    const entry = {
      type: item.type === 'separator' ? 'separator' : (isCheck ? item.type : 'normal'),
      label: item.label || '',
      enabled: item.enabled !== false,
      visible: item.visible !== false,
      // Role items (undo, copy, ...) only carry their default accelerator
      accelerator: String(
        item.accelerator ||
        (typeof item.getDefaultRoleAccelerator === 'function' ? item.getDefaultRoleAccelerator() : '') ||
        ''
      )
    }
    if (isCheck) entry.checked = Boolean(item.checked)
    if (item.submenu) entry.submenu = serializeMenu(item.submenu.items)
    return entry
  })
}

/**
 * Find the menu item at an index path
 * @param {Array} items - top-level menu.items
 * @param {number[]} indexPath
 * @returns {object|null}
 */
export function menuItemAt(items, indexPath) {
  if (!Array.isArray(indexPath) || indexPath.length === 0) return null
  let list = items || []
  let item = null
  for (const index of indexPath) {
    if (!Number.isInteger(index) || index < 0 || index >= list.length) return null
    item = list[index]
    list = item.submenu ? item.submenu.items : []
  }
  return item
}

const KEY_NAMES = {
  commandorcontrol: 'Ctrl',
  cmdorctrl: 'Ctrl',
  control: 'Ctrl',
  ctrl: 'Ctrl',
  command: 'Cmd',
  cmd: 'Cmd',
  alt: 'Alt',
  option: 'Alt',
  altgr: 'AltGr',
  shift: 'Shift',
  super: 'Super',
  meta: 'Super',
  plus: '+',
  space: 'Space',
  return: 'Enter',
  enter: 'Enter',
  escape: 'Esc',
  esc: 'Esc'
}

// Display order of modifiers ("Shift+CmdOrCtrl+Z" reads as "Ctrl+Shift+Z")
const MODIFIER_ORDER = ['Ctrl', '⌘', 'Cmd', 'Alt', 'AltGr', 'Shift', 'Super']

/**
 * Human-readable accelerator: "CmdOrCtrl+Shift+S" -> "Ctrl+Shift+S"
 * @param {string} accelerator - Electron accelerator string
 * @param {string} [platform] - process.platform (macOS uses symbols)
 * @returns {string}
 */
export function formatAccelerator(accelerator, platform) {
  if (!accelerator) return ''
  const mac = platform === 'darwin'
  const parts = String(accelerator).split('+')
  // "CmdOrCtrl++" splits into a trailing empty pair: that key is "+"
  if (parts.length > 1 && parts[parts.length - 1] === '' && parts[parts.length - 2] === '') {
    parts.splice(-2, 2, '+')
  }
  const names = parts.map((part) => {
    const key = part.toLowerCase()
    if (mac && (key === 'commandorcontrol' || key === 'cmdorctrl' || key === 'command' || key === 'cmd')) return '⌘'
    if (KEY_NAMES[key]) return KEY_NAMES[key]
    return part.length === 1 ? part.toUpperCase() : part
  })
  const key = names.pop()
  names.sort((a, b) => MODIFIER_ORDER.indexOf(a) - MODIFIER_ORDER.indexOf(b))
  return [...names, key].join('+')
}
