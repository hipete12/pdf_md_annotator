/**
 * Unit tests for growing the chat message box with its text
 */
import { fitTextarea } from '../../src/renderer/utils/fitTextarea'

// A textarea whose sizes are measured with the given rounding (CSS zoom can
// make the browser round a 25.5px line down), capped by max-height
function fakeTextarea({ lines, lineHeight = 19.5, padding = 6, maxHeight = 200, round = Math.round }) {
  const el = { style: { height: '30px', overflowY: '' }, rows: 1 }
  Object.defineProperty(el, 'clientHeight', { get: () => round(Math.min(el.rows * lineHeight + padding, maxHeight)) })
  Object.defineProperty(el, 'scrollHeight', { get: () => Math.max(round(lines * lineHeight + padding), el.clientHeight) })
  return el
}

describe('fitTextarea', () => {
  it('keeps an empty or one-line box at one row with no scrollbar, whatever the rounding', () => {
    for (const round of [Math.round, Math.floor, Math.ceil]) {
      const el = fakeTextarea({ lines: 1, round })
      fitTextarea(el)
      expect(el.rows).to.equal(1)
      expect(el.style.overflowY).to.equal('hidden')
      expect(el.style.height).to.equal('') // sized by rows, not a rounded pixel height
    }
  })

  it('grows a row per line of text', () => {
    const el = fakeTextarea({ lines: 3 })
    fitTextarea(el)
    expect(el.rows).to.equal(3)
    expect(el.style.overflowY).to.equal('hidden')
  })

  it('stops at max-height and then scrolls', () => {
    const el = fakeTextarea({ lines: 30 })
    fitTextarea(el)
    expect(el.rows).to.be.lessThan(12)
    expect(el.style.overflowY).to.equal('auto')
  })

  it('shrinks back when text is removed', () => {
    const el = fakeTextarea({ lines: 5 })
    fitTextarea(el)
    expect(el.rows).to.equal(5)
    const short = fakeTextarea({ lines: 1 })
    short.rows = 5
    fitTextarea(short)
    expect(short.rows).to.equal(1)
  })

  it('ignores a missing element', () => {
    expect(() => fitTextarea(null)).to.not.throw()
  })
})
