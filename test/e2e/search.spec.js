/**
 * E2E tests for Find in the PDF (Ctrl+F): matches across pages, highlights
 * in the text layer and moving between matches.
 */

const { test, expect } = require('@playwright/test')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { launchWithSettings, writeTestPdf } = require('./helpers')

test.describe('Find in the PDF', () => {
  let app
  let window
  let tempDir
  let pdfDir

  const bar = () => window.locator('.pdf-search')
  const input = () => window.locator('.pdf-search-input')
  const count = () => window.locator('.pdf-search-count')
  const hits = (page) => window.locator(`.pdf-page-wrapper[data-page="${page}"] .search-hit`)
  const selected = () => window.locator('.search-hit.selected')

  // The current match is inside the visible part of the viewer
  const selectedInView = async () => {
    const view = await window.locator('.pdf-viewer').boundingBox()
    const hit = await selected().boundingBox()
    return Boolean(hit) && hit.y >= view.y && hit.y + hit.height <= view.y + view.height
  }

  test.beforeEach(async () => {
    pdfDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-annotator-search-'))
    writeTestPdf(path.join(pdfDir, 'doc.pdf'), ['Apple pie and apple juice', 'Nothing to see here', 'Green apple tree'])
    const launched = await launchWithSettings(() => ({}), [path.join(pdfDir, 'doc.pdf')])
    app = launched.app
    window = launched.window
    tempDir = launched.tempDir
    await window.waitForSelector('.pdf-page-wrapper[data-page="1"] .textLayer span')
  })

  test.afterEach(async () => {
    if (app) await app.close()
    fs.rmSync(tempDir, { recursive: true, force: true })
    fs.rmSync(pdfDir, { recursive: true, force: true })
  })

  test('Ctrl+F finds text on every page and moves between matches', async () => {
    await window.keyboard.press('Control+f')
    await expect(bar()).toBeVisible()
    await expect(input()).toBeFocused()

    await window.keyboard.type('APPLE')
    await expect(count()).toHaveText('1 of 3')
    await expect(hits(1)).toHaveText(['Apple', 'apple'])
    await expect(selected()).toHaveText('Apple')
    // The page text itself is unchanged
    await expect(window.locator('.pdf-page-wrapper[data-page="1"] .textLayer')).toContainText('Apple pie and apple juice')

    await window.keyboard.press('Enter')
    await expect(count()).toHaveText('2 of 3')
    await expect(hits(1).nth(1)).toHaveClass(/selected/)

    // The third match is on page 3, off screen: the viewer scrolls to it
    expect(await selectedInView()).toBe(true)
    await window.keyboard.press('Enter')
    await expect(count()).toHaveText('3 of 3')
    await expect(window.locator('.pdf-page-wrapper[data-page="3"] .search-hit.selected')).toHaveText('apple')
    await expect.poll(selectedInView).toBe(true)

    // Wraps around both ways
    await window.keyboard.press('Enter')
    await expect(count()).toHaveText('1 of 3')
    await expect.poll(selectedInView).toBe(true)
    await window.keyboard.press('Shift+Enter')
    await expect(count()).toHaveText('3 of 3')
    // The buttons work too, and keep the cursor in the field
    await window.locator('.pdf-search-btn[aria-label="Previous match"]').click()
    await expect(count()).toHaveText('2 of 3')
    await expect(input()).toBeFocused()

    // F3 also moves on
    await window.keyboard.press('F3')
    await expect(count()).toHaveText('3 of 3')

    // Phrases match across spaces; nothing found says so
    await input().fill('apple   juice')
    await expect(count()).toHaveText('1 of 1')
    await expect(selected()).toHaveText('apple juice')
    await input().fill('zebra')
    await expect(count()).toHaveText('No results')
    await expect(window.locator('.pdf-search-btn[aria-label="Next match"]')).toBeDisabled()
    await expect(window.locator('.search-hit')).toHaveCount(0)

    // Esc closes the bar and removes the highlights
    await input().fill('apple')
    await expect(count()).toHaveText(/of 3/)
    await window.keyboard.press('Escape')
    await expect(bar()).toHaveCount(0)
    await expect(window.locator('.search-hit')).toHaveCount(0)
  })

  test('starts from the selected PDF text, and Edit > Find opens it', async () => {
    // Select "juice" on page 1
    await window.evaluate(() => {
      const span = [...document.querySelectorAll('.pdf-page-wrapper[data-page="1"] .textLayer span')]
        .find(el => el.textContent.includes('juice'))
      const text = span.firstChild
      const start = text.textContent.indexOf('juice')
      const range = document.createRange()
      range.setStart(text, start)
      range.setEnd(text, start + 5)
      window.getSelection().removeAllRanges()
      window.getSelection().addRange(range)
    })
    await window.keyboard.press('Control+f')
    await expect(input()).toHaveValue('juice')
    await expect(count()).toHaveText('1 of 1')
    await window.locator('.pdf-search-btn[aria-label="Close search"]').click()
    await expect(bar()).toHaveCount(0)

    test.skip(process.platform === 'darwin', 'macOS uses the native menu bar')
    const titlebar = window.locator('.titlebar')
    await titlebar.locator('.titlebar-menu-button', { hasText: 'Edit' }).click()
    await expect(titlebar.locator('.titlebar-item', { hasText: 'Find...' })).toContainText('Ctrl+F')
    await titlebar.locator('.titlebar-item', { hasText: 'Find...' }).click()
    await expect(bar()).toBeVisible()
    // The last search is kept, selected so typing replaces it
    await expect(input()).toHaveValue('juice')
    await expect(input()).toBeFocused()
    expect(await input().evaluate(el => [el.selectionStart, el.selectionEnd])).toEqual([0, 5])
  })
})
