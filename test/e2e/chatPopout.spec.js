/**
 * E2E tests for popping the PDF chat out into its own window: one live
 * conversation in either window, docking back, window position memory.
 */

const { test, expect } = require('@playwright/test')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { launchWithSettings, startFakeLlm, writeTestPdf } = require('./helpers')

test.describe('Chat in its own window', () => {
  let app
  let window
  let tempDir
  let profile
  let pdfDir
  let fake

  const launch = async (chat = {}) => {
    const launched = await launchWithSettings(() => ({
      llm: { provider: 'custom', baseUrls: { custom: fake.baseUrl }, models: { custom: 'fake-model' } },
      chat: { panelVisible: true, ...chat }
    }), [path.join(pdfDir, 'doc.pdf')])
    app = launched.app
    window = launched.window
    tempDir = launched.tempDir
    profile = launched.profile
    await window.waitForSelector('.pdf-page-wrapper[data-page="1"] .textLayer span')
  }

  const popOut = async () => {
    const [popup] = await Promise.all([
      app.waitForEvent('window'),
      window.locator('.chat-icon-btn[aria-label="Pop out"]').click()
    ])
    await popup.waitForSelector('.chat-panel.popout')
    return popup
  }

  // The pop-out's BrowserWindow, driven from the main process
  const popoutWindow = (fn, arg) => app.evaluate(({ BrowserWindow }, [source, value]) => {
    const win = BrowserWindow.getAllWindows().find(w => w.getTitle().startsWith('Chat'))
    // eslint-disable-next-line no-new-func
    return win ? new Function('win', 'value', source)(win, value) : null
  }, [fn, arg])

  const savedSettings = () => JSON.parse(fs.readFileSync(path.join(profile, 'pdf-annotator-settings.json'), 'utf8'))

  test.beforeEach(async () => {
    fake = await startFakeLlm(() => 'Popped out reply.')
    pdfDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-annotator-popout-'))
    writeTestPdf(path.join(pdfDir, 'doc.pdf'), ['Apple pie and apple juice'])
  })

  test.afterEach(async () => {
    if (app) await app.close()
    fake?.server.close()
    fs.rmSync(tempDir, { recursive: true, force: true })
    fs.rmSync(pdfDir, { recursive: true, force: true })
  })

  test('the chat moves to its own window and keeps working with the PDF', async () => {
    await launch()
    await window.fill('.chat-input', 'Before popping out')
    await window.press('.chat-input', 'Enter')
    await expect(window.locator('.chat-message-assistant')).toHaveCount(1)

    const popup = await popOut()
    await expect(window.locator('.chat-panel')).toHaveCount(0)
    expect(await popup.title()).toBe('Chat - doc.pdf')
    // Same conversation, still live
    await expect(popup.locator('.chat-message-assistant')).toHaveCount(1)
    await popup.fill('.chat-input', 'From the new window')
    await popup.press('.chat-input', 'Enter')
    await expect(popup.locator('.chat-message-assistant')).toHaveCount(2)
    expect(fake.chatRequests()[1].messages.at(-1).content).toBe('From the new window')

    // Selecting PDF text in the main window offers it in the chat window
    await window.evaluate(() => {
      const span = document.querySelector('.pdf-page-wrapper[data-page="1"] .textLayer span')
      const range = document.createRange()
      range.setStart(span.firstChild, 0)
      range.setEnd(span.firstChild, 9)
      getSelection().removeAllRanges()
      getSelection().addRange(range)
    })
    await expect(popup.locator('.chat-chip.pending')).toContainText('Apple pie')

    // Popups inside the window close on outside clicks there
    await popup.locator('.model-picker-button').click()
    await expect(popup.locator('.model-picker-menu')).toBeVisible()
    await popup.locator('.chat-messages').click({ position: { x: 10, y: 10 } })
    await expect(popup.locator('.model-picker-menu')).toHaveCount(0)

    // App shortcuts work there: chat zoom, and Find opens in the main window
    await popup.locator('.chat-input').focus()
    await popup.keyboard.press('Control+=')
    expect(await popup.locator('.chat-composer').evaluate(el => getComputedStyle(el).zoom)).toBe('1.1')
    await expect(window.locator('.zoom-display')).toHaveText('100%')
    await popup.keyboard.press('Control+f')
    await expect(window.locator('.pdf-search')).toBeVisible()

    // The theme follows the app
    expect(await popup.evaluate(() => document.documentElement.classList.contains('theme-dark'))).toBe(false)
    await window.keyboard.press('Control+,')
    await window.locator('.settings-row', { hasText: 'Theme' }).locator('select').selectOption('dark')
    await expect.poll(() => popup.evaluate(() => document.documentElement.classList.contains('theme-dark'))).toBe(true)
  })

  test('docking, closing the window and hiding the chat bring it back', async () => {
    await launch()
    let popup = await popOut()
    await popup.locator('.chat-icon-btn[aria-label="Dock"]').click({ noWaitAfter: true }).catch(() => {})
    await expect(window.locator('.chat-panel')).toHaveCount(1)
    await expect.poll(() => popup.isClosed()).toBe(true)

    // Closed by the window manager (e.g. Alt+F4): back in the main window
    popup = await popOut()
    await popoutWindow('win.close()')
    await expect(window.locator('.chat-panel')).toHaveCount(1)
    await expect(window.locator('.chat-panel.popout')).toHaveCount(0)

    // Hiding the chat closes its window; showing it again docks it
    popup = await popOut()
    await window.locator('.toolbar-button', { hasText: 'Chat' }).click()
    await expect.poll(() => popup.isClosed()).toBe(true)
    await expect(window.locator('.chat-panel')).toHaveCount(0)
    await window.locator('.toolbar-button', { hasText: 'Chat' }).click()
    await expect(window.locator('.chat-panel')).toHaveCount(1)
  })

  test('the window reopens where it was left, and on screen', async () => {
    await launch()
    await popOut()
    const work = await app.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea)
    const wanted = { x: work.x + 50, y: work.y + 60, width: 500, height: 640 }
    await popoutWindow('win.setBounds(value)', wanted)
    await expect.poll(() => savedSettings().chat?.popoutBounds?.width).toBe(500)
    const saved = savedSettings().chat.popoutBounds

    await popoutWindow('win.close()')
    await expect(window.locator('.chat-panel')).toHaveCount(1)
    await popOut()
    const reopened = await popoutWindow('return win.getBounds()')
    expect(reopened.width).toBe(saved.width)
    expect(reopened.height).toBe(saved.height)
    expect(Math.abs(reopened.x - saved.x)).toBeLessThan(40)
    expect(Math.abs(reopened.y - saved.y)).toBeLessThan(60)
    await app.close()
    app = null
    fs.rmSync(tempDir, { recursive: true, force: true })

    // A position on a monitor that is gone is replaced by a centered window
    await launch({ popoutBounds: { x: -20000, y: -20000, width: 480, height: 600 } })
    await popOut()
    const centered = await popoutWindow('return win.getBounds()')
    const display = await app.evaluate(({ screen }, b) => screen.getDisplayMatching(b).workArea, centered)
    expect(centered.x).toBeGreaterThanOrEqual(display.x)
    expect(centered.x + centered.width).toBeLessThanOrEqual(display.x + display.width)
  })
})
