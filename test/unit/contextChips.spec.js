/**
 * Unit tests for context chip helpers (labels, colours, reply text extraction)
 */
import { contextKindLabel, contextLocation, contextClass, rangeToText } from '../../src/renderer/utils/contextChips'
import { renderMarkdown } from '../../src/renderer/utils/markdown'
import { formatSelections } from '../../src/renderer/utils/chatPrompt'

describe('context chips', () => {
  it('labels and locates each kind', () => {
    expect(contextKindLabel({ kind: 'text' })).to.equal('Text')
    expect(contextKindLabel({ kind: 'text' }, { pending: true })).to.equal('Selection')
    expect(contextKindLabel({ kind: 'note' }, { pending: true })).to.equal('Note')
    expect(contextKindLabel({ kind: 'reply' })).to.equal('Reply')
    expect(contextLocation({ kind: 'text', page: 3 })).to.equal('p. 3')
    expect(contextLocation({ kind: 'reply', turn: 2 })).to.equal('turn 2')
    expect(contextClass({ kind: 'reply' })).to.equal('ctx-reply')
    expect(contextClass({ kind: 'weird' })).to.equal('ctx-text')
  })

  it('labels report text by its section, shortening long headings', () => {
    expect(contextKindLabel({ kind: 'report' }, { pending: true })).to.equal('Report')
    expect(contextClass({ kind: 'report' })).to.equal('ctx-report')
    expect(contextLocation({ kind: 'report', section: 'Key ideas' })).to.equal('Key ideas')
    expect(contextLocation({ kind: 'report' })).to.equal('')
    const long = contextLocation({ kind: 'report', section: 'A very long section heading that goes on and on' })
    expect(long).to.have.length(32)
    expect(long.endsWith('…')).to.equal(true)
  })

  it('formats report contexts in the prompt with their section', () => {
    expect(formatSelections([{ kind: 'report', section: 'Key ideas', sectionId: 'key-ideas', text: 'Entropy $S$ grows.' }]))
      .to.equal('<selected_context>\n[section "Key ideas", generated document excerpt]\nEntropy $S$ grows.\n</selected_context>')
    expect(formatSelections([{ kind: 'report', text: 'x' }]))
      .to.equal('<selected_context>\n[generated document excerpt]\nx\n</selected_context>')
  })

  it('formats reply contexts in the prompt with their turn', () => {
    expect(formatSelections([{ kind: 'reply', turn: 2, text: 'The model uses attention.' }]))
      .to.equal('<selected_context>\n[turn 2, your earlier reply]\nThe model uses attention.\n</selected_context>')
  })

  describe('rangeToText', () => {
    const doc = () => window.document
    const mount = (markdown) => {
      const el = doc().createElement('div')
      el.innerHTML = renderMarkdown(markdown)
      doc().body.appendChild(el)
      return el
    }
    const selectAll = (el) => {
      const range = doc().createRange()
      range.selectNodeContents(el)
      return range
    }

    it('turns rendered formulas back into TeX instead of duplicated MathML text', () => {
      const el = mount('Energy is $E = mc^2$ here.')
      const text = rangeToText(selectAll(el), doc())
      expect(text).to.equal('Energy is $E = mc^2$ here.')
      el.remove()
    })

    it('keeps display math as $$...$$', () => {
      const el = mount('Formula:\n\n$$\\frac{a}{b}$$')
      expect(rangeToText(selectAll(el), doc())).to.include('$$\\frac{a}{b}$$')
      el.remove()
    })

    it('returns plain text for ordinary markdown', () => {
      const el = mount('Some **bold** text')
      expect(rangeToText(selectAll(el), doc())).to.equal('Some bold text')
      el.remove()
    })
  })
})
