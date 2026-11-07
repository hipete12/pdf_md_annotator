/**
 * Quarto integration: find the quarto binary and render a chat's .qmd to a
 * single self-contained HTML file. Kept free of Electron imports so it can be
 * unit tested.
 *
 * Rendering happens in a cache folder (one subfolder per content hash), never
 * next to the chat, so Quarto's output files do not clutter the chats folder.
 */
const { execFile, spawn } = require('child_process')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')

const VERSION_TIMEOUT_MS = 15000
const KEEP_RENDERS = 20
const MAX_LOG_CHARS = 200000

class QuartoError extends Error {
  constructor(code, message, log = '') {
    super(message)
    this.code = code
    this.log = log
  }
}

/** Places to look for quarto, most specific first. */
function candidatePaths(configured, { platform = process.platform, home = os.homedir(), envPath = process.env.PATH || '' } = {}) {
  const exe = platform === 'win32' ? 'quarto.exe' : 'quarto'
  const list = []
  if (configured) list.push(configured)
  for (const dir of envPath.split(path.delimiter).filter(Boolean)) list.push(path.join(dir, exe))
  if (platform === 'win32') {
    list.push(path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Quarto', 'bin', exe))
    list.push(path.join(home, 'AppData', 'Local', 'Programs', 'Quarto', 'bin', exe))
  } else {
    // Desktop launchers often start the app without the user's shell PATH
    list.push(path.join(home, '.local', 'bin', exe))
    list.push('/usr/local/bin/quarto', '/usr/bin/quarto', '/opt/quarto/bin/quarto')
    if (platform === 'darwin') list.push('/Applications/quarto/bin/quarto')
    // Tarball installs such as ~/opt/quarto-1.11.9/bin/quarto (newest first)
    try {
      const optDir = path.join(home, 'opt')
      const versions = fs.readdirSync(optDir).filter(d => /^quarto/i.test(d)).sort().reverse()
      for (const dir of versions) list.push(path.join(optDir, dir, 'bin', exe))
    } catch {
      // no ~/opt
    }
  }
  return [...new Set(list)]
}

function quartoVersion(binary) {
  return new Promise((resolve) => {
    execFile(binary, ['--version'], { timeout: VERSION_TIMEOUT_MS, windowsHide: true }, (err, stdout) => {
      if (err) return resolve(null)
      const version = String(stdout).trim().split(/\s+/)[0]
      resolve(/^\d+\.\d+/.test(version) ? version : null)
    })
  })
}

let cachedLookup = null

/**
 * @param {string} [configured] - path from Settings ('' = search)
 * @param {object} [options]
 * @param {boolean} [options.refresh] - ignore the cached result
 * @returns {Promise<{ path: string, version: string } | null>}
 */
async function findQuarto(configured = '', { refresh = false, ...searchOptions } = {}) {
  if (!refresh && cachedLookup && cachedLookup.configured === configured) return cachedLookup.result
  let result = null
  for (const candidate of candidatePaths(configured, searchOptions)) {
    if (!fs.existsSync(candidate)) continue
    const version = await quartoVersion(candidate)
    if (version) {
      result = { path: candidate, version }
      break
    }
  }
  cachedLookup = { configured, result }
  return result
}

function tail(text, lines = 40) {
  return String(text || '').split('\n').slice(-lines).join('\n').trim()
}

function hintFor(log) {
  if (/jupyter|ipykernel|No module named/i.test(log)) {
    return ' Running Python cells needs Jupyter: install it (for example in a virtual environment with "pip install jupyter matplotlib") and point QUARTO_PYTHON at that Python.'
  }
  if (/Rscript|knitr|rmarkdown/i.test(log)) return ' Running R cells needs R with the knitr and rmarkdown packages.'
  return ''
}

function pruneCache(cacheDir, keep = KEEP_RENDERS) {
  try {
    const dirs = fs.readdirSync(cacheDir)
      .map(name => ({ name, time: fs.statSync(path.join(cacheDir, name)).mtimeMs }))
      .sort((a, b) => b.time - a.time)
    for (const old of dirs.slice(keep)) fs.rmSync(path.join(cacheDir, old.name), { recursive: true, force: true })
  } catch {
    // best effort
  }
}

/**
 * Render a .qmd to self-contained HTML.
 * @param {object} params
 * @param {string} params.quartoPath
 * @param {string} params.version - quarto version (part of the cache key)
 * @param {string} params.content - .qmd source
 * @param {boolean} params.run - execute code cells
 * @param {string} params.cacheDir
 * @param {AbortSignal} [params.signal]
 * @param {number} [params.timeoutMs]
 * @returns {Promise<{ html: string, cached: boolean, log: string }>}
 */
function renderDocument({ quartoPath, version = '', content, run, cacheDir, signal, timeoutMs = run ? 300000 : 120000 }) {
  const hash = crypto.createHash('sha256').update(`${version}\n${run ? 'run' : 'static'}\n${content}`).digest('hex').slice(0, 24)
  const workDir = path.join(cacheDir, hash)
  const htmlPath = path.join(workDir, 'document.html')
  if (fs.existsSync(htmlPath)) {
    const now = new Date()
    fs.utimesSync(workDir, now, now)
    return Promise.resolve({ html: fs.readFileSync(htmlPath, 'utf8'), cached: true, log: '' })
  }

  fs.mkdirSync(workDir, { recursive: true })
  fs.writeFileSync(path.join(workDir, 'document.qmd'), content, 'utf8')
  const args = ['render', 'document.qmd', '--to', 'html', run ? '--execute' : '--no-execute', '-M', 'embed-resources:true']

  return new Promise((resolve, reject) => {
    let log = ''
    let settled = false
    const child = spawn(quartoPath, args, { cwd: workDir, windowsHide: true, env: { ...process.env } })
    const finish = (fn) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      fn()
    }
    const fail = (error) => finish(() => {
      fs.rmSync(workDir, { recursive: true, force: true })
      reject(error)
    })
    const onAbort = () => {
      child.kill()
      fail(new QuartoError('cancelled', 'Rendering was cancelled'))
    }
    const timer = setTimeout(() => {
      child.kill()
      fail(new QuartoError('timeout', `Quarto did not finish within ${Math.round(timeoutMs / 1000)} s`, tail(log)))
    }, timeoutMs)
    if (signal?.aborted) return onAbort()
    signal?.addEventListener('abort', onAbort, { once: true })

    const collect = (chunk) => { if (log.length < MAX_LOG_CHARS) log += chunk.toString() }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    child.on('error', (err) => fail(new QuartoError('spawn', `Could not start Quarto: ${err.message}`)))
    child.on('close', (code) => {
      if (settled) return
      if (code !== 0 || !fs.existsSync(htmlPath)) {
        const short = tail(log)
        return fail(new QuartoError('render', `Quarto could not render the document.${hintFor(log)}`, short))
      }
      finish(() => {
        const html = fs.readFileSync(htmlPath, 'utf8')
        // Keep only the result; the copied source and logs are not needed
        for (const name of fs.readdirSync(workDir)) {
          if (name !== 'document.html') fs.rmSync(path.join(workDir, name), { recursive: true, force: true })
        }
        pruneCache(cacheDir)
        resolve({ html, cached: false, log: tail(log, 10) })
      })
    })
  })
}

module.exports = { candidatePaths, findQuarto, renderDocument, QuartoError }
