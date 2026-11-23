/**
 * E2E tests for pasting images (screenshots) into the chat. The paste is a
 * real paste event carrying a PNG file, as the system clipboard would
 * deliver a screenshot, without touching the user's clipboard.
 */

const { test, expect } = require('@playwright/test')
const path = require('path')
const fs = require('fs')
const { startFakeLlm, launchWithSettings } = require('./helpers')

const VISION_MODEL = { id: 'fake-model', architecture: { input_modalities: ['text', 'image'] } }

test.describe('Images in the chat', () => {
  let app
  let window
  let tempDir
  let fake
  let chats

  const launch = async (llm = {}) => {
    const launched = await launchWithSettings((dir) => {
      chats = path.join(dir, 'chats')
      return {
        llm: { provider: 'custom', baseUrls: { custom: fake.baseUrl }, models: { custom: 'fake-model' }, ...llm },
        chat: { chatsFolder: chats }
      }
    })
    app = launched.app
    window = launched.window
    tempDir = launched.tempDir
    await window.locator('.welcome-card', { hasText: 'New chat' }).click()
    await window.waitForSelector('.chat-panel.standalone')
  }

  // Paste a generated PNG (width × height, one colour) into the message box
  const pasteImage = (width = 300, height = 200, color = '#3b82f6') => window.evaluate(async ({ width, height, color }) => {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = color
    ctx.fillRect(0, 0, width, height)
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
    const data = new DataTransfer()
    data.items.add(new File([blob], 'screenshot.png', { type: 'image/png' }))
    const input = document.querySelector('.chat-input')
    input.focus()
    input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  }, { width, height, color })

  test.beforeEach(async () => {
    fake = await startFakeLlm(() => 'It is a blue rectangle.', { models: [VISION_MODEL] })
  })

  test.afterEach(async () => {
    if (app) await app.close()
    fake?.server.close()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  test('a pasted screenshot is sent with the message, shown in it and saved', async () => {
    await launch()
    await pasteImage()
    await pasteImage(3000, 1500, '#ef4444') // scaled down to 2048 × 1024
    const thumbs = window.locator('.chat-image-thumb')
    await expect(thumbs).toHaveCount(2)
    // Text pastes are unaffected and the box keeps working
    await expect(window.locator('.chat-input')).toHaveValue('')

    // Remove the second one before sending
    await thumbs.nth(1).locator('.chat-image-remove').click()
    await expect(thumbs).toHaveCount(1)

    await window.locator('.chat-input').fill('What is in this screenshot?')
    await window.locator('.chat-input').press('Enter')
    await expect(window.locator('.chat-message-assistant')).toContainText('blue rectangle')
    await expect(thumbs).toHaveCount(0)

    // Sent as an OpenAI-style image part after the text
    const content = fake.chatRequests()[0].messages.at(-1).content
    expect(content[0]).toEqual({ type: 'text', text: 'What is in this screenshot?' })
    expect(content[1].type).toBe('image_url')
    expect(content[1].image_url.url).toMatch(/^data:image\/png;base64,/)
    await expect(window.locator('.chat-tokens')).toContainText('+ 1 img')

    // Shown in the message; click to enlarge, Esc to close
    const shown = window.locator('.chat-message-user .chat-message-image img')
    await expect(shown).toHaveCount(1)
    await shown.click()
    await expect(window.locator('.chat-image-preview img')).toBeVisible()
    await window.keyboard.press('Escape')
    await expect(window.locator('.chat-image-preview')).toHaveCount(0)

    // A follow-up question still sends the earlier image (history)
    await window.locator('.chat-input').fill('What colour is it?')
    await window.locator('.chat-input').press('Enter')
    await expect.poll(() => fake.chatRequests().length).toBe(2)
    const history = fake.chatRequests()[1].messages
    expect(history[1].content[1].type).toBe('image_url')
    expect(history.at(-1).content).toBe('What colour is it?')

    // Saved in the chat file
    const file = path.join(chats, 'untitled1.chat')
    await expect.poll(() => fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes('data:image/png;base64,')).toBe(true)
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
    const attachment = saved.sessions[0].messages[0].attachments[0]
    expect(attachment).toMatchObject({ type: 'image', mime: 'image/png', width: 300, height: 200 })
  })

  test('a text-only model refuses pasted images', async () => {
    await launch({ visionOverrides: { 'fake-model': false } })
    await pasteImage()
    await expect(window.locator('.chat-image-thumb')).toHaveCount(0)
    await expect(window.locator('.chat-notice')).toContainText("can't read images")
  })

  test('large images are scaled down to 2048px', async () => {
    await launch()
    await pasteImage(3000, 1500)
    const size = await window.locator('.chat-image-thumb img').evaluate(img => new Promise(resolve => {
      const probe = new Image()
      probe.onload = () => resolve([probe.naturalWidth, probe.naturalHeight])
      probe.src = img.src
    }))
    expect(size).toEqual([2048, 1024])
  })
})
