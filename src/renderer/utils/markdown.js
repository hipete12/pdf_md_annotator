/**
 * Markdown rendering utilities with LaTeX and code highlighting support
 * Following MarkText's approach
 */

import { marked } from 'marked'
import katex from 'katex'
import Prism from 'prismjs'

// Import Prism languages (like MarkText does)
import 'prismjs/components/prism-javascript'
import 'prismjs/components/prism-typescript'
import 'prismjs/components/prism-python'
import 'prismjs/components/prism-java'
import 'prismjs/components/prism-c'
import 'prismjs/components/prism-cpp'
import 'prismjs/components/prism-csharp'
import 'prismjs/components/prism-go'
import 'prismjs/components/prism-rust'
import 'prismjs/components/prism-ruby'
import 'prismjs/components/prism-php'
import 'prismjs/components/prism-sql'
import 'prismjs/components/prism-bash'
import 'prismjs/components/prism-shell-session'
import 'prismjs/components/prism-json'
import 'prismjs/components/prism-yaml'
import 'prismjs/components/prism-markdown'
import 'prismjs/components/prism-markup'
import 'prismjs/components/prism-css'
import 'prismjs/components/prism-scss'
import 'prismjs/components/prism-latex'

// Cache for rendered math to improve performance (like MarkText)
const mathCache = new Map()

/**
 * Render LaTeX math expression
 * @param {string} math - The LaTeX expression
 * @param {boolean} displayMode - Whether to render as display math
 * @param {object} macros - Custom LaTeX macros
 * @returns {string} - Rendered HTML or error message
 */
