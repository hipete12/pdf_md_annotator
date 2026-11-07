/**
 * Pure helpers for chat commands and the generated Quarto document:
 *   /generate [steer]  create or update "<chat>.qmd" from the conversation
 *   /open [run]        show the rendered document (run = execute code cells)
 *   /close             hide the document
 */

export const DEFAULT_GENERATE_TEMPLATE = `Turn the tutoring conversation below into a study document in Quarto (.qmd) format, titled after its main topic.

- Start with a YAML header: title, format: html with toc: true and theme: cosmo.
- Organise the key concepts logically, not in conversation order.
- Give extra attention to points of confusion: questions the user returned to, follow-ups, and misunderstandings that were corrected. State the misconception, then the correct explanation.
- Include worked examples and the key formulas (LaTeX: $...$ inline, $$...$$ display).
- Use visualizations where you see fit. Prefer Mermaid ({mermaid} blocks) or Graphviz ({dot} blocks) diagrams and tables, which render without running code. Use short, self-contained Python code cells (numpy/matplotlib) for plots only when a plot clearly helps; code is not run by default, so the text must make sense without its output.
- End with "Key takeaways" and a few self-check questions.
- Stay faithful to the conversation; mark anything you add beyond it.

If a current document exists, update it instead of starting over: keep what is still correct, add material from the newer parts of the conversation, and follow the steering instruction.

<current_document>
{{current_document}}
</current_document>

<conversation>
{{conversation}}
</conversation>

<steer>
{{steer}}
</steer>

Return only the contents of the .qmd file, starting with its YAML header.`

const COMMANDS = {
  generate: { usage: '/generate [instructions]', description: 'Create or update the Quarto document from this conversation' },
  open: { usage: '/open', description: 'Show the rendered document (code cells are not run)' },
  'open run': { usage: '/open run', description: 'Render the document and run its code cells' },
  close: { usage: '/close', description: 'Hide the document' }
}

/** Commands for the composer's suggestion list */
export function listCommands(prefix = '') {
  const typed = String(prefix).trim().toLowerCase().replace(/^\//, '')
  return Object.entries(COMMANDS)
    .filter(([name]) => name.startsWith(typed) || (typed.startsWith(name) && name !== 'open'))
    .map(([name, info]) => ({ name, ...info }))
}

/**
 * Recognise a slash command. Only known commands count, so a message such as
 * "/usr/bin is a folder" is sent as text.
 * @returns {{ name: 'generate'|'open'|'close', steer?: string, run?: boolean } | null}
 */
export function parseCommand(text) {
  const value = String(text || '').trim()
  const match = value.match(/^\/(generate|open|close)(?=\s|$)([\s\S]*)$/i)
  if (!match) return null
  const name = match[1].toLowerCase()
  const rest = match[2].trim()
  if (name === 'generate') return { name, steer: rest }
  if (name === 'open') {
    if (!rest) return { name, run: false }
    if (/^run$/i.test(rest)) return { name, run: true }
    return null
  }
  return rest ? null : { name }
}

const KIND_LABELS = { text: 'PDF excerpt', note: 'note', reply: 'quoted reply' }

/**
 * The conversation as plain text for the document prompt.
 * @param {Array} messages - visible path (user/assistant), oldest first
 * @param {object} [options]
 * @param {string|null} [options.coveredMessageId] - last message included in the
 *   previous document; a marker is placed after it
 */
export function formatTranscript(messages, { coveredMessageId = null } = {}) {
  const parts = []
  for (const message of messages || []) {
    if (message.role !== 'user' && message.role !== 'assistant') continue
    if (message.role === 'assistant' && (!message.content || (message.error && message.error.code !== 'aborted'))) continue
    if (message.role === 'user') {
      const contexts = (message.contexts || [])
        .map(c => `> [${KIND_LABELS[c.kind] || c.kind}] ${String(c.text || '').trim().replace(/\n/g, '\n> ')}`)
        .join('\n')
      parts.push(`User:\n${contexts ? `${contexts}\n` : ''}${message.content}`.trim())
    } else {
      parts.push(`Assistant:\n${message.content.trim()}`)
    }
    if (coveredMessageId && message.id === coveredMessageId) {
      parts.push('--- Everything below is new since the document was last generated ---')
    }
  }
  // A marker at the very end means nothing is new
  if (parts.at(-1)?.startsWith('--- Everything below')) parts.pop()
  return parts.join('\n\n')
}

function fill(template, vars) {
  return String(template || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name] ?? '') : match)
}

/**
 * Messages for the document request.
 */
export function buildGenerateMessages({ template, title, transcript, currentDocument, steer }) {
  return [
    {
      role: 'system',
      content: 'You write clear, well-structured study documents in Quarto Markdown (.qmd).'
    },
    {
      role: 'user',
      content: fill(template, {
        title,
        conversation: transcript,
        current_document: currentDocument?.trim() ? currentDocument.trim() : '(none yet)',
        steer: steer?.trim() ? steer.trim() : '(none)'
      }).trim()
    }
  ]
}

/**
 * Pull the .qmd source out of a model reply: removes an outer code fence and
 * any chatter before the YAML header. Adds a header when there is none.
 * @param {string} text
 * @param {string} title - used when a header has to be added
 * @returns {string}
 */
export function extractQmd(text, title = 'Notes') {
  let body = String(text || '').replace(/\r\n/g, '\n').trim()
  if (!body) throw new Error('The model returned an empty document')

  // Whole reply wrapped in ```qmd ... ``` (or ````markdown ... ````)
  const fence = body.match(/^(`{3,}|~{3,})[\w{}.-]*\n([\s\S]*)\n\1\s*$/)
  if (fence) body = fence[2].trim()

  // Chatter before the header ("Here is the document:")
  if (!body.startsWith('---\n')) {
    const header = body.search(/(^|\n)---\n(?=[\s\S]*?\n---\n)/)
    if (header !== -1 && /\btitle\s*:/.test(body.slice(header, header + 400))) {
      body = body.slice(header).replace(/^\n/, '')
    }
  }
  if (!body.startsWith('---\n')) {
    body = `---\ntitle: "${String(title).replace(/"/g, "'")}"\nformat:\n  html:\n    toc: true\n---\n\n${body}`
  }
  return `${body.trim()}\n`
}

/** Languages of executable code cells (```{python} ...), in order of appearance */
export function codeCellLanguages(qmd) {
  const languages = []
  for (const match of String(qmd || '').matchAll(/^```+\s*\{(\w+)[^}]*\}/gm)) {
    const lang = match[1].toLowerCase()
    if (['mermaid', 'dot', 'ojs'].includes(lang)) continue
    languages.push(lang)
  }
  return languages
}
