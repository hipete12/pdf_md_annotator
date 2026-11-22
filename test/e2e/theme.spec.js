/**
 * E2E tests for the dark theme, its "Invert PDF colors" option and the
 * in-app title bar (Windows/Linux).
 */

const { test, expect } = require('@playwright/test')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { launchWithSettings, writeTestPdf } = require('./helpers')

// Page palette ink colours (main.css): normal page and inverted page
const PAGE_INK = 'rgb(30, 41, 59)'
const INVERTED_PAGE_INK = 'rgb(230, 230, 230)'

test.describe('Dark theme and Invert PDF colors', () => {
  let app
  let window
  let tempDir
  let pdfDir

  const canvasFilter = () => window.locator('.pdf-page-wrapper[data-page="1"] .pdf-canvas')
    .evaluate(el => getComputedStyle(el).filter)

  const launch = async (ui = {}) => {
    ;({ app, window, tempDir } = await launchWithSettings(() => ({ ui }), [path.join(pdfDir, 'doc.pdf')]))
    await window.waitForSelector('.pdf-page-wrapper[data-page="1"] .textLayer span')
  }

  // Double-click the page to add a note, type into it and leave it
  const addNote = async (text) => {
    const page = await window.locator('.pdf-page-wrapper[data-page="1"]').boundingBox()
    await window.mouse.dblclick(page.x + 80, page.y + 200)
    const note = window.locator('.annotation-box').last()
    await note.waitFor()
    await note.locator('.markdown-preview').click()
    await window.locator('.markdown-textarea').waitFor()
    await window.keyboard.type(text)
    await window.keyboard.press('Escape')
    await window.mouse.click(page.x + 400, page.y + 600)
    return note.locator('.markdown-preview')
  }

  test.beforeEach(() => {
    pdfDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-annotator-theme-'))
    writeTestPdf(path.join(pdfDir, 'doc.pdf'), ['Dark mode page'])
  })

  test.afterEach(async () => {
    if (app) await app.close()
    fs.rmSync(tempDir, { recursive: true, force: true })
    fs.rmSync(pdfDir, { recursive: true, force: true })
  })

  test('toggle sits under Theme, needs the dark theme, and inverts only the PDF', async () => {
    await launch()
    await window.keyboard.press('Control+,')
    const toggle = window.locator('#ui-invert-pdf')
    const theme = window.locator('.settings-row', { hasText: 'Theme' }).locator('select')

    // Placed directly below the Theme row
    const nextLabel = await theme.evaluate(el => el.closest('.settings-row').nextElementSibling.textContent.trim())
    expect(nextLabel).toBe('Invert PDF colors')

    // Light theme: option unavailable, nothing inverted
    await expect(toggle).toBeDisabled()
    await expect(window.locator('#ui-invert-pdf-hint')).toHaveText('Available with the dark theme.')
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

  test('dark theme reaches the page background, text, form fields and font pickers', async () => {
    await launch({ theme: 'dark' })
    expect(await window.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(15, 23, 42)')
    expect(await window.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('dark')

    await window.keyboard.press('Control+,')
    // The modal title used to inherit the light theme's dark text
    expect(await window.locator('.modal-title').evaluate(el => getComputedStyle(el).color)).toBe('rgb(241, 245, 249)')
    const fontSize = window.locator('.settings-row', { hasText: 'Default Font Size' }).locator('input')
    expect(await fontSize.evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(11, 18, 34)')
    expect(await fontSize.evaluate(el => getComputedStyle(el).color)).toBe('rgb(241, 245, 249)')
    // The default font now matches an option instead of showing blank
    const fontFamily = window.locator('.settings-row', { hasText: 'Default Font Family' }).locator('select')
    expect(await fontFamily.evaluate(el => el.selectedIndex)).toBe(0)
  })

  test('notes take the page colours: dark ink on a normal page, light ink on an inverted page', async () => {
    await launch({ theme: 'dark' })
    const note = await addNote('Readable note')
    expect(await note.evaluate(el => getComputedStyle(el).color)).toBe(PAGE_INK)

    await window.keyboard.press('Control+,')
    await window.locator('#ui-invert-pdf').check()
    await window.locator('.modal-close').click()
    expect(await note.evaluate(el => getComputedStyle(el).color)).toBe(INVERTED_PAGE_INK)
    expect(await window.locator('.pdf-page-wrapper[data-page="1"]').evaluate(el => getComputedStyle(el).backgroundColor))
      .toBe('rgb(26, 26, 26)')
  })

  test('the in-app title bar shows the file name and runs menu items', async () => {
    test.skip(process.platform === 'darwin', 'macOS keeps the native title bar')
    await launch({ theme: 'dark' })
    const titlebar = window.locator('.titlebar')
    await expect(titlebar.locator('.titlebar-title')).toHaveText('PDF Annotator - doc.pdf')
    await expect(titlebar.locator('.titlebar-menu-button')).toHaveText(['File', 'Edit', 'View', 'Settings', 'Help'])
    expect(await titlebar.evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(11, 17, 32)')

    // View > Toggle Sidebar goes through the real application menu item
    await titlebar.locator('.titlebar-menu-button', { hasText: 'View' }).click()
    await expect(titlebar.locator('.titlebar-item', { hasText: 'Toggle Sidebar' })).toContainText('Ctrl+\\')
    await titlebar.locator('.titlebar-item', { hasText: 'Toggle Sidebar' }).click()
    await expect(window.locator('.sidebar.collapsed')).toHaveCount(1)
    await expect(titlebar.locator('.titlebar-dropdown')).toHaveCount(0)

    // Keyboard: F10 opens the first menu, Escape closes it
    await window.keyboard.press('F10')
    await expect(titlebar.locator('.titlebar-menu-button.open')).toHaveText('File')
    await window.keyboard.press('Escape')
    await expect(titlebar.locator('.titlebar-dropdown')).toHaveCount(0)

    // Maximize button follows the window state
    await titlebar.locator('.titlebar-control[aria-label="Maximize"]').click()
    await expect(titlebar.locator('.titlebar-control[aria-label="Restore"]')).toBeVisible()
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized())).toBe(true)
  })
})
