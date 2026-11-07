/**
 * Helpers for context chips (snippets attached to a chat message): labels,
 * locations, and turning a selection in a rendered reply back into text.
 *
 * Kinds: 'text' (PDF text), 'note' (user note), 'reply' (earlier assistant reply),
 * 'report' (text from the rendered /generate document).
 * Each kind has a colour; the global classes ctx-text / ctx-note / ctx-reply / ctx-report
 * (styles/main.css) set the CSS variable --ctx accordingly.
 */

const MAX_SECTION_CHARS = 32
const KIND_LABELS = { text: 'Text', note: 'Note', reply: 'Reply', report: 'Report' }

/** Short kind label shown on a chip ("Selection" for a pending PDF selection). */
export function contextKindLabel(context, { pending = false } = {}) {
  if (pending && context?.kind === 'text') return 'Selection'
  return KIND_LABELS[context?.kind] || 'Text'
}

/**
 * Where the snippet came from: "p. 3" for PDF text and notes, "turn 2" for
 * replies, the section heading for report text.
 */
export function contextLocation(context) {
  if (context?.kind === 'reply') return context.turn ? `turn ${context.turn}` : 'reply'
  if (context?.kind === 'report') {
    // Long headings would squeeze out the snippet itself
    const section = String(context.section || '')
    return section.length > MAX_SECTION_CHARS ? `${section.slice(0, MAX_SECTION_CHARS - 1)}…` : section
  }
  return context?.page ? `p. ${context.page}` : ''
}

/** Class that sets --ctx to the kind's colour. */
export function contextClass(context) {
  return `ctx-${KIND_LABELS[context?.kind] ? context.kind : 'text'}`
}

/**
 * Plain text of a selection inside rendered markdown. KaTeX output contains
 * the formula twice (MathML + HTML), so whole formulas are replaced by their
 * TeX source ($...$ / $$...$$, from data-tex) instead of Selection.toString().
 * @param {Range} range
 * @param {Document} doc
 */
export function rangeToText(range, doc = document) {
  const fragment = range.cloneContents()
  const container = doc.createElement('div')
  container.appendChild(fragment)

  // Whole formulas: renderMarkdown stores their source in data-tex
  for (const math of [...container.querySelectorAll('.math-inline[data-tex], .math-block[data-tex]')]) {
    const tex = math.getAttribute('data-tex')
    math.replaceWith(doc.createTextNode(math.classList.contains('math-block') ? `\n$$${tex}$$\n` : `$${tex}$`))
  }
  // Partially selected formulas: keep only the visible HTML rendering
  for (const katex of [...container.querySelectorAll('.katex')]) {
    katex.replaceWith(doc.createTextNode(katex.querySelector('.katex-html')?.textContent || ''))
  }
  // Any MathML left from partial selections would duplicate text
  for (const mathml of [...container.querySelectorAll('.katex-mathml')]) mathml.remove()

  // innerText keeps paragraph/line breaks but needs layout, so measure the
  // container off-screen (jsdom has no innerText: fall back to textContent)
  container.style.cssText = 'position:fixed;left:-99999px;top:0;white-space:normal;'
  doc.body.appendChild(container)
  const text = typeof container.innerText === 'string' ? container.innerText : container.textContent
  container.remove()
  return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}
