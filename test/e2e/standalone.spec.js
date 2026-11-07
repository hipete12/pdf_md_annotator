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

  test('a reply can search the web and shows the steps and sources', async () => {
    const http = require('http')
    const tavily = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ results: [{ title: 'Second law of thermodynamics', url: 'https://example.org/second-law', content: 'Entropy never decreases.' }] }))
    })
    await new Promise(resolve => tavily.listen(0, '127.0.0.1', resolve))
    await app.close()
    fake.server.close()
    fake = await startFakeLlm((body, i) => (i === 0
      ? { content: 'Let me check.', toolCalls: [{ id: 'c1', name: 'web_search', arguments: { query: 'second law entropy' } }] }
      : 'It never decreases in an isolated system ([source](https://example.org/second-law)).'))
    process.env.PDF_ANNOTATOR_TAVILY_URL = `http://127.0.0.1:${tavily.address().port}`
    try {
      ;({ app, window, tempDir } = await launchWithSettings((dir) => {
        chats = path.join(dir, 'chats')
        return {
          llm: { provider: 'custom', baseUrls: { custom: fake.baseUrl }, models: { custom: 'fake-model' } },
          chat: { chatsFolder: chats }
        }
      }))
      const stored = await window.evaluate(() => require('electron').ipcRenderer.invoke('llm:set-key', { providerId: 'tavily', apiKey: 'tvly-test' }))
      expect(stored.success).toBe(true)

      await window.getByRole('button', { name: /New chat/ }).click()
      await expect(window.locator('.chat-web-toggle.on')).toBeVisible()
      await window.fill('.chat-input', 'Can entropy decrease?')
      await window.press('.chat-input', 'Enter')

      await expect(window.locator('.chat-answer')).toContainText('never decreases in an isolated system')
      await expect(window.locator('.chat-answer')).not.toContainText('Let me check')
      const steps = window.locator('.tool-steps')
      await expect(steps.locator('summary')).toHaveText('Used the web · 1 search')
      await steps.locator('summary').click()
      await expect(steps.locator('a', { hasText: 'Second law of thermodynamics' })).toBeVisible()
      await window.screenshot({ path: path.join(__dirname, '../../test-results/web-tools.png') })

      const second = fake.chatRequests()[1]
      expect(second.messages.at(-1).role).toBe('tool')
      expect(second.messages.at(-1).content).toContain('Entropy never decreases.')
    } finally {
      delete process.env.PDF_ANNOTATOR_TAVILY_URL
      tavily.close()
    }
  })

  test('/generate writes untitled1.qmd from the conversation', async () => {
    await app.close()
    fake.server.close()
    const qmd = '---\ntitle: "Entropy"\nformat:\n  html:\n    toc: true\n---\n\n## Key ideas\n\nEntropy measures disorder.\n'
    fake = await startFakeLlm((body, i) => (i === 0 ? 'Entropy measures **disorder**.' : '```qmd\n' + qmd + '```'))
    ;({ app, window, tempDir } = await launchWithSettings((dir) => {
      chats = path.join(dir, 'chats')
      return {
        llm: { provider: 'custom', baseUrls: { custom: fake.baseUrl }, models: { custom: 'fake-model' } },
        chat: { chatsFolder: chats },
        tools: { webStandalone: false }
      }
    }))
    await window.getByRole('button', { name: /New chat/ }).click()
    await window.fill('.chat-input', 'Explain entropy')
    await window.press('.chat-input', 'Enter')
    await expect(window.locator('.chat-message-assistant .chat-answer')).toBeVisible()
    await expect(window.locator('.chat-send.stop')).toHaveCount(0)

    // Typing "/" lists the commands; Enter completes the highlighted one
    await window.fill('.chat-input', '/ge')
    await expect(window.locator('.chat-commands li')).toHaveCount(1)
    await window.screenshot({ path: path.join(__dirname, '../../test-results/commands.png') })
    await window.press('.chat-input', 'Enter')
    await expect(window.locator('.chat-input')).toHaveValue('/generate ')
    await window.type('.chat-input', 'focus on examples')
    await window.press('.chat-input', 'Enter')

    await expect(window.locator('.doc-event.done')).toContainText('Document updated')
    await expect(window.locator('.doc-event .doc-event-steer')).toHaveText('/generate focus on examples')
    const docPath = path.join(chats, 'untitled1.qmd')
    expect(fs.readFileSync(docPath, 'utf8')).toBe(qmd)
    // The command was not sent as a chat message
    await expect(window.locator('.chat-bubble')).toHaveCount(1)
    const request = fake.chatRequests()[1]
    expect(request.messages[1].content).toContain('Assistant:\nEntropy measures **disorder**.')
    expect(request.tools).toBeUndefined()
    await window.screenshot({ path: path.join(__dirname, '../../test-results/generate.png') })
  })

  test('/open shows the rendered document next to the chat; /open run asks first', async () => {
    test.setTimeout(180000)
    const { findQuarto } = require('../../src/main/quarto')
    test.skip(!(await findQuarto('', { refresh: true })), 'Quarto is not installed')
    await app.close()
    fake.server.close()
    const qmd = [
      '---', 'title: "Entropy notes"', 'format:', '  html:', '    toc: true', '---', '',
      '## Key ideas', '', 'Entropy $S = k \\ln W$ measures [disorder](https://example.org/entropy).', '',
      '```{mermaid}', 'flowchart LR', '  A[Order] --> B[Disorder]', '```', '',
      '```{python}', 'print(1 + 1)', '```', ''
    ].join('\n')
    fake = await startFakeLlm((body, i) => (i === 0 ? 'Entropy measures disorder.' : qmd))
    ;({ app, window, tempDir } = await launchWithSettings((dir) => {
      chats = path.join(dir, 'chats')
      return {
        llm: { provider: 'custom', baseUrls: { custom: fake.baseUrl }, models: { custom: 'fake-model' } },
        chat: { chatsFolder: chats },
        tools: { webStandalone: false }
      }
    }))
    await window.getByRole('button', { name: /New chat/ }).click()
    await window.fill('.chat-input', '/open')
    await window.press('.chat-input', 'Enter')
    await expect(window.locator('.doc-message')).toContainText('No document yet')

    await window.fill('.chat-input', 'Explain entropy')
    await window.press('.chat-input', 'Enter')
    await expect(window.locator('.chat-send.stop')).toHaveCount(0)
    await window.fill('.chat-input', '/generate')
    await window.press('.chat-input', 'Enter')
    await expect(window.locator('.doc-event.done')).toBeVisible()

    // The open viewer re-renders after /generate
    const frame = window.frameLocator('.doc-frame')
    await expect(frame.locator('h2', { hasText: 'Key ideas' })).toBeVisible({ timeout: 90000 })
    await expect(frame.locator('math')).toHaveCount(1)
    await expect(frame.locator('.cell-output')).toHaveCount(0)
    // Mermaid runs inside the sandboxed frame (inlined scripts work)
    await expect(frame.locator('svg[id^="mermaid"], pre.mermaid svg, .mermaid svg').first()).toBeVisible({ timeout: 30000 })
    await expect(window.locator('.doc-badge')).toHaveText('Code not run')
    await window.screenshot({ path: path.join(__dirname, '../../test-results/open.png') })

    // The frame cannot reach the app (no Node, opaque origin)
    const isolated = await frame.locator('body').evaluate(() => {
      let parentAccess = true
      try { void window.parent.document } catch (e) { parentAccess = false }
      return { node: typeof require !== 'undefined', parentAccess }
    })
    expect(isolated).toEqual({ node: false, parentAccess: false })

    // Links open in the system browser; the frame keeps showing the document
    await app.evaluate(({ shell }) => {
      global.__opened = []
      shell.openExternal = async (url) => { global.__opened.push(url) }
    })
    await frame.locator('a', { hasText: 'disorder' }).click()
    await expect.poll(() => app.evaluate(() => global.__opened)).toEqual(['https://example.org/entropy'])
    await expect(frame.locator('h2', { hasText: 'Key ideas' })).toBeVisible()

    // /open run asks before running model-written code
    await app.evaluate(({ dialog }) => {
      global.__runPrompt = null
      dialog.showMessageBox = async (win, options) => { global.__runPrompt = options.message; return { response: 2 } }
    })
    await window.fill('.chat-input', '/open run')
    await window.press('.chat-input', 'Enter')
    await expect.poll(() => app.evaluate(() => global.__runPrompt)).toBe('Run 1 code cell (1 python)?')
    await expect(window.locator('.doc-badge')).toHaveText('Code not run')

    await window.fill('.chat-input', '/close')
    await window.press('.chat-input', 'Enter')
    await expect(window.locator('.doc-viewer')).toHaveCount(0)
  })
})
