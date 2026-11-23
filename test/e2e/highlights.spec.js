/**
 * E2E tests for text highlights: highlighting selected PDF text, changing
 * the colour, removing, undo, Ctrl+Shift+H and saving to the .pdfmark.
 */

const { test, expect } = require('@playwright/test')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { launchWithSettings, writeTestPdf } = require('./helpers')

const GREEN = 'rgb(74, 222, 128)'
const BLUE = 'rgb(96, 165, 250)'

test.describe('Text highlights', () => {
  let app
  let window
  let tempDir
  let pdfDir

  const menu = () => window.locator('.highlight-menu')
  const highlights = () => window.locator('.pdf-page-wrapper[data-page="1"] .pdf-highlight')
  const swatch = (name) => menu().locator(`.highlight-swatch[aria-label="${name}"]`)

  const launch = async () => {
    const launched = await launchWithSettings(() => ({}), [path.join(pdfDir, 'doc.pdf')])
    app = launched.app
    window = launched.window
    tempDir = launched.tempDir
    await window.waitForSelector('.pdf-page-wrapper[data-page="1"] .textLayer span')
  }

  // Select a phrase of page 1 like a mouse drag ending on it; returns the
  // selection's box
  const selectText = (phrase) => window.evaluate((wanted) => {
    const span = [...document.querySelectorAll('.pdf-page-wrapper[data-page="1"] .textLayer span')]
      .find(el => el.textContent.includes(wanted))
    const text = span.firstChild
    const start = text.textContent.indexOf(wanted)
    const range = document.createRange()
    range.setStart(text, start)
    range.setEnd(text, start + wanted.length)
    window.getSelection().removeAllRanges()
    window.getSelection().addRange(range)
    const box = range.getBoundingClientRect()
    span.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, clientX: box.right, clientY: box.bottom }))
    return { x: box.x, y: box.y, width: box.width, height: box.height }
  }, phrase)

  const clickCenter = async (locator) => {
    const box = await locator.boundingBox()
    await window.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  }

  test.beforeEach(async () => {
    pdfDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-annotator-highlight-'))
    writeTestPdf(path.join(pdfDir, 'doc.pdf'), ['Apple pie and apple juice'])
    await launch()
  })

  test.afterEach(async () => {
    if (app) await app.close()
    fs.rmSync(tempDir, { recursive: true, force: true })
    fs.rmSync(pdfDir, { recursive: true, force: true })
  })

  test('highlight selected text, change its colour, remove it and undo', async () => {
    const selection = await selectText('apple juice')
    await expect(menu()).toBeVisible()
    await expect(menu().locator('.highlight-menu-main')).toHaveText('Highlight')
    await expect(menu().locator('.highlight-menu-remove')).toHaveCount(0)
    // Just below the selected words
    const menuBox = await menu().boundingBox()
    expect(menuBox.y - (selection.y + selection.height)).toBeGreaterThanOrEqual(0)
    expect(menuBox.y - (selection.y + selection.height)).toBeLessThan(20)

    await swatch('Green').click()
    await expect(menu()).toHaveCount(0)
    await expect(highlights()).toHaveCount(1)
    expect(await highlights().evaluate(el => getComputedStyle(el).backgroundColor)).toBe(GREEN)
    expect(await window.evaluate(() => window.getSelection().isCollapsed)).toBe(true)
    // The highlight covers the selected words
    const box = await highlights().boundingBox()
    expect(Math.abs(box.x - selection.x)).toBeLessThan(2)
    expect(Math.abs(box.width - selection.width)).toBeLessThan(3)

    // It scales with the zoom
    await window.locator('.toolbar-button[title="Zoom in"]').click()
    await expect.poll(async () => (await highlights().boundingBox()).width).toBeGreaterThan(box.width * 1.2)

    // Clicking it offers other colours and Remove
    await clickCenter(highlights())
    await expect(menu()).toBeVisible()
    await expect(menu().locator('.highlight-menu-main')).toHaveCount(0)
    await expect(swatch('Green')).toHaveClass(/current/)
    await swatch('Blue').click()
    expect(await highlights().evaluate(el => getComputedStyle(el).backgroundColor)).toBe(BLUE)

    await clickCenter(highlights())
    await menu().locator('.highlight-menu-remove').click()
    await expect(highlights()).toHaveCount(0)

    // Undo brings it back (blue), undo again turns it green
    await window.keyboard.press('Control+z')
    await expect(highlights()).toHaveCount(1)
    expect(await highlights().evaluate(el => getComputedStyle(el).backgroundColor)).toBe(BLUE)
    await window.keyboard.press('Control+z')
    expect(await highlights().evaluate(el => getComputedStyle(el).backgroundColor)).toBe(GREEN)

    // Esc closes the menu
    await clickCenter(highlights())
    await expect(menu()).toBeVisible()
    await window.keyboard.press('Escape')
    await expect(menu()).toHaveCount(0)
  })

  test('Ctrl+Shift+H toggles the highlight; highlights are saved and reload', async () => {
    await selectText('Apple pie')
    await window.keyboard.press('Control+Shift+H')
    await expect(highlights()).toHaveCount(1)
    // The default colour is yellow
    expect(await highlights().evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(250, 204, 21)')

    // Selecting inside it offers Remove; the shortcut removes it
    await selectText('pie')
    await expect(menu().locator('.highlight-menu-remove')).toBeVisible()
    await window.keyboard.press('Control+Shift+H')
    await expect(highlights()).toHaveCount(0)

    // Extending: highlighting across an existing highlight merges them
    await selectText('Apple')
    await window.keyboard.press('Control+Shift+H')
    await selectText('Apple pie and')
    await swatch('Pink').click()
    await expect(highlights()).toHaveCount(1)

    await window.keyboard.press('Control+s')
    const pdfmark = path.join(pdfDir, 'doc.pdfmark')
    await expect.poll(() => fs.existsSync(pdfmark)).toBe(true)
    const saved = JSON.parse(fs.readFileSync(pdfmark, 'utf8'))
    expect(saved.highlights['1']).toHaveLength(1)
    expect(saved.highlights['1'][0]).toMatchObject({ color: '#f472b6', text: 'Apple pie and' })

    // Reopen: the highlight is drawn again, and pink is now the default
    await app.close()
    fs.rmSync(tempDir, { recursive: true, force: true })
    await launch()
    await expect(highlights()).toHaveCount(1)
    expect(await highlights().evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(244, 114, 182)')
  })
})
