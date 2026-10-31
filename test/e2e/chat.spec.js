/**
 * E2E tests for the chat panel, against a local fake OpenAI-compatible server.
 * Each test uses its own Electron profile (--user-data-dir) so real settings
 * and API keys are never touched.
 */

const { test, expect, _electron } = require('@playwright/test')
const http = require('http')
const path = require('path')
const fs = require('fs')
const os = require('os')

// Minimal valid PDF with one line of text per page
function writeTestPdf(filePath, pageTexts) {
  const objects = []
  const add = (body) => { objects.push(body); return objects.length }
  const catalog = add(null)
  const pages = add(null)
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  const kids = pageTexts.map((text) => {
    const stream = `BT /F1 18 Tf 72 700 Td (${text.replace(/[()\\]/g, '\\$&')}) Tj ET`
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
    return add(`<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 612 792] /Contents ${content} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`)
  })
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pages} 0 R >>`
  objects[pages - 1] = `<< /Type /Pages /Kids [${kids.map(k => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`

  let pdf = '%PDF-1.4\n'
  const offsets = objects.map((body, i) => {
    const offset = pdf.length
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`
    return offset
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  pdf += offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  fs.writeFileSync(filePath, pdf, 'latin1')
}

// Fake OpenAI-compatible server that streams a fixed reply
function startFakeLlm(replyText) {
  const requests = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      const parsed = body ? JSON.parse(body) : null
      requests.push({ url: req.url, body: parsed })
      if (req.url.endsWith('/models')) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ data: [{ id: 'fake-model' }] }))
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      for (const part of replyText.match(/.{1,8}/gs)) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: part } }] })}\n\n`)
      }
      res.end('data: [DONE]\n\n')
    })
  })
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({
    server,
    requests,
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`
  })))
}

test.describe('Chat', () => {
  let app
  let window
  let tempDir
  let fake

  test.beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-annotator-chat-'))
    const profile = path.join(tempDir, 'profile')
    fs.mkdirSync(profile)
    const pdfPath = path.join(tempDir, 'doc.pdf')
    writeTestPdf(pdfPath, ['Transformers use attention', 'Second page about results'])

    fake = await startFakeLlm('The document is about **attention**. $x^2$')
    fs.writeFileSync(path.join(profile, 'pdf-annotator-settings.json'), JSON.stringify({
      llm: { provider: 'custom', baseUrls: { custom: fake.baseUrl }, models: { custom: 'fake-model' } }
    }))

    const appPath = path.join(__dirname, '../../app-build/main/main.js')
    const args = [`--user-data-dir=${profile}`, appPath, pdfPath]
    if (process.platform === 'linux') args.unshift('--no-sandbox')
    app = await _electron.launch({ executablePath: require('electron'), args, env: { ...process.env, NODE_ENV: 'test' } })
    window = await app.firstWindow()
    await window.waitForSelector('.pdf-page-wrapper[data-page="1"] .textLayer span')
  })

  test.afterEach(async () => {
    if (app) await app.close()
    fake?.server.close()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  const toggleChat = () => app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.send('toggle-chat')
  })

  test('sends a question with the document text and saves the session', async () => {
    await toggleChat()
    await expect(window.locator('.chat-panel')).toBeVisible()

    await window.fill('.chat-input', 'What is this about?')
    await window.press('.chat-input', 'Enter')

    const answer = window.locator('.chat-message-assistant .chat-answer')
    await expect(answer.locator('strong')).toHaveText('attention')
    await expect(answer.locator('.katex')).toHaveCount(1)
    await expect(window.locator('.chat-send.stop')).toHaveCount(0)

    const request = fake.requests.find(r => r.url.endsWith('/chat/completions')).body
    expect(request.model).toBe('fake-model')
    expect(request.messages[0].content).toContain('[Page 1]\nTransformers use attention')
    expect(request.messages[0].content).toContain('[Page 2]\nSecond page about results')
    expect(request.messages[1]).toEqual({ role: 'user', content: 'What is this about?' })

    const chatFile = path.join(tempDir, 'doc.pdfchat')
    await expect.poll(() => fs.existsSync(chatFile)).toBe(true)
    const saved = JSON.parse(fs.readFileSync(chatFile, 'utf8'))
    expect(saved.sessions[0].title).toBe('What is this about?')
  })

  test('attaches selected PDF text as context for one message', async () => {
    await toggleChat()
    await window.evaluate(() => {
      const span = document.querySelector('.pdf-page-wrapper[data-page="2"] .textLayer span')
      const range = document.createRange()
      range.selectNodeContents(span)
      const selection = window.getSelection()
      selection.removeAllRanges()
      selection.addRange(range)
    })

    const pending = window.locator('.chat-chip.pending')
    await expect(pending).toContainText('p. 2')
    await pending.click()
    await expect(window.locator('.chat-chip.attached')).toHaveCount(1)

    await window.fill('.chat-input', 'Explain')
    await window.press('.chat-input', 'Enter')
    await expect(window.locator('.chat-message-assistant .chat-answer')).toBeVisible()
    await expect(window.locator('.chat-context-tray')).toHaveCount(0)

    const request = fake.requests.find(r => r.url.endsWith('/chat/completions')).body
    expect(request.messages.at(-1).content).toContain('[p. 2, PDF excerpt]\nSecond page about results')
  })

  test('regenerate edits the question and creates a branch', async () => {
    await toggleChat()
    await window.fill('.chat-input', 'Original question')
    await window.press('.chat-input', 'Enter')
    await expect(window.locator('.chat-message-assistant .chat-answer')).toBeVisible()
    await expect(window.locator('.chat-send.stop')).toHaveCount(0)

    await window.getByRole('button', { name: 'Regenerate', exact: true }).click()
    const edit = window.locator('.chat-edit-input')
    await expect(edit).toHaveValue('Original question')
    await window.keyboard.press('Escape')
    await expect(window.locator('.chat-edit')).toHaveCount(0)

    await window.getByRole('button', { name: 'Regenerate', exact: true }).click()
    await edit.fill('Edited question')
    await edit.press('Enter')
    await expect(window.locator('.chat-bubble')).toHaveText('Edited question')
    await expect(window.locator('.chat-branch-count')).toHaveText('2 / 2')

    await window.click('.chat-branch-btn[title="Previous branch"]')
    await expect(window.locator('.chat-bubble')).toHaveText('Original question')

    await window.click('.chat-icon-btn[title="Branches"]')
    await expect(window.locator('.branch-map-node')).toHaveCount(2)
    expect(fake.requests.filter(r => r.url.endsWith('/chat/completions')).length).toBe(2)
  })

  test('full screen can be entered and left with Esc', async () => {
    await toggleChat()
    await window.click('.chat-icon-btn[title="Full screen"]')
    await expect(window.locator('.chat-panel.fullscreen')).toBeVisible()
    await window.keyboard.press('Escape')
    await expect(window.locator('.chat-panel.fullscreen')).toHaveCount(0)
    await expect(window.locator('.chat-panel')).toBeVisible()
  })
})
