/**
 * E2E tests for standalone chats (no PDF).
 */
const { test, expect } = require('@playwright/test')
const path = require('path')
const fs = require('fs')
const { startFakeLlm, launchWithSettings } = require('./helpers')

test.describe('Standalone chat', () => {
  let app
  let window
  let tempDir
  let chats
  let fake

  test.beforeEach(async () => {
    fake = await startFakeLlm(() => 'Entropy measures **disorder**. $S = k \\ln W$')
    ;({ app, window, tempDir } = await launchWithSettings((dir) => {
      chats = path.join(dir, 'chats')
      return {
        llm: { provider: 'custom', baseUrls: { custom: fake.baseUrl }, models: { custom: 'fake-model' } },
        chat: { chatsFolder: chats }
      }
    }))
  })

  test.afterEach(async () => {
    if (app) await app.close()
    fake?.server.close()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  test('starts from the welcome screen, chats full window and saves untitled1.chat', async () => {
    await window.getByRole('button', { name: /New chat/ }).click()
    const panel = window.locator('.chat-panel.standalone')
    await expect(panel).toBeVisible()
    await expect(panel.locator('.chat-title')).toHaveText('untitled1')
    // Nothing is written before the first message
    expect(fs.existsSync(path.join(chats, 'untitled1.chat'))).toBe(false)

    await window.fill('.chat-input', 'Explain entropy')
    await window.press('.chat-input', 'Enter')
    await expect(window.locator('.chat-message-assistant .chat-answer strong')).toHaveText('disorder')

    const request = fake.chatRequests()[0]
    expect(request.messages[0].content).toContain('patient tutor')
    expect(request.messages[0].content).not.toContain('<document>')

    const file = path.join(chats, 'untitled1.chat')
    await expect.poll(() => fs.existsSync(file)).toBe(true)
    await window.screenshot({ path: path.join(__dirname, '../../test-results/standalone-chat.png') })

    // A second new chat skips the taken name
    await window.click('.chat-icon-btn[title^="New chat"]')
    await expect(panel.locator('.chat-title')).toHaveText('untitled2')

    // Close returns to the welcome screen, which lists the saved chat
    await window.click('.chat-icon-btn[title="Close chat"]')
    await expect(window.locator('.welcome-recent-item', { hasText: 'untitled1.chat' })).toBeVisible()
    await window.screenshot({ path: path.join(__dirname, '../../test-results/welcome.png') })
    await window.locator('.welcome-recent-item', { hasText: 'untitled1.chat' }).click()
    await expect(window.locator('.chat-bubble')).toHaveText('Explain entropy')
  })

  test('Save As copies the chat and its document, warning when a target exists', async () => {
    await window.getByRole('button', { name: /New chat/ }).click()
    await window.fill('.chat-input', 'Explain entropy')
    await window.press('.chat-input', 'Enter')
    await expect(window.locator('.chat-message-assistant .chat-answer')).toBeVisible()
    await expect.poll(() => fs.existsSync(path.join(chats, 'untitled1.chat'))).toBe(true)
    fs.writeFileSync(path.join(chats, 'untitled1.qmd'), '---\ntitle: Entropy\n---\n')
    // Only the document name is taken at the target
    fs.writeFileSync(path.join(chats, 'physics.qmd'), 'old document')

    const target = path.join(chats, 'physics')
    await app.evaluate(({ dialog }, target) => {
      global.__boxes = []
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: target })
      dialog.showMessageBox = async (win, options) => { global.__boxes.push(options.message); return { response: 0 } }
    }, target)
    await window.click('.chat-icon-btn[title^="Save chat as"]')

    await expect(window.locator('.chat-title')).toHaveText('physics')
    const boxes = await app.evaluate(() => global.__boxes)
    expect(boxes).toEqual(['"physics.qmd" already exists. Replace?'])
    expect(JSON.parse(fs.readFileSync(path.join(chats, 'physics.chat'), 'utf8')).sessions[0].messages).toHaveLength(2)
    expect(fs.readFileSync(path.join(chats, 'physics.qmd'), 'utf8')).toContain('title: Entropy')
    // The original stays (copy) and the replaced document was kept
    expect(fs.existsSync(path.join(chats, 'untitled1.chat'))).toBe(true)
    expect(fs.readdirSync(path.join(chats, '.versions', 'physics'))).toHaveLength(1)
    await expect(window.locator('.chat-bubble')).toHaveText('Explain entropy')
  })
})
