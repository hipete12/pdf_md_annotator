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

  it('formats reply contexts in the prompt with their turn', () => {
    expect(formatSelections([{ kind: 'reply', turn: 2, text: 'The model uses attention.' }]))
      .to.equal('<selected_context>\n[turn 2, from your earlier reply]\nThe model uses attention.\n</selected_context>')
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
