/**
 * Quarto discovery and rendering (src/main/quarto.js). Uses a fake quarto
 * script for the edge cases, and the real Quarto for one render when it is
 * installed.
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
const { candidatePaths, findQuarto, renderDocument } = require('../../src/main/quarto')

const isWindows = process.platform === 'win32'

// Fake quarto: prints a version; "render" writes document.html, or fails when
// the source contains FAIL, or hangs when it contains HANG
function writeFakeQuarto(dir) {
  const bin = path.join(dir, 'quarto')
  fs.writeFileSync(bin, `#!/bin/sh
if [ "$1" = "--version" ]; then echo "9.9.9"; exit 0; fi
if grep -q FAIL document.qmd; then echo "ModuleNotFoundError: No module named 'jupyter'" >&2; exit 1; fi
if grep -q HANG document.qmd; then sleep 30; fi
echo "<html><body>$* $(cat document.qmd)</body></html>" > document.html
echo "Output created: document.html"
`, { mode: 0o755 })
  return bin
}

describe('Quarto', function () {
  if (isWindows) return
  let dir
  let fakeQuarto
  let cacheDir

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quarto-test-'))
    fakeQuarto = writeFakeQuarto(dir)
    cacheDir = path.join(dir, 'cache')
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('looks in the configured path, PATH, ~/.local/bin and ~/opt installs', () => {
    const home = path.join(dir, 'home')
    fs.mkdirSync(path.join(home, 'opt', 'quarto-1.10.0'), { recursive: true })
    fs.mkdirSync(path.join(home, 'opt', 'quarto-1.11.9'), { recursive: true })
    const list = candidatePaths('/custom/quarto', { platform: 'linux', home, envPath: '/usr/bin:/bin' })
    expect(list[0]).to.equal('/custom/quarto')
    expect(list).to.include('/usr/bin/quarto')
    expect(list).to.include(path.join(home, '.local', 'bin', 'quarto'))
    const optEntries = list.filter(p => p.includes(`${path.sep}opt${path.sep}quarto-`))
    expect(optEntries[0]).to.contain('quarto-1.11.9')
  })

  it('finds a working binary and reports its version', async () => {
    const found = await findQuarto(fakeQuarto, { refresh: true, envPath: '', home: dir })
    expect(found).to.deep.equal({ path: fakeQuarto, version: '9.9.9' })
    const missing = await findQuarto(path.join(dir, 'nope'), { refresh: true, envPath: '', home: path.join(dir, 'empty') })
    expect(missing === null || missing.path !== path.join(dir, 'nope')).to.equal(true)
  })

  it('renders without executing by default and caches by content', async () => {
    const first = await renderDocument({ quartoPath: fakeQuarto, version: '9.9.9', content: '# Hello', run: false, cacheDir })
    expect(first.cached).to.equal(false)
    expect(first.html).to.contain('render document.qmd --to html --no-execute -M embed-resources:true')
    expect(first.html).to.contain('# Hello')
    const again = await renderDocument({ quartoPath: fakeQuarto, version: '9.9.9', content: '# Hello', run: false, cacheDir })
    expect(again.cached).to.equal(true)
    const executed = await renderDocument({ quartoPath: fakeQuarto, version: '9.9.9', content: '# Hello', run: true, cacheDir })
    expect(executed.cached).to.equal(false)
    expect(executed.html).to.contain('--execute')
    // Only the HTML is kept in the cache folder
    const [sub] = fs.readdirSync(cacheDir)
    expect(fs.readdirSync(path.join(cacheDir, sub))).to.deep.equal(['document.html'])
  })

  it('reports failures with the log tail and a Jupyter hint', async () => {
    let error
    try {
      await renderDocument({ quartoPath: fakeQuarto, content: 'FAIL', run: true, cacheDir })
    } catch (e) { error = e }
    expect(error.code).to.equal('render')
    expect(error.message).to.contain('needs Jupyter')
    expect(error.log).to.contain('No module named')
    expect(fs.readdirSync(cacheDir)).to.deep.equal([])
  })

  it('can be cancelled and times out', async () => {
    const controller = new AbortController()
    const pending = renderDocument({ quartoPath: fakeQuarto, content: 'HANG', run: false, cacheDir, signal: controller.signal })
    setTimeout(() => controller.abort(), 100)
    let error
    try { await pending } catch (e) { error = e }
    expect(error.code).to.equal('cancelled')

    let timeout
    try {
      await renderDocument({ quartoPath: fakeQuarto, content: 'HANG again', run: false, cacheDir, timeoutMs: 200 })
    } catch (e) { timeout = e }
    expect(timeout.code).to.equal('timeout')
  })

  it('renders a real document with the installed Quarto', async function () {
    const real = await findQuarto('', { refresh: true })
    if (!real) return this.skip()
    this.timeout(120000)
    const content = '---\ntitle: "Smoke"\n---\n\nInline $x^2$.\n\n```{mermaid}\nflowchart LR\n  A --> B\n```\n\n```{python}\nprint(1)\n```\n'
    const result = await renderDocument({ quartoPath: real.path, version: real.version, content, run: false, cacheDir })
    expect(result.html).to.contain('<title>Smoke</title>')
    expect(result.html).to.contain('sourceCode')
    expect(result.html).to.match(/print/)
  })
})

describe('prepareForViewer', () => {
  const { prepareForViewer } = require('../../src/main/quarto')

  it('inlines data: scripts and stylesheets and adds the bridge first in <head>', () => {
    const js = Buffer.from('console.log("</script>")').toString('base64')
    const html = `<html><head><meta charset="utf-8"><script src="data:application/javascript;base64,${js}"></script>` +
      `<link href="data:text/css,body%7Bcolor%3Ared%7D" rel="stylesheet" id="quarto-text-highlighting-styles">` +
      '<link href="data:image/png;base64,AAAA" rel="icon"></head><body><img src="data:image/png;base64,AAAA"></body></html>'
    const out = prepareForViewer(html)
    expect(out).to.contain('<script>console.log("<\\/script>")</script>')
    expect(out).to.contain('<style id="quarto-text-highlighting-styles">body{color:red}</style>')
    expect(out).to.contain('<link href="data:image/png;base64,AAAA" rel="icon">')
    expect(out).to.contain('<img src="data:image/png;base64,AAAA">')
    expect(out.indexOf('memoryStorage')).to.be.above(out.indexOf('<head>'))
    expect(out.indexOf('memoryStorage')).to.be.below(out.indexOf('<meta charset'))
    expect(out).to.not.contain('src="data:application/javascript')
  })

  describe('selection bridge', () => {
    const { JSDOM } = require('jsdom')
    // Pandoc's MathML keeps the TeX source in an annotation
    const math = (tex, block) => `<math display="${block ? 'block' : 'inline'}"><semantics><mi>S</mi>` +
      `<annotation encoding="application/x-tex">${tex}</annotation></semantics></math>`
    const load = (body) => {
      const html = prepareForViewer(`<html><head></head><body>${body}</body></html>`)
      const dom = new JSDOM(html, { runScripts: 'dangerously' })
      const posted = []
      dom.window.addEventListener('message', (event) => posted.push(event.data))
      return { dom, posted }
    }
    const select = (dom, node) => {
      const range = dom.window.document.createRange()
      range.selectNodeContents(node)
      const selection = dom.window.getSelection()
      selection.removeAllRanges()
      selection.addRange(range)
      dom.window.document.dispatchEvent(new dom.window.Event('mouseup'))
    }
    const settle = () => new Promise(resolve => setTimeout(resolve, 20))

    it('posts selected text with formulas as TeX and the section heading', async () => {
      const { dom, posted } = load(
        '<section id="key-ideas" class="level2"><h2>Key ideas <a class="anchorjs-link">#</a></h2>' +
        `<p id="p">Entropy ${math('S = k \\ln W')} measures disorder.</p>${math('\\Delta S \\ge 0', true)}</section>`
      )
      select(dom, dom.window.document.getElementById('key-ideas'))
      await settle()
      const message = posted.find(m => m.type === 'selection')
      expect(message).to.include({ source: 'pdfmd-viewer', sectionId: 'key-ideas', section: 'Key ideas' })
      expect(message.text).to.contain('Entropy $S = k \\ln W$ measures disorder.')
      expect(message.text).to.contain('$$\\Delta S \\ge 0$$')
      expect(message.text).to.not.contain('#')
    })

    it('ignores empty selections and works outside sections', async () => {
      const { dom, posted } = load('<p id="p">Plain text</p><p id="e"></p>')
      select(dom, dom.window.document.getElementById('e'))
      await settle()
      expect(posted.filter(m => m.type === 'selection')).to.have.length(0)
      select(dom, dom.window.document.getElementById('p'))
      await settle()
      expect(posted.find(m => m.type === 'selection')).to.include({ text: 'Plain text', sectionId: '', section: '' })
    })
  })
})
