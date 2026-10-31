/**
 * Markdown rendering utilities with LaTeX and code highlighting support
 * Following MarkText's approach
 */

import { marked } from 'marked'
import katex from 'katex'
import Prism from 'prismjs'
import createDOMPurify from 'dompurify'

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
// php hooks into every highlight call and needs markup-templating loaded first
import 'prismjs/components/prism-markup-templating'
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

// Markdown can come from untrusted sources (shared .pdfmark files, LLM output
// steered by PDF contents) and the renderer has Node integration, so KaTeX may
// only emit links, and only to safe protocols. Everything else (\htmlClass,
// \includegraphics, javascript: URLs, ...) is rejected.
const SAFE_LINK_PROTOCOLS = new Set(['http', 'https', 'mailto'])

function isTrustedKatexCommand(context) {
  if (context.command !== '\\href' && context.command !== '\\url') return false
  return SAFE_LINK_PROTOCOLS.has(context.protocol)
}

// DOMPurify needs a window; create it lazily so importing this module never
// fails in environments without a DOM.
let purifier = null

function getPurifier() {
  if (!purifier) {
    purifier = createDOMPurify(window)
    // Force links to open outside the app window (see main process
    // setWindowOpenHandler) and drop referrer information.
    purifier.addHook('afterSanitizeAttributes', (node) => {
      if (node.tagName === 'A' && node.hasAttribute('href')) {
        node.setAttribute('target', '_blank')
        node.setAttribute('rel', 'noopener noreferrer')
      }
    })
  }
  return purifier
}

/**
 * Remove scripts, event handlers, javascript: URLs etc. from rendered HTML
 * @param {string} html
 * @returns {string}
 */
export function sanitizeHtml(html) {
  return getPurifier().sanitize(html, {
    USE_PROFILES: { html: true, svg: true, mathMl: true },
    ADD_ATTR: ['target'],
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'iframe', 'object', 'embed']
  })
}

/**
 * Render LaTeX math expression
 * @param {string} math - The LaTeX expression
 * @param {boolean} displayMode - Whether to render as display math
 * @param {object} macros - Custom LaTeX macros
 * @returns {string} - Rendered HTML or error message
 */
export function renderMath(math, displayMode = false, macros = {}) {
  const cacheKey = `${math}_${displayMode}_${JSON.stringify(macros)}`
  
  if (mathCache.has(cacheKey)) {
    return mathCache.get(cacheKey)
  }
  
  try {
    const html = katex.renderToString(math, {
      displayMode,
      throwOnError: false,
      macros,
      trust: isTrustedKatexCommand,
      strict: false
    })
    
    // data-tex keeps the source so copied/quoted selections can use TeX
    // instead of the rendered glyphs (DOMPurify drops KaTeX's <annotation>)
    const tex = escapeHtml(math)
    const result = displayMode
      ? `<div class="math-block" data-tex="${tex}">${html}</div>`
      : `<span class="math-inline" data-tex="${tex}">${html}</span>`
    
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

const PLACEHOLDER = '\x00'
const placeholder = (kind, index) => `${PLACEHOLDER}${kind}${index}${PLACEHOLDER}`
const placeholderPattern = (kind) => new RegExp(`${PLACEHOLDER}${kind}(\\d+)${PLACEHOLDER}`, 'g')

/**
 * Main markdown rendering function. The returned HTML is sanitized.
 * @param {string} text - Raw markdown text
 * @param {object} options - Rendering options
 * @param {object} [options.latexMacros] - Custom LaTeX macros
 * @returns {string} - Rendered, sanitized HTML
 */
export function renderMarkdown(text, options = {}) {
  if (!text) return ''
  
  const { latexMacros = {} } = options
  const codeBlocks = []
  const mathBlocks = []
  
  // Step 1: Protect code (fenced blocks, then inline spans) so "$" or "\(" in
  // code is never treated as math. Restored verbatim before markdown parsing.
  text = text.replace(/^([ \t]*)(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\1\2[ \t]*$/gm, (match) => {
    codeBlocks.push(match)
    return placeholder('C', codeBlocks.length - 1)
  })
  text = text.replace(/(`+)(?!`)([\s\S]*?[^`])\1(?!`)/g, (match) => {
    codeBlocks.push(match)
    return placeholder('C', codeBlocks.length - 1)
  })
  
  // Step 2: Extract LaTeX BEFORE markdown processing to protect it from
  // markdown escaping (e.g. "\[" would otherwise become "[").
  const addMath = (math, display) => {
    mathBlocks.push({ math: math.trim(), display })
    return placeholder(display ? 'D' : 'I', mathBlocks.length - 1)
  }
  // Display math: $$...$$ and \[...\]
  text = text.replace(/\$\$([\s\S]+?)\$\$/g, (match, math) => addMath(math, true))
  text = text.replace(/\\\[([\s\S]+?)\\\]/g, (match, math) => addMath(math, true))
  // Inline math: \(...\) and $...$ (skipping currency like "$5 and $10")
  text = text.replace(/\\\(([\s\S]+?)\\\)/g, (match, math) => addMath(math, false))
  text = text.replace(/\$([^$\n]+?)\$/g, (match, math) => {
    if (/^\d/.test(math.trim())) return match
    return addMath(math, false)
  })
  
  // Step 3: Restore code and parse markdown
  text = text.replace(placeholderPattern('C'), (match, index) => codeBlocks[parseInt(index)])
  let html = marked.parse(text)
  
  // Step 4: Replace placeholders with rendered LaTeX. Display math may have
  // been wrapped in a paragraph by marked.
  html = html.replace(new RegExp(`(?:<p>)?${placeholderPattern('D').source}(?:<\\/p>)?`, 'g'), (match, index) => {
    const block = mathBlocks[parseInt(index)]
    return renderMath(block.math, true, latexMacros)
  })
  html = html.replace(placeholderPattern('I'), (match, index) => {
    const block = mathBlocks[parseInt(index)]
    return renderMath(block.math, false, latexMacros)
  })
  
  return sanitizeHtml(html)
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
  sanitizeHtml,
  clearMathCache,
  getAvailableLanguages,
  isLanguageSupported,
  loadLanguage
}
