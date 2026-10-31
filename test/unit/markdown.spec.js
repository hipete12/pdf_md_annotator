/**
 * Unit tests for Markdown rendering utility
 */

import { renderMarkdown, renderMath, clearMathCache, sanitizeHtml } from '../../src/renderer/utils/markdown'

describe('Markdown Rendering', () => {
  beforeEach(() => {
    clearMathCache()
  })

  describe('Basic Markdown', () => {
    it('should render headers', () => {
      const result = renderMarkdown('# Header 1')
      expect(result).to.include('<h1')
      expect(result).to.include('Header 1')
    })

    it('should render multiple header levels', () => {
      const input = '# H1\n## H2\n### H3'
      const result = renderMarkdown(input)
      expect(result).to.include('<h1')
      expect(result).to.include('<h2')
      expect(result).to.include('<h3')
    })

    it('should render bold text', () => {
      const result = renderMarkdown('**bold text**')
      expect(result).to.include('<strong>')
      expect(result).to.include('bold text')
    })

    it('should render italic text', () => {
      const result = renderMarkdown('*italic text*')
      expect(result).to.include('<em>')
      expect(result).to.include('italic text')
    })

    it('should render bold and italic combined', () => {
      const result = renderMarkdown('***bold and italic***')
      expect(result).to.include('<strong>')
      expect(result).to.include('<em>')
    })

    it('should render unordered lists', () => {
      const input = '- Item 1\n- Item 2\n- Item 3'
      const result = renderMarkdown(input)
      expect(result).to.include('<ul>')
      expect(result).to.include('<li>')
      expect(result).to.include('Item 1')
    })

    it('should render ordered lists', () => {
      const input = '1. First\n2. Second\n3. Third'
      const result = renderMarkdown(input)
      expect(result).to.include('<ol>')
      expect(result).to.include('<li>')
    })

    it('should render links', () => {
      const result = renderMarkdown('[link text](https://example.com)')
      expect(result).to.include('<a')
      expect(result).to.include('href="https://example.com"')
      expect(result).to.include('link text')
    })

    it('should render blockquotes', () => {
      const result = renderMarkdown('> This is a quote')
      expect(result).to.include('<blockquote>')
      expect(result).to.include('This is a quote')
    })

    it('should render inline code', () => {
      const result = renderMarkdown('Use `code` here')
      expect(result).to.include('<code>')
      expect(result).to.include('code')
    })

    it('should render tables', () => {
      const input = '| Header 1 | Header 2 |\n|----------|----------|\n| Cell 1 | Cell 2 |'
      const result = renderMarkdown(input)
      expect(result).to.include('<table>')
      expect(result).to.include('<th>')
      expect(result).to.include('<td>')
    })

    it('should handle underline with HTML', () => {
      const result = renderMarkdown('<u>underlined</u>')
      expect(result).to.include('<u>')
      expect(result).to.include('underlined')
    })
  })

  describe('Code Blocks with Syntax Highlighting', () => {
    it('should render code blocks with language', () => {
      const input = '```javascript\nconst x = 1;\n```'
      const result = renderMarkdown(input)
      expect(result).to.include('<pre')
      expect(result).to.include('language-javascript')
    })

    it('should render code blocks without language', () => {
      const input = '```\nsome code\n```'
      const result = renderMarkdown(input)
      expect(result).to.include('<pre')
    })

    it('should highlight Python code', () => {
      const input = '```python\ndef hello():\n    print("Hello")\n```'
      const result = renderMarkdown(input)
      expect(result).to.include('language-python')
    })

    it('should actually produce Prism token markup', () => {
      for (const lang of ['javascript', 'python', 'php', 'bash']) {
        const result = renderMarkdown('```' + lang + '\nif (x) { return 1 }\n```')
        expect(result, lang).to.include('class="token')
      }
    })

    it('should highlight TypeScript code', () => {
      const input = '```typescript\nconst x: number = 1;\n```'
      const result = renderMarkdown(input)
      expect(result).to.include('language-typescript')
    })
  })

  describe('LaTeX Rendering', () => {
    it('should render inline math', () => {
      const result = renderMarkdown('The equation is $x^2$')
      expect(result).to.include('math-inline')
      expect(result).to.include('katex')
    })

    it('should render display math', () => {
      const result = renderMarkdown('$$\\sum_{i=1}^n i$$')
      expect(result).to.include('math-block')
      expect(result).to.include('katex')
    })

    it('should render fractions', () => {
      const result = renderMarkdown('$\\frac{a}{b}$')
      expect(result).to.include('katex')
    })

    it('should render square roots', () => {
      const result = renderMarkdown('$\\sqrt{x}$')
      expect(result).to.include('katex')
    })

    it('should render Greek letters', () => {
      const result = renderMarkdown('$\\alpha \\beta \\gamma$')
      expect(result).to.include('katex')
    })

    it('should handle custom macros', () => {
      const result = renderMarkdown('$\\R$', {
        latexMacros: { '\\R': '\\mathbb{R}' }
      })
      expect(result).to.include('katex')
    })

    it('should show error for invalid LaTeX', () => {
      const result = renderMarkdown('$\\invalidcommand$')
      // KaTeX (throwOnError: false) renders unknown commands in its error colour
      expect(result).to.include('#cc0000')
    })

    it('should handle multiple math expressions', () => {
      const result = renderMarkdown('$a$ and $b$ and $c$')
      const matches = result.match(/math-inline/g)
      expect(matches).to.have.length(3)
    })

    it('should handle mixed inline and display math', () => {
      const input = 'Inline $x$ and display:\n$$y = mx + b$$'
      const result = renderMarkdown(input)
      expect(result).to.include('math-inline')
      expect(result).to.include('math-block')
    })
  })

  describe('renderMath function', () => {
    it('should render inline math correctly', () => {
      const result = renderMath('x^2', false)
      expect(result).to.include('math-inline')
    })

    it('should render display math correctly', () => {
      const result = renderMath('x^2', true)
      expect(result).to.include('math-block')
    })

    it('should use macros', () => {
      const result = renderMath('\\R', false, { '\\R': '\\mathbb{R}' })
      expect(result).to.include('katex')
    })

    it('should cache results', () => {
      const first = renderMath('x^2', false)
      const second = renderMath('x^2', false)
      expect(first).to.equal(second)
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty input', () => {
      const result = renderMarkdown('')
      expect(result).to.equal('')
    })

    it('should handle null input', () => {
      const result = renderMarkdown(null)
      expect(result).to.equal('')
    })

    it('should handle undefined input', () => {
      const result = renderMarkdown(undefined)
      expect(result).to.equal('')
    })

    it('should handle special characters', () => {
      const result = renderMarkdown('< > & " \'')
      expect(result).to.be.a('string')
    })

    it('should handle very long text', () => {
      const longText = 'a'.repeat(10000)
      const result = renderMarkdown(longText)
      expect(result).to.include('a')
    })

    it('should handle nested formatting', () => {
      const result = renderMarkdown('**bold with *italic* inside**')
      expect(result).to.include('<strong>')
      expect(result).to.include('<em>')
    })

    it('should preserve line breaks', () => {
      const result = renderMarkdown('line 1\nline 2')
      expect(result).to.include('<br')
    })
  })

  describe('Alternative math delimiters', () => {
    it('renders \\(...\\) as inline math', () => {
      const result = renderMarkdown('The value \\(x^2\\) grows')
      expect(result).to.include('math-inline')
      expect(result).to.not.include('\\(')
    })

    it('renders \\[...\\] as display math', () => {
      const result = renderMarkdown('Equation:\n\\[\n\\int_0^1 x\\,dx\n\\]')
      expect(result).to.include('math-block')
    })
  })

  describe('Code is not parsed as math', () => {
    it('leaves $ in inline code alone', () => {
      const result = renderMarkdown('Run `echo $HOME and $PATH` now')
      expect(result).to.not.include('katex')
      expect(result).to.include('$HOME and $PATH')
    })

    it('leaves $ and \\( in fenced code blocks alone', () => {
      const result = renderMarkdown('```bash\necho "$A" "$B"\ngrep "\\(x\\)" f\n```')
      expect(result).to.not.include('katex')
      expect(result).to.include('<pre')
    })

    it('still renders math next to code', () => {
      const result = renderMarkdown('Use `x` where $x^2$')
      expect(result).to.include('math-inline')
      expect(result).to.include('<code>x</code>')
    })
  })

  describe('Sanitization', () => {
    it('strips script tags', () => {
      const result = renderMarkdown('hi <script>window.pwned = 1</script>')
      expect(result).to.not.include('<script')
    })

    it('strips event handler attributes', () => {
      const result = renderMarkdown('<img src="x" onerror="require(\'child_process\')">')
      expect(result).to.not.include('onerror')
    })

    it('strips javascript: links', () => {
      const result = renderMarkdown('[click](javascript:alert(1))')
      expect(result).to.not.include('javascript:')
    })

    it('strips iframes and forms', () => {
      const result = renderMarkdown('<iframe src="https://e.com"></iframe><form><input></form>')
      expect(result).to.not.include('<iframe')
      expect(result).to.not.include('<form')
      expect(result).to.not.include('<input')
    })

    it('opens safe links in a new window', () => {
      const result = renderMarkdown('[site](https://example.com)')
      expect(result).to.include('href="https://example.com"')
      expect(result).to.include('target="_blank"')
      expect(result).to.include('rel="noopener noreferrer"')
    })

    it('keeps KaTeX markup intact', () => {
      const result = renderMarkdown('$\\frac{a}{b} + \\sqrt{x}$')
      expect(result).to.include('katex-html')
      expect(result).to.include('<math')
      expect(result).to.include('frac-line')
    })

    it('keeps syntax highlighting classes', () => {
      const result = renderMarkdown('```js\nconst a = 1\n```')
      expect(result).to.include('class="token keyword"')
    })

    it('sanitizeHtml removes handlers from raw HTML', () => {
      expect(sanitizeHtml('<b onclick="x()">t</b>')).to.equal('<b>t</b>')
    })
  })

  describe('KaTeX trust', () => {
    it('blocks javascript: URLs in \\href', () => {
      const result = renderMarkdown('$\\href{javascript:alert(1)}{x}$')
      // Rejected commands are shown as error text, never as a link
      expect(result).to.not.match(/href="javascript:/)
    })

    it('blocks \\htmlClass and similar HTML extensions', () => {
      const result = renderMarkdown('$\\htmlClass{evil}{x}$')
      expect(result).to.not.include('class="enclosing evil"')
    })

    it('allows https links in \\href', () => {
      const result = renderMarkdown('$\\href{https://example.com}{x}$')
      expect(result).to.include('href="https://example.com"')
    })
  })
})
