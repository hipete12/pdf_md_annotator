/**
 * Shared constants and utilities used by both main and renderer processes
 */

// .pdfmark file format version
export const PDFMARK_VERSION = '1.0.0'

// File extensions
export const PDF_EXTENSION = '.pdf'
export const PDFMARK_EXTENSION = '.pdfmark'
export const PDFMARK_TEMP_EXTENSION = '.pdfmark.tmp'

// Default settings
export const DEFAULT_SETTINGS = {
  markdown: {
    fontSize: 14,
    lineHeight: 1.6,
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
  },
  annotationBox: {
    defaultWidth: 300,
    defaultHeight: 200,
    minWidth: 100,
    minHeight: 50
  },
  latex: {
    macros: {},
    throwOnError: false
  },
  shortcuts: {
    bold: 'Ctrl+B',
    italic: 'Ctrl+I',
    underline: 'Ctrl+U',
    save: 'Ctrl+S',
    hideAnnotation: 'Ctrl+H'
  },
  ui: {
    sidebarWidth: 200,
    sidebarVisible: true,
    theme: 'light'
  }
}

// Zoom limits
export const MIN_SCALE = 0.25
export const MAX_SCALE = 4.0
export const SCALE_STEP = 0.25

// Auto-save delay in milliseconds
export const AUTO_SAVE_DELAY = 2000

// Supported languages for syntax highlighting
export const PRISM_LANGUAGES = [
  'javascript',
  'typescript',
  'python',
  'java',
  'c',
  'cpp',
  'csharp',
  'go',
  'rust',
  'ruby',
  'php',
  'sql',
  'bash',
  'json',
  'yaml',
  'markdown',
  'html',
  'css',
  'scss',
  'latex'
]

// IPC channel names
export const IPC_CHANNELS = {
  GET_SETTINGS: 'get-settings',
  SET_SETTINGS: 'set-settings',
  GET_SETTING: 'get-setting',
  SET_SETTING: 'set-setting',
  SAVE_PDFMARK: 'save-pdfmark',
  COMMIT_PDFMARK: 'commit-pdfmark',
  OPEN_FILE_DIALOG: 'open-file-dialog',
  READ_PDF_FILE: 'read-pdf-file',
  OPEN_PDF: 'open-pdf',
  SAVE_FILE: 'save-file',
  SAVE_FILE_AS: 'save-file-as',
  TOGGLE_SIDEBAR: 'toggle-sidebar',
  ZOOM_IN: 'zoom-in',
  ZOOM_OUT: 'zoom-out',
  ZOOM_RESET: 'zoom-reset',
  OPEN_SETTINGS: 'open-settings'
}

/**
 * Get the .pdfmark path for a given PDF path
 * @param {string} pdfPath - Path to the PDF file
 * @returns {string} Path to the corresponding .pdfmark file
 */
export function getPdfmarkPath(pdfPath) {
  return pdfPath.replace(/\.pdf$/i, PDFMARK_EXTENSION)
}

/**
 * Get the temp .pdfmark path for auto-save
 * @param {string} pdfPath - Path to the PDF file
 * @returns {string} Path to the temp .pdfmark file
 */
export function getTempPdfmarkPath(pdfPath) {
  return pdfPath.replace(/\.pdf$/i, PDFMARK_TEMP_EXTENSION)
}

/**
 * Validate a .pdfmark file structure
 * @param {object} data - Parsed .pdfmark data
 * @returns {boolean} True if valid
 */
export function validatePdfmarkData(data) {
  if (!data || typeof data !== 'object') return false
  if (!data.version) return false
  if (!Array.isArray(data.pageOrder) && data.pageOrder !== undefined) return false
  if (typeof data.annotations !== 'object' && data.annotations !== undefined) return false
  return true
}

/**
 * Create a new .pdfmark file structure
 * @param {string} pdfPath - Path to the PDF
 * @returns {object} New .pdfmark data structure
 */
export function createPdfmarkData(pdfPath) {
  return {
    version: PDFMARK_VERSION,
    pdfPath,
    created: new Date().toISOString(),
    modified: new Date().toISOString(),
    annotations: {},
    pageOrder: [],
    deletedPages: [],
    settings: {}
  }
}

export default {
  PDFMARK_VERSION,
  PDF_EXTENSION,
  PDFMARK_EXTENSION,
  DEFAULT_SETTINGS,
  MIN_SCALE,
  MAX_SCALE,
  SCALE_STEP,
  AUTO_SAVE_DELAY,
  PRISM_LANGUAGES,
  IPC_CHANNELS,
  getPdfmarkPath,
  getTempPdfmarkPath,
  validatePdfmarkData,
  createPdfmarkData
}
