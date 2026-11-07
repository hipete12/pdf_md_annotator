/**
 * Shared E2E helpers: a scriptable fake OpenAI-compatible server and an app
 * launcher that uses a throwaway Electron profile.
 */
const { _electron } = require('@playwright/test')
const http = require('http')
const path = require('path')
const fs = require('fs')
const os = require('os')

/**
 * Fake LLM. respond(body, index) returns a string (streamed as the reply) or
 * { content, toolCalls: [{ id, name, arguments }], finishReason }.
 */
function startFakeLlm(respond) {
  const requests = []
  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', chunk => { raw += chunk })
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : null
      requests.push({ url: req.url, body })
      if (req.url.endsWith('/models')) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ data: [{ id: 'fake-model' }] }))
        return
      }
      const chatIndex = requests.filter(r => r.url.endsWith('/chat/completions')).length - 1
      const reply = respond(body, chatIndex)
      const { content = '', toolCalls = [], finishReason = toolCalls.length ? 'tool_calls' : 'stop' } =
        typeof reply === 'string' ? { content: reply } : reply
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      for (const part of content.match(/[\s\S]{1,8}/g) || []) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: part } }] })}\n\n`)
      }
      toolCalls.forEach((call, index) => {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index, id: call.id, type: 'function', function: { name: call.name, arguments: '' } }] } }] })}\n\n`)
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index, function: { arguments: JSON.stringify(call.arguments) } }] } }] })}\n\n`)
      })
      res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finishReason }] })}\n\n`)
      res.end('data: [DONE]\n\n')
    })
  })
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({
    server,
    requests,
    chatRequests: () => requests.filter(r => r.url.endsWith('/chat/completions')).map(r => r.body),
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`
  })))
}

/**
 * Launch the built app with a fresh profile whose settings are `settings`.
 * Returns { app, window, tempDir, profile }.
 */
async function launchWithSettings(settings, extraArgs = []) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-annotator-e2e-'))
  const profile = path.join(tempDir, 'profile')
  fs.mkdirSync(profile)
  fs.writeFileSync(path.join(profile, 'pdf-annotator-settings.json'), JSON.stringify(settings(tempDir)))
  const appPath = path.join(__dirname, '../../app-build/main/main.js')
  const args = [`--user-data-dir=${profile}`, appPath, ...extraArgs]
  if (process.platform === 'linux') args.unshift('--no-sandbox')
  const app = await _electron.launch({ executablePath: require('electron'), args, env: { ...process.env, NODE_ENV: 'test' } })
  const window = await app.firstWindow()
  return { app, window, tempDir, profile }
}

module.exports = { startFakeLlm, launchWithSettings }
