/**
 * E2E tests for zooming the chat: Ctrl +/-/0 zoom the chat while it has
 * focus and the PDF otherwise.
 */

const { test, expect } = require('@playwright/test')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { launchWithSettings, startFakeLlm, writeTestPdf } = require('./helpers')

test.describe('Chat zoom', () => {
  let app
  let window
  let tempDir
  let profile
  let pdfDir
  let fake

  const pdfZoom = () => window.locator('.zoom-display')
  const chatZoom = (selector = '.chat-composer') => window.locator(selector).evaluate(el => getComputedStyle(el).zoom)
  const indicator = () => window.locator('.chat-zoom-indicator')
  const savedChatZoom = () => JSON.parse(fs.readFileSync(path.join(profile, 'pdf-annotator-settings.json'), 'utf8')).chat?.zoom

  // Real key presses, sent through Electron's input pipeline like a user's
  // keyboard (unlike Playwright's, these also reach the menu accelerators)
  const pressNative = (keyCode) => app.evaluate(({ BrowserWindow }, key) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents
    contents.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers: ['control'] })
    contents.sendInputEvent({ type: 'char', keyCode: key, modifiers: ['control'] })
    contents.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers: ['control'] })
  }, keyCode)

  const launch = async (settings, args = []) => {
    const launched = await launchWithSettings(() => ({
      llm: { provider: 'custom', baseUrls: { custom: fake.baseUrl }, models: { custom: 'fake-model' } },
      ...settings
    }), args)
    app = launched.app
    window = launched.window
    tempDir = launched.tempDir
    profile = launched.profile
  }

  test.beforeEach(async () => {
    fake = await startFakeLlm(() => 'A reply.')
    pdfDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-annotator-chat-zoom-'))
    writeTestPdf(path.join(pdfDir, 'doc.pdf'), ['Zoom page'])
  })

  test.afterEach(async () => {
    if (app) await app.close()
    fake?.server.close()
    fs.rmSync(tempDir, { recursive: true, force: true })
    fs.rmSync(pdfDir, { recursive: true, force: true })
  })

  test('Ctrl +/-/0 zoom the chat while typing in it and the PDF otherwise', async () => {
    await launch({ chat: { panelVisible: true } }, [path.join(pdfDir, 'doc.pdf')])
    await window.waitForSelector('.pdf-page-wrapper[data-page="1"] .textLayer span')
    await window.fill('.chat-input', 'Hello')
    await window.press('.chat-input', 'Enter')
    await expect(window.locator('.chat-message-assistant')).toContainText('A reply.')
    await expect(pdfZoom()).toHaveText('100%')

    // Typing in the chat: the chat zooms, the PDF does not
    await window.locator('.chat-input').focus()
    await window.keyboard.press('Control+=')
    await expect(indicator()).toHaveText('Chat zoom 110%')
    expect(await chatZoom()).toBe('1.1')
    expect(await chatZoom('.chat-messages-inner')).toBe('1.1')
    await window.keyboard.press('Control+=')
    expect(await chatZoom()).toBe('1.25')
    await window.keyboard.press('Control+-')
    expect(await chatZoom()).toBe('1.1')
    await expect(pdfZoom()).toHaveText('100%')
    // The header keeps its size
    expect(await chatZoom('.chat-header')).toBe('1')
    await expect.poll(savedChatZoom).toBe(1.1)

    // Ctrl+0 resets the chat only
    await window.keyboard.press('Control+0')
    expect(await chatZoom()).toBe('1')
    await expect(indicator()).toHaveText('Chat zoom 100%')
    await expect(indicator()).toHaveCount(0)

    // Focus back on the PDF: the same keys zoom the PDF
    const page = await window.locator('.pdf-page-wrapper[data-page="1"]').boundingBox()
    await window.mouse.click(page.x + 200, page.y + 300)
    await window.keyboard.press('Control+=')
    await expect(pdfZoom()).toHaveText('125%')
    expect(await chatZoom()).toBe('1')

    // The toolbar buttons always zoom the PDF
    await window.locator('.chat-input').focus()
    await window.locator('.toolbar-button[title="Zoom out"]').click()
    await expect(pdfZoom()).toHaveText('100%')
    expect(await chatZoom()).toBe('1')
  })

  test('a real Ctrl+= zooms one step; the View menu follows the focus too', async () => {
    await launch({ chat: { panelVisible: true } }, [path.join(pdfDir, 'doc.pdf')])
    await window.waitForSelector('.pdf-page-wrapper[data-page="1"] .textLayer span')
    await window.locator('.chat-input').focus()

    // One step, not two: the page handles the key, so the menu accelerator
    // must not zoom again
    await pressNative('=')
    await expect(indicator()).toHaveText('Chat zoom 110%')
    await window.waitForTimeout(300)
    expect(await chatZoom()).toBe('1.1')
    await expect(pdfZoom()).toHaveText('100%')

    test.skip(process.platform === 'darwin', 'macOS uses the native menu bar')
    // View > Zoom In from the in-app title bar keeps the focus in the chat
    const titlebar = window.locator('.titlebar')
    await titlebar.locator('.titlebar-menu-button', { hasText: 'View' }).click()
    await titlebar.locator('.titlebar-item', { hasText: 'Zoom In' }).click()
    await expect.poll(() => chatZoom()).toBe('1.25')
    await expect(pdfZoom()).toHaveText('100%')
  })

  test('a standalone chat always zooms the chat and keeps the zoom', async () => {
    await launch({ chat: { zoom: 1.5 } })
    await window.locator('.welcome-card', { hasText: 'New chat' }).click()
    await window.waitForSelector('.chat-panel.standalone')
    expect(await chatZoom()).toBe('1.5')

    // Even with nothing focused there is no PDF to zoom
    await window.evaluate(() => document.activeElement?.blur())
    await window.keyboard.press('Control+-')
    expect(await chatZoom()).toBe('1.25')
  })
})
