/**
 * E2E tests for the dark theme and its "Invert PDF colors" option.
 */

const { test, expect } = require('@playwright/test')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { launchWithSettings, writeTestPdf } = require('./helpers')

test.describe('Invert PDF colors', () => {
  let app
  let window
  let tempDir

  const canvasFilter = () => window.locator('.pdf-page-wrapper[data-page="1"] .pdf-canvas')
    .evaluate(el => getComputedStyle(el).filter)

  let pdfDir

  test.beforeEach(async () => {
    pdfDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-annotator-theme-'))
    const pdfPath = path.join(pdfDir, 'doc.pdf')
    writeTestPdf(pdfPath, ['Dark mode page'])
    ;({ app, window, tempDir } = await launchWithSettings(() => ({}), [pdfPath]))
    await window.waitForSelector('.pdf-page-wrapper[data-page="1"] .textLayer span')
  })

  test.afterEach(async () => {
    if (app) await app.close()
    fs.rmSync(tempDir, { recursive: true, force: true })
    fs.rmSync(pdfDir, { recursive: true, force: true })
  })

  test('toggle sits under Theme, needs the dark theme, and inverts only the PDF', async () => {
    await window.keyboard.press('Control+,')
    const toggle = window.locator('#ui-invert-pdf')
    const theme = window.locator('.settings-row', { hasText: 'Theme' }).locator('select')

    // Placed directly below the Theme row
    const nextLabel = await theme.evaluate(el => el.closest('.settings-row').nextElementSibling.textContent.trim())
    expect(nextLabel).toBe('Invert PDF colors')

    // Light theme: option unavailable, nothing inverted
    await expect(toggle).toBeDisabled()
    expect(await canvasFilter()).toBe('none')

    // Dark theme alone does not invert the PDF
    await theme.selectOption('dark')
    await expect(toggle).toBeEnabled()
    await expect(toggle).not.toBeChecked()
    expect(await canvasFilter()).toBe('none')

    // Dark theme + invert: page canvas and thumbnail are filtered
    await toggle.check()
    expect(await canvasFilter()).toContain('invert')
    const thumbFilter = await window.locator('.page-thumbnail canvas').first()
      .evaluate(el => getComputedStyle(el).filter)
    expect(thumbFilter).toContain('invert')

    // Back to light: inversion stops even though the option stays checked
    await theme.selectOption('light')
    await expect(toggle).toBeChecked()
    expect(await canvasFilter()).toBe('none')
  })
})