function renderMath(math, displayMode = false, macros = {}) {
  const cacheKey = `${math}_${displayMode}_${JSON.stringify(macros)}`
  
  if (mathCache.has(cacheKey)) {
    return mathCache.get(cacheKey)
  }
  
  try {
    const html = katex.renderToString(math, {
      displayMode,
      throwOnError: false,
      macros,
      trust: true,
      strict: false
    })
    
    const result = displayMode 
      ? `<div class="math-block">${html}</div>`
      : `<span class="math-inline">${html}</span>`
    
    mathCache.set(cacheKey, result)
    return result
  } catch (err) {
    const errorHtml = `<span class="math-error" title="${escapeHtml(err.message)}">LaTeX Error: ${escapeHtml(math)}</span>`
    return errorHtml
  }
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }
  return text.replace(/[&<>"']/g, m => map[m])
}

/**
 * Process LaTeX in text
 * Handles both inline ($...$) and display ($$...$$) math
 */
function processLatex(text, macros = {}) {
  // First, handle display math ($$...$$)
  text = text.replace(/\$\$([\s\S]+?)\$\$/g, (match, math) => {
    return renderMath(math.trim(), true, macros)
  })
  
  // Then handle inline math ($...$)
  // Be careful not to match escaped dollar signs or currency
  text = text.replace(/(?<!\\)\$(?!\$)(.+?)(?<!\\)\$/g, (match, math) => {
    return renderMath(math.trim(), false, macros)
  })
  
  return text
}

/**
 * Custom marked renderer for code highlighting
 */
const renderer = new marked.Renderer()

// Override code block rendering to use Prism
renderer.code = function(code, language) {
  // Handle code object from newer marked versions
  if (typeof code === 'object') {
    language = code.lang
    code = code.text
  }
  
  const lang = language || 'plaintext'
  const validLang = Prism.languages[lang] ? lang : 'plaintext'
  
  let highlighted
  try {
    if (Prism.languages[validLang]) {
      highlighted = Prism.highlight(code, Prism.languages[validLang], validLang)
    } else {
      highlighted = escapeHtml(code)
    }
  } catch (err) {
    highlighted = escapeHtml(code)
  }
  
  return `<pre class="language-${validLang}"><code class="language-${validLang}">${highlighted}</code></pre>`
}

// Override inline code
renderer.codespan = function(code) {
  if (typeof code === 'object') {
    code = code.text
  }
  return `<code>${escapeHtml(code)}</code>`
}

// Configure marked
marked.setOptions({
  renderer,
  gfm: true, // GitHub Flavored Markdown
  breaks: true, // Convert \n to <br>
  pedantic: false,
  smartLists: true,
  smartypants: false,
  xhtml: false
})

/**
 * Main markdown rendering function
 * @param {string} text - Raw markdown text
 * @param {object} options - Rendering options
 * @returns {string} - Rendered HTML
 */
export function renderMarkdown(text, options = {}) {
  if (!text) return ''
  
  const { latexMacros = {} } = options

  // Normalize empty list markers ("1. ", "- ", "* " with no content yet):
  // marked falls back to a plain paragraph (or a setext heading for "- ")
  // when the item has no content, splitting the text into new blocks and
  // adding a visible gap where there was a tight single line. Append a
  // zero-width space so they parse as real (empty) list items instead.
  // Never touches lines inside fenced code blocks.
  const lines = text.split('\n')
  let inFence = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence
    } else if (!inFence && /^( {0,3}(?:[-+*]|\d+\.)[ \t]+)\r?$/.test(line)) {
      // Insert the ZWSP before any trailing \r so CRLF content still parses
      lines[i] = line.replace(/[ \t]+(?=\r?$)/, m => m + '\u200b')
    }
  }
  text = lines.join('\n')
  
  // Step 1: Extract LaTeX BEFORE markdown processing to protect from escaping
  const mathBlocks = []
  const DISPLAY_PLACEHOLDER = '\x00DISPLAY_MATH_'
  const INLINE_PLACEHOLDER = '\x00INLINE_MATH_'
  
  // Extract display math ($$...$$) first
  text = text.replace(/\$\$([\s\S]+?)\$\$/g, (match, math) => {
    const index = mathBlocks.length
    mathBlocks.push({ math: math.trim(), display: true })
    return DISPLAY_PLACEHOLDER + index + '\x00'
  })
  
  // Extract inline math ($...$)
  text = text.replace(/\$([^$\n]+?)\$/g, (match, math) => {
    // Skip if it looks like currency (number after $)
    if (/^\d/.test(math.trim())) return match
    const index = mathBlocks.length
    mathBlocks.push({ math: math.trim(), display: false })
    return INLINE_PLACEHOLDER + index + '\x00'
  })
  
  // Step 2: Parse markdown
  let html = marked.parse(text)

  // Strip newlines between HTML tags. marked emits pretty-printed HTML and
  // the preview uses white-space: pre-wrap, so the literal newlines between
  // block elements would render as phantom line boxes (doubling the spacing
  // of lists, paragraphs, tables, etc.). Newlines inside <pre>/<code> text
  // are untouched; single spaces between inline elements are preserved.
  html = html.replace(/>\s*\n\s*</g, '><').replace(/\s+$/, '')
  
  // Step 3: Replace placeholders with rendered LaTeX
  // Handle display math placeholders (may have <p>, <br> tags wrapped around)
  html = html.replace(new RegExp(`(?:<p>)?${DISPLAY_PLACEHOLDER.replace('\x00', '\\x00')}(\\d+)\\x00(?:<\\/p>)?`, 'g'), (match, index) => {
    const block = mathBlocks[parseInt(index)]
    return renderMath(block.math, true, latexMacros)
  })
  
  // Handle inline math placeholders
  html = html.replace(new RegExp(`${INLINE_PLACEHOLDER.replace('\x00', '\\x00')}(\\d+)\\x00`, 'g'), (match, index) => {
    const block = mathBlocks[parseInt(index)]
    return renderMath(block.math, false, latexMacros)
  })
  
  return html
}

/**
 * Clear the math cache
 */
export function clearMathCache() {
  mathCache.clear()
}

/**
 * Get language list for autocomplete
 */
export function getAvailableLanguages() {
  return Object.keys(Prism.languages).filter(lang => 
    typeof Prism.languages[lang] === 'object'
  ).sort()
}

/**
 * Check if a language is supported
 */
export function isLanguageSupported(lang) {
  return !!Prism.languages[lang]
}

/**
 * Dynamically load a Prism language
 * Following MarkText's pattern of lazy loading
 */
export async function loadLanguage(lang) {
  if (Prism.languages[lang]) return true
  
  try {
    await import(`prismjs/components/prism-${lang}`)
    return true
  } catch (err) {
    console.warn(`Failed to load Prism language: ${lang}`)
    return false
  }
}

export default {
  renderMarkdown,
  renderMath,
  clearMathCache,
  getAvailableLanguages,
  isLanguageSupported,
  loadLanguage
}
