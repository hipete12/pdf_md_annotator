/**
 * Builds OpenAI-format chat requests from the prompt templates, the document
 * text and the session history. Pure functions: no store or DOM access.
 *
 * Request layout (stable prefix first so provider prompt caching works):
 *   system:    systemTemplate with {{title}} and {{document}}
 *   user/assistant pairs from the session history, each user turn rebuilt
 *   from userTemplate with the contexts that were attached to it
 *   user:      the new message
 */

// Rough token estimate (~4 characters per token for English text)
export function estimateTokens(text) {
  return Math.ceil(String(text || '').length / 4)
}

/**
 * Replace {{name}} placeholders. Unknown placeholders are left untouched.
 */
export function fillTemplate(template, vars) {
  return String(template || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name] ?? '') : match
  )
}

// Explained to the model in the default system prompt (DEFAULT_SYSTEM_TEMPLATE)
const CONTEXT_KIND_LABELS = { text: 'PDF excerpt', note: "user's note", reply: 'your earlier reply', report: 'generated document excerpt' }

/**
 * Format attached contexts for {{selections}}; empty string when none.
 * @param {Array<{kind: string, page: number, text: string}>} contexts
 */
export function formatSelections(contexts) {
  if (!contexts || contexts.length === 0) return ''
  const entries = contexts.map(c => {
    const label = CONTEXT_KIND_LABELS[c.kind] || c.kind
    const where = c.kind === 'reply'
      ? (c.turn ? `turn ${c.turn}, ` : '')
      : c.kind === 'report'
        ? (c.section ? `section "${c.section}", ` : '')
        : (c.page ? `p. ${c.page}, ` : '')
    return `[${where}${label}]\n${String(c.text || '').trim()}`
  })
  return `<selected_context>\n${entries.join('\n\n')}\n</selected_context>`
}

/**
 * Build the text of one user turn.
 */
export function buildUserContent(userTemplate, { input, contexts }) {
  const text = fillTemplate(userTemplate, {
    selections: formatSelections(contexts),
    input: input || ''
  })
  // An empty {{selections}} leaves blank lines behind; collapse them
  return text.replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * Select which pages' text to send.
 * @param {Array<{page: number, text: string}>} pages - in display order; page is the 1-based display number
 * @param {object} options
 * @param {number} options.budgetTokens - maximum estimated tokens for the page text
 * @param {number[]} [options.focusPages] - display numbers to prioritise (attached context, current page)
 * @returns {{ text: string, truncated: boolean, includedPages: number[], totalPages: number, estimatedTokens: number }}
 */
export function formatDocument(pages, { budgetTokens, focusPages = [] }) {
  const blocks = pages.map(p => ({
    page: p.page,
    block: `[Page ${p.page}]\n${String(p.text || '').trim() || '(no extractable text on this page)'}`
  }))
  const totalTokens = blocks.reduce((sum, b) => sum + estimateTokens(b.block) + 1, 0)

  if (totalTokens <= budgetTokens) {
    const text = blocks.map(b => b.block).join('\n\n')
    return {
      text,
      truncated: false,
      includedPages: blocks.map(b => b.page),
      totalPages: blocks.length,
      estimatedTokens: estimateTokens(text)
    }
  }

  // Too long: take pages closest to the focus pages first (the first page
  // when there is no focus), until the budget is used up.
  const focus = focusPages.length ? focusPages : [blocks[0]?.page ?? 1]
  const distance = (page) => Math.min(...focus.map(f => Math.abs(f - page)))
  const ranked = [...blocks].sort((a, b) => distance(a.page) - distance(b.page) || a.page - b.page)

  const chosen = new Set()
  let used = 0
  for (const b of ranked) {
    const cost = estimateTokens(b.block) + 1
    if (used + cost > budgetTokens && chosen.size > 0) continue
    chosen.add(b.page)
    used += cost
  }

  const included = blocks.filter(b => chosen.has(b.page))
  const note = `[Note: the document has ${blocks.length} pages but is too long to include in full. ` +
    `Only pages ${describePageRanges(included.map(b => b.page))} are included. ` +
    'If the answer needs other pages, say so and suggest attaching text from them.]'
  const text = [note, ...included.map(b => b.block)].join('\n\n')
  return {
    text,
    truncated: true,
    includedPages: included.map(b => b.page),
    totalPages: blocks.length,
    estimatedTokens: estimateTokens(text)
  }
}

/**
 * [1,2,3,7,9,10] -> "1–3, 7, 9–10"
 */
export function describePageRanges(pages) {
  const sorted = [...new Set(pages)].sort((a, b) => a - b)
  const ranges = []
  for (const page of sorted) {
    const last = ranges[ranges.length - 1]
    if (last && page === last[1] + 1) last[1] = page
    else ranges.push([page, page])
  }
  return ranges.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join(', ')
}

/**
 * Keep only complete user/assistant exchanges from the history: failed or
 * empty assistant replies are dropped together with the user turn they
 * answered, so roles always alternate. Replies the user stopped part-way are
 * kept, since the user has seen (and may refer to) that text.
 */
export function completedExchanges(messages) {
  const result = []
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]
    if (message.role !== 'user') continue
    const reply = messages[i + 1]
    const usable = reply && reply.role === 'assistant' && reply.content &&
      (!reply.error || reply.error.code === 'aborted')
    if (usable) {
      result.push(message, reply)
      i++
    }
  }
  return result
}

