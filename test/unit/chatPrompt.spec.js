/**
 * Unit tests for the chat prompt builder
 */
import {
  estimateTokens,
  fillTemplate,
  formatSelections,
  buildUserContent,
  formatDocument,
  describePageRanges,
  completedExchanges,
  buildRequestMessages,
  sessionTitleFrom
} from '../../src/renderer/utils/chatPrompt'
import { DEFAULT_SYSTEM_TEMPLATE, DEFAULT_USER_TEMPLATE } from '../../src/common/llm'

describe('chatPrompt', () => {
  it('estimates tokens at ~4 chars each', () => {
    expect(estimateTokens('')).to.equal(0)
    expect(estimateTokens('abcdefgh')).to.equal(2)
    expect(estimateTokens('abcdefghi')).to.equal(3)
  })

  it('fills placeholders and leaves unknown ones', () => {
    expect(fillTemplate('{{a}} and {{ b }} and {{c}}', { a: 1, b: 'two' })).to.equal('1 and two and {{c}}')
    expect(fillTemplate('{{a}}', { a: null })).to.equal('')
  })

  describe('selections', () => {
    it('is empty without contexts', () => {
      expect(formatSelections([])).to.equal('')
      expect(formatSelections(undefined)).to.equal('')
    })

    it('labels text and notes with pages', () => {
      const out = formatSelections([
        { kind: 'text', page: 3, text: '  Attention is all you need ' },
        { kind: 'note', page: 5, text: 'Check eq. 2' }
      ])
      expect(out).to.equal(
        '<selected_context>\n[p. 3, selected text]\nAttention is all you need\n\n[p. 5, user note]\nCheck eq. 2\n</selected_context>'
      )
    })
  })

  describe('buildUserContent', () => {
    it('collapses the gap left by empty selections', () => {
      expect(buildUserContent(DEFAULT_USER_TEMPLATE, { input: 'What is this?', contexts: [] })).to.equal('What is this?')
    })

    it('puts selections before the input', () => {
      const out = buildUserContent(DEFAULT_USER_TEMPLATE, { input: 'Explain', contexts: [{ kind: 'text', page: 1, text: 'x' }] })
      expect(out).to.equal('<selected_context>\n[p. 1, selected text]\nx\n</selected_context>\nExplain')
    })
  })

  describe('formatDocument', () => {
    const pages = Array.from({ length: 10 }, (_, i) => ({ page: i + 1, text: `content of page ${i + 1} `.repeat(20) }))

    it('includes everything when within budget', () => {
      const out = formatDocument(pages, { budgetTokens: 100000 })
      expect(out.truncated).to.equal(false)
      expect(out.includedPages).to.deep.equal([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
      expect(out.text.startsWith('[Page 1]\ncontent of page 1')).to.equal(true)
      expect(out.text).to.include('[Page 10]')
    })

    it('marks pages without text', () => {
      const out = formatDocument([{ page: 1, text: '  ' }], { budgetTokens: 1000 })
      expect(out.text).to.equal('[Page 1]\n(no extractable text on this page)')
    })

    it('keeps the pages nearest the focus when over budget, in document order', () => {
      const perPage = estimateTokens(`[Page 1]\n${pages[0].text.trim()}`) + 1
      const out = formatDocument(pages, { budgetTokens: perPage * 3 + 5, focusPages: [7] })
      expect(out.truncated).to.equal(true)
      expect(out.includedPages).to.deep.equal([6, 7, 8])
      expect(out.text).to.match(/^\[Note: the document has 10 pages/)
      expect(out.text).to.include('Only pages 6–8 are included')
      expect(out.text.indexOf('[Page 6]')).to.be.lessThan(out.text.indexOf('[Page 8]'))
    })

    it('starts from the first page without focus, and always includes at least one page', () => {
      expect(formatDocument(pages, { budgetTokens: 1 }).includedPages).to.deep.equal([1])
    })

    it('handles several focus pages', () => {
      const perPage = estimateTokens(`[Page 1]\n${pages[0].text.trim()}`) + 1
      const out = formatDocument(pages, { budgetTokens: perPage * 2 + 5, focusPages: [2, 9] })
      expect(out.includedPages).to.deep.equal([2, 9])
    })
  })

  it('describes page ranges', () => {
    expect(describePageRanges([10, 1, 2, 3, 7, 9])).to.equal('1–3, 7, 9–10')
    expect(describePageRanges([4])).to.equal('4')
  })

  it('drops failed exchanges so roles alternate', () => {
    const history = [
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'q2' },
      { role: 'assistant', content: '', error: { message: 'boom' } },
      { role: 'user', content: 'q3' },
      { role: 'assistant', content: 'partial', error: { code: 'aborted' } },
      { role: 'user', content: 'q4' }
    ]
    // q3's stopped-but-partial answer is kept; q2 (failed) and q4 (no reply) are not
    expect(completedExchanges(history).map(m => m.content)).to.deep.equal(['q1', 'a1', 'q3', 'partial'])
  })

  describe('buildRequestMessages', () => {
    const base = {
      systemTemplate: DEFAULT_SYSTEM_TEMPLATE,
      userTemplate: DEFAULT_USER_TEMPLATE,
      title: 'paper.pdf',
      documentText: '[Page 1]\nHello world'
    }

    it('builds system, history and new user turn', () => {
      const messages = buildRequestMessages({
        ...base,
        history: [
          { role: 'user', content: 'What?', contexts: [{ kind: 'text', page: 1, text: 'Hello' }] },
          { role: 'assistant', content: 'A greeting.' }
        ],
        userMessage: { input: 'And then?', contexts: [] }
      })
      expect(messages.map(m => m.role)).to.deep.equal(['system', 'user', 'assistant', 'user'])
      expect(messages[0].content).to.include('the PDF document "paper.pdf"')
      expect(messages[0].content).to.include('<document>\n[Page 1]\nHello world\n</document>')
      // earlier turns keep the context they were sent with
      expect(messages[1].content).to.equal('<selected_context>\n[p. 1, selected text]\nHello\n</selected_context>\nWhat?')
      expect(messages[3].content).to.equal('And then?')
    })

    it('keeps the system prompt identical across turns (prompt caching)', () => {
      const first = buildRequestMessages({ ...base, userMessage: { input: 'q1', contexts: [] } })
      const second = buildRequestMessages({
        ...base,
        history: [{ role: 'user', content: 'q1' }, { role: 'assistant', content: 'a1' }],
        userMessage: { input: 'q2', contexts: [] }
      })
      expect(second[0]).to.deep.equal(first[0])
      expect(second[1]).to.deep.equal(first[1])
    })

    it('attaches images as content parts on the new message only', () => {
      const messages = buildRequestMessages({
        ...base,
        userMessage: { input: 'Look', contexts: [] },
        images: [{ dataUrl: 'data:image/jpeg;base64,AAA' }]
      })
      expect(messages[1].content).to.deep.equal([
        { type: 'text', text: 'Look' },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAA' } }
      ])
    })
  })

  it('derives session titles', () => {
    expect(sessionTitleFrom('  What   does\nthis mean? ')).to.equal('What does this mean?')
    expect(sessionTitleFrom('')).to.equal('New chat')
    const long = sessionTitleFrom('a'.repeat(100))
    expect(long).to.have.length(60)
    expect(long.endsWith('…')).to.equal(true)
  })
})