/**
 * Build the messages array for a chat completion request.
 * @param {object} params
 * @param {string} params.systemTemplate
 * @param {string} params.userTemplate
 * @param {string} params.title - document title
 * @param {string} params.documentText - output of formatDocument().text
 * @param {Array} params.history - previous session messages
 * @param {{input: string, contexts: Array}} params.userMessage - the new message
 * @param {Array<{dataUrl: string}>} [params.images] - page images for the new message
 * @returns {Array<{role: string, content: string|Array}>}
 */
export function buildRequestMessages({ systemTemplate, userTemplate, title, documentText, history = [], userMessage, images = [], includeAttachments = true }) {
  const messages = [{
    role: 'system',
    content: fillTemplate(systemTemplate, { title, document: documentText }).trim()
  }]

  // Images pasted into a message ride along with it in later turns too;
  // models that cannot see images get the text only
  const attached = (message) => (includeAttachments ? imageUrlsOf(message.attachments) : [])

  for (const message of completedExchanges(history)) {
    messages.push(message.role === 'user'
      ? { role: 'user', content: withImages(buildUserContent(userTemplate, { input: message.content, contexts: message.contexts }), attached(message)) }
      : { role: 'assistant', content: message.content })
  }

  const text = buildUserContent(userTemplate, { input: userMessage.input, contexts: userMessage.contexts })
  messages.push({
    role: 'user',
    // Pasted images first (what the user is asking about), then page images
    content: withImages(text, [...attached(userMessage), ...images.map(img => img.dataUrl)])
  })
  return messages
}

function imageUrlsOf(attachments) {
  return (Array.isArray(attachments) ? attachments : [])
    .filter(a => a && a.type === 'image' && typeof a.dataUrl === 'string')
    .map(a => a.dataUrl)
}

function withImages(text, urls) {
  return urls.length
    ? [{ type: 'text', text }, ...urls.map(url => ({ type: 'image_url', image_url: { url } }))]
    : text
}

/** Text of a request message (string content, or the text parts of a multi-part one). */
export function messageText(message) {
  const content = message?.content
  if (typeof content === 'string') return content
  return Array.isArray(content) ? content.filter(p => p.type === 'text').map(p => p.text).join('\n') : ''
}

/** Number of images in request messages. */
export function countImages(messages) {
  return messages.reduce((sum, m) => sum + (Array.isArray(m.content) ? m.content.filter(p => p.type === 'image_url').length : 0), 0)
}

/**
 * Title for a new session from its first message.
 */
export function sessionTitleFrom(text, maxLength = 60) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim()
  if (!clean) return 'New chat'
  return clean.length > maxLength ? `${clean.slice(0, maxLength - 1).trimEnd()}…` : clean
}
