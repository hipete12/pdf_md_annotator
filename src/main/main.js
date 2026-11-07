const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const Store = require('electron-store')
const log = require('electron-log')
const { fileURLToPath } = require('url')

const { createDefaultSettings, pickSettings } = require('../common/constants')
const { LLM_PROVIDERS } = require('../common/llm')
const {
  isPdfFile, isChatFile, chatBaseName, docPathFor, withChatExtension, nextUntitledName, CHAT_EXTENSION
} = require('../common/chatFiles')
const { codeCellLanguages } = require('../common/docGen')
const { listModels } = require('./llm')
const { runAgent } = require('./agent')
const { findQuarto, renderDocument } = require('./quarto')
const crypto = require('crypto')
const { createSecrets } = require('./secrets')

// Initialize store for settings. User settings live under the top-level keys
// listed in SETTINGS_KEYS; recentFiles is app state, not a user setting.
const store = new Store({
  name: 'pdf-annotator-settings',
  defaults: {
    ...createDefaultSettings(),
    recentFiles: []
  }
})

const secrets = createSecrets(store)
const LLM_USER_AGENT = `PDF-Annotator/${app.getVersion()}`

let mainWindow = null
let currentPdfPath = null

const isDev = process.env.NODE_ENV === 'development'

// Files the app can open: PDFs and standalone chats
function resolvePdfPath(candidate, baseDir) {
  if (!candidate || typeof candidate !== 'string') return null
  if (candidate.startsWith('-')) return null
  let candidatePath = candidate
  if (candidatePath.startsWith('file://')) {
    try { candidatePath = fileURLToPath(candidatePath) } catch { return null }
  }
  const resolved = path.resolve(baseDir || process.cwd(), candidatePath)
  if (!isPdfFile(resolved) && !isChatFile(resolved)) return null
  return fs.existsSync(resolved) ? resolved : null
}

function findPdfArgument(argv, startIndex = 1, baseDir) {
  for (let i = startIndex; i < argv.length; i++) {
    const pdfPath = resolvePdfPath(argv[i], baseDir)
    if (pdfPath) return pdfPath
  }
  return null
}

function openExternalIfSafe(url) {
  try {
    const { protocol } = new URL(url)
    if (protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:') {
      shell.openExternal(url)
    } else {
      log.warn('Blocked opening URL with protocol', protocol)
    }
  } catch {
    log.warn('Blocked opening invalid URL')
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: !isDev
    },
    icon: path.join(__dirname, '../../static/icons/icon.png'),
    show: false
  })

  if (isDev && process.env.DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.DEV_SERVER_URL)
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    
    // Check if opened with a file argument (PDF or chat)
    const file = findPdfArgument(process.argv, isDev ? 2 : 1)
    if (file) openPath(file)
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Rendered markdown (notes, chat replies) can contain links. Never open
  // them inside the app (the renderer has Node integration): hand safe URLs
  // to the system browser and block everything else, including navigating
  // the main window away from the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalIfSafe(url)
    return { action: 'deny' }
  })
  // The rendered document is shown in a sandboxed iframe: links in it must
  // not navigate that frame to web pages; open them in the browser instead
  mainWindow.webContents.on('will-frame-navigate', (details) => {
    if (details.isMainFrame) return
    if (/^(about|data|blob):/i.test(details.url)) return
    details.preventDefault()
    openExternalIfSafe(details.url)
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url === mainWindow.webContents.getURL()) return
    if (isDev && process.env.DEV_SERVER_URL && url.startsWith(process.env.DEV_SERVER_URL)) return
    event.preventDefault()
    openExternalIfSafe(url)
  })

  createMenu()
}

function createMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'New Chat',
          accelerator: 'CmdOrCtrl+N',
          click: () => newChat()
        },
        {
          label: 'Open...',
          accelerator: 'CmdOrCtrl+O',
          click: () => openFileDialog()
        },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => mainWindow?.webContents.send('save-file')
        },
        {
          label: 'Save As...',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => mainWindow?.webContents.send('save-file-as')
        },
        { type: 'separator' },
        {
          label: 'Recent Files',
          submenu: store.get('recentFiles', []).slice(0, 10).map(file => ({
            label: path.basename(file),
            click: () => openPath(file)
          }))
        },
        { type: 'separator' },
        {
          label: 'Exit',
          accelerator: 'Alt+F4',
          click: () => app.quit()
        }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'delete' },
        { type: 'separator' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Sidebar',
          accelerator: 'CmdOrCtrl+\\',
          click: () => mainWindow?.webContents.send('toggle-sidebar')
        },
        {
          label: 'Toggle Chat',
          accelerator: 'CmdOrCtrl+Shift+L',
          click: () => mainWindow?.webContents.send('toggle-chat')
        },
        {
          label: 'Add Selection to Chat',
          accelerator: 'CmdOrCtrl+L',
          click: () => mainWindow?.webContents.send('chat-attach-selection')
        },
        { type: 'separator' },
        {
          label: 'Zoom In',
          accelerator: 'CmdOrCtrl+Plus',
          click: () => mainWindow?.webContents.send('zoom-in')
        },
        {
          label: 'Zoom Out',
          accelerator: 'CmdOrCtrl+-',
          click: () => mainWindow?.webContents.send('zoom-out')
        },
        {
          label: 'Reset Zoom',
          accelerator: 'CmdOrCtrl+0',
          click: () => mainWindow?.webContents.send('zoom-reset')
        },
        { type: 'separator' },
        { role: 'toggleDevTools' }
      ]
    },
    {
      label: 'Settings',
      submenu: [
        {
          label: 'Preferences...',
          accelerator: 'CmdOrCtrl+,',
          click: () => mainWindow?.webContents.send('open-settings')
        }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About PDF Annotator',
              message: 'PDF Annotator',
              detail: 'A PDF viewer with Markdown and LaTeX annotation support.\nVersion 1.1.0'
            })
          }
        },
        {
          label: 'Documentation',
          click: () => shell.openExternal('https://github.com/pdf-annotator/docs')
        }
      ]
    }
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

async function openFileDialog() {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: OPEN_FILTERS
  })

  if (!result.canceled && result.filePaths.length > 0) {
    openPath(result.filePaths[0])
  }
}

const OPEN_FILTERS = [
  { name: 'PDFs and chats', extensions: ['pdf', 'chat'] },
  { name: 'PDF Files', extensions: ['pdf'] },
  { name: 'Chats', extensions: ['chat'] }
]

function openPath(filePath) {
  if (isChatFile(filePath)) openChatFile(filePath)
  else openPdfFile(filePath)
}

function addRecentFile(filePath) {
  let recentFiles = store.get('recentFiles', [])
  recentFiles = recentFiles.filter(f => f !== filePath)
  recentFiles.unshift(filePath)
  store.set('recentFiles', recentFiles.slice(0, 20))
  createMenu() // Refresh menu with new recent files
}

function openPdfFile(filePath) {
  filePath = path.resolve(filePath)

  if (!fs.existsSync(filePath)) {
    dialog.showErrorBox('File Not Found', `The file "${filePath}" does not exist.`)
    return
  }

  currentPdfPath = filePath
  addRecentFile(filePath)

  // Check for .pdfmark file
  const pdfmarkPath = filePath.replace(/\.pdf$/i, '.pdfmark')
  let annotations = null
  
  if (fs.existsSync(pdfmarkPath)) {
    try {
      const data = fs.readFileSync(pdfmarkPath, 'utf8')
      annotations = JSON.parse(data)
      log.info(`Loaded annotations from ${pdfmarkPath}`)
    } catch (err) {
      log.error('Failed to load .pdfmark file:', err)
    }
  }

  mainWindow?.webContents.send('open-pdf', {
    filePath,
    pdfmarkPath,
    annotations
  })

  mainWindow?.setTitle(`PDF Annotator - ${path.basename(filePath)}`)
}

// IPC Handlers
ipcMain.handle('get-settings', () => {
  return pickSettings(store.store)
})

ipcMain.handle('set-settings', (event, settings) => {
  Object.entries(pickSettings(settings)).forEach(([key, value]) => {
    store.set(key, value)
  })
  return pickSettings(store.store)
})

ipcMain.handle('get-setting', (event, key) => {
  return store.get(key)
})

ipcMain.handle('set-setting', (event, key, value) => {
  store.set(key, value)
  return store.get(key)
})

ipcMain.handle('save-pdfmark', async (event, { pdfPath, data }) => {
  const pdfmarkPath = pdfPath.replace(/\.pdf$/i, '.pdfmark')
  const tempPath = pdfmarkPath + '.tmp'
  
  try {
    // Write to temp file first (auto-save)
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8')
    return { success: true, tempPath }
  } catch (err) {
    log.error('Failed to save .pdfmark:', err)
    return { success: false, error: err.message }
  }
})

ipcMain.handle('commit-pdfmark', async (event, { pdfPath }) => {
  const pdfmarkPath = pdfPath.replace(/\.pdf$/i, '.pdfmark')
  const tempPath = pdfmarkPath + '.tmp'
  
  try {
    if (fs.existsSync(tempPath)) {
      // Move temp file to actual file
      fs.renameSync(tempPath, pdfmarkPath)
    }
    return { success: true, pdfmarkPath }
  } catch (err) {
    log.error('Failed to commit .pdfmark:', err)
    return { success: false, error: err.message }
  }
})

// Save As: copy the PDF to a new location and write its .pdfmark next to it,
// then switch the window to the copy. Annotations are tied to "<name>.pdfmark"
// beside the PDF, so saving only the .pdfmark elsewhere would not reload.
ipcMain.handle('save-pdf-as', async (event, { sourcePdfPath, data }) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save PDF and Annotations As',
    defaultPath: sourcePdfPath,
    filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
  })
  if (result.canceled || !result.filePath) {
    return { success: false, cancelled: true }
  }

  let targetPdfPath = path.resolve(result.filePath)
  if (!/\.pdf$/i.test(targetPdfPath)) targetPdfPath += '.pdf'
  const pdfmarkPath = targetPdfPath.replace(/\.pdf$/i, '.pdfmark')
  const tempPath = pdfmarkPath + '.tmp'

  try {
    if (targetPdfPath !== path.resolve(sourcePdfPath)) {
      fs.copyFileSync(sourcePdfPath, targetPdfPath)
    }
    fs.writeFileSync(tempPath, JSON.stringify({ ...data, pdfPath: targetPdfPath }, null, 2), 'utf8')
    fs.renameSync(tempPath, pdfmarkPath)

    // Bring the chat sessions along
    const sourceChatPath = getPdfchatPath(sourcePdfPath)
    if (fs.existsSync(sourceChatPath) && targetPdfPath !== path.resolve(sourcePdfPath)) {
      const chat = JSON.parse(fs.readFileSync(sourceChatPath, 'utf8'))
      writeJsonAtomic(getPdfchatPath(targetPdfPath), { ...chat, pdfPath: targetPdfPath })
    }
  } catch (err) {
    log.error('Save As failed:', err)
    dialog.showErrorBox('Save As Failed', err.message)
    return { success: false, error: err.message }
  }

  openPdfFile(targetPdfPath)
  return { success: true, pdfPath: targetPdfPath, pdfmarkPath }
})

ipcMain.handle('open-file-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: OPEN_FILTERS
  })

  if (!result.canceled && result.filePaths.length > 0) {
    openPath(result.filePaths[0])
    return result.filePaths[0]
  }
  return null
})

ipcMain.handle('read-pdf-file', async (event, filePath) => {
  try {
    const buffer = fs.readFileSync(filePath)
    return buffer
  } catch (err) {
    log.error('Failed to read PDF:', err)
    return null
  }
})

// Show dialog for PDF concatenation
ipcMain.handle('show-pdf-concat-dialog', async (event, { pdfName }) => {
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    title: 'Combine PDFs',
    message: `How would you like to add "${pdfName}"?`,
    buttons: ['Add to End', 'Add to Beginning', 'Cancel'],
    defaultId: 0,
    cancelId: 2
  })
  
  // 0 = end, 1 = beginning, 2 = cancel
  if (result.response === 0) return 'end'
  if (result.response === 1) return 'beginning'
  return 'cancel'
})

// Copy PDF file to destination folder
ipcMain.handle('copy-pdf-file', async (event, { sourcePath, targetPath }) => {
  try {
    const fileName = path.basename(targetPath)
    
    // Check if file already exists
    if (fs.existsSync(targetPath)) {
      const result = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        title: 'File Exists',
        message: `"${fileName}" already exists. Overwrite?`,
        buttons: ['Overwrite', 'Cancel'],
        defaultId: 1,
        cancelId: 1
      })
      
      if (result.response === 1) {
        return { success: false, cancelled: true }
      }
    }
    
    fs.copyFileSync(sourcePath, targetPath)
    return { success: true, targetPath }
  } catch (err) {
    log.error('Failed to copy PDF:', err)
    return { success: false, error: err.message }
  }
})

// Open PDF directly at a specific path (for drag-drop when no PDF is open)
ipcMain.handle('open-pdf-at-path', async (event, filePath) => {
  if (filePath && fs.existsSync(filePath)) {
    openPdfFile(filePath)
    return true
  }
  return false
})

// ---------------------------------------------------------------------------
// LLM chat
// ---------------------------------------------------------------------------

// Chat sessions live in "<name>.pdfchat" next to the PDF
function getPdfchatPath(pdfPath) {
  return pdfPath.replace(/\.pdf$/i, '.pdfchat')
}

function writeJsonAtomic(filePath, data) {
  const tempPath = `${filePath}.tmp`
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8')
  fs.renameSync(tempPath, filePath)
}

ipcMain.handle('chat:load', (event, { pdfPath }) => {
  const chatPath = getPdfchatPath(pdfPath)
  if (!fs.existsSync(chatPath)) return { success: true, data: null }
  try {
    return { success: true, data: JSON.parse(fs.readFileSync(chatPath, 'utf8')) }
  } catch (err) {
    log.error('Failed to load .pdfchat:', err)
    return { success: false, error: err.message }
  }
})

ipcMain.handle('chat:save', (event, { pdfPath, data }) => {
  try {
    writeJsonAtomic(getPdfchatPath(pdfPath), data)
    return { success: true }
  } catch (err) {
    log.error('Failed to save .pdfchat:', err)
    return { success: false, error: err.message }
  }
})

// API keys: write-only from the renderer's point of view
ipcMain.handle('llm:key-status', () => ({
  keys: secrets.keyStatus(),
  storage: secrets.storageStatus()
}))

// Secrets that can be stored: one key per LLM provider, plus Tavily (web tools)
const SECRET_IDS = new Set([...Object.keys(LLM_PROVIDERS), 'tavily'])

ipcMain.handle('llm:set-key', (event, { providerId, apiKey }) => {
  if (!SECRET_IDS.has(providerId)) return { success: false, error: 'Unknown provider' }
  try {
    secrets.setKey(providerId, apiKey)
    return { success: true, keys: secrets.keyStatus() }
  } catch (err) {
    log.error('Failed to store API key:', err)
    return { success: false, error: err.message }
  }
})

ipcMain.handle('llm:list-models', async (event, { providerId, baseUrl }) => {
  try {
    const models = await listModels({ providerId, baseUrl, apiKey: secrets.getKey(providerId), userAgent: LLM_USER_AGENT })
    return { success: true, models }
  } catch (err) {
    return { success: false, code: err.code || 'unknown', error: err.message }
  }
})

// Streaming chat: the renderer picks a requestId and listens for
// llm:chat-delta / llm:chat-activity / llm:chat-done / llm:chat-error events
// carrying it. With webTools the reply runs as an agent loop (agent.js).
const activeChats = new Map()

ipcMain.handle('llm:chat-start', (event, { requestId, providerId, baseUrl, model, messages, temperature, sessionId, webTools }) => {
  if (!requestId || activeChats.has(requestId)) return { started: false, error: 'Invalid request id' }

  const controller = new AbortController()
  activeChats.set(requestId, controller)
  const sender = event.sender
  const send = (channel, payload) => {
    if (!sender.isDestroyed()) sender.send(channel, { requestId, ...payload })
  }

  const tavilyKey = webTools ? secrets.getKey('tavily') : ''
  if (webTools && !tavilyKey) {
    send('llm:chat-activity', { type: 'notice', message: 'Web search is off: add a Tavily API key in Settings → AI Chat.' })
  }

  runAgent({
    chat: {
      providerId,
      baseUrl,
      apiKey: secrets.getKey(providerId),
      model,
      temperature,
      sessionId,
      userAgent: LLM_USER_AGENT,
      signal: controller.signal
    },
    messages,
    webTools: Boolean(webTools && tavilyKey),
    maxSteps: Math.min(20, Math.max(1, parseInt(store.get('tools.maxSteps'), 10) || 6)),
    // E2E tests point the tools at a local fake Tavily server
    // (NODE_ENV is replaced at build time, so a dedicated variable is used)
    toolOptions: {
      apiKey: tavilyKey,
      ...(process.env.PDF_ANNOTATOR_TAVILY_URL ? { baseUrl: process.env.PDF_ANNOTATOR_TAVILY_URL } : {})
    },
    onEvent: (e) => {
      if (e.type === 'delta') send('llm:chat-delta', { content: e.content, reasoning: e.reasoning })
      else send('llm:chat-activity', e)
    }
  })
    .then(result => send('llm:chat-done', result))
    .catch(err => {
      if (err.code !== 'aborted') log.warn('Chat request failed:', err.code, err.message)
      send('llm:chat-error', { code: err.code || 'unknown', message: err.message })
    })
    .finally(() => activeChats.delete(requestId))

  return { started: true }
})

ipcMain.handle('llm:chat-abort', (event, { requestId }) => {
  const controller = activeChats.get(requestId)
  if (controller) controller.abort()
  return { aborted: Boolean(controller) }
})

// ---------------------------------------------------------------------------
// Standalone chats: "<name>.chat" (+ "<name>.qmd") in the chats folder
// ---------------------------------------------------------------------------

function resolveChatsFolder() {
  const configured = String(store.get('chat.chatsFolder') || '').trim()
  const folder = configured || path.join(app.getPath('documents'), 'PDF Annotator', 'Chats')
  fs.mkdirSync(folder, { recursive: true })
  return folder
}

// Path for a new untitled chat. Nothing is written until the first message.
function newUntitledChatPath() {
  const folder = resolveChatsFolder()
  return path.join(folder, `${nextUntitledName(fs.readdirSync(folder))}${CHAT_EXTENSION}`)
}

function newChat() {
  const chatPath = newUntitledChatPath()
  currentPdfPath = null
  mainWindow?.webContents.send('open-chat', { chatPath, data: null })
  mainWindow?.setTitle(`PDF Annotator - ${chatBaseName(chatPath)}`)
  return chatPath
}

function openChatFile(filePath) {
  filePath = path.resolve(filePath)
  let data
  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (err) {
    log.error('Failed to open chat:', err)
    dialog.showErrorBox('Could Not Open Chat', `${filePath}\n\n${err.message}`)
    return
  }
  currentPdfPath = null
  addRecentFile(filePath)
  mainWindow?.webContents.send('open-chat', { chatPath: filePath, data })
  mainWindow?.setTitle(`PDF Annotator - ${chatBaseName(filePath)}`)
}

// Keep copies of a document before it is replaced: .versions/<name>/<time>.qmd
// next to it, at most `keep` per document.
function backupDocument(docPath, keep = 10) {
  if (!fs.existsSync(docPath)) return
  const dir = path.join(path.dirname(docPath), '.versions', path.basename(docPath, '.qmd'))
  fs.mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  fs.copyFileSync(docPath, path.join(dir, `${stamp}.qmd`))
  const versions = fs.readdirSync(dir).filter(f => f.endsWith('.qmd')).sort()
  for (const old of versions.slice(0, Math.max(0, versions.length - keep))) {
    fs.rmSync(path.join(dir, old), { force: true })
  }
}

ipcMain.handle('chatfile:new', () => ({ chatPath: newChat() }))

ipcMain.handle('chatfile:save', (event, { chatPath, data }) => {
  try {
    const isNew = !fs.existsSync(chatPath)
    fs.mkdirSync(path.dirname(chatPath), { recursive: true })
    writeJsonAtomic(chatPath, data)
    if (isNew) addRecentFile(chatPath)
    return { success: true }
  } catch (err) {
    log.error('Failed to save chat:', err)
    return { success: false, error: err.message }
  }
})

// Save As copies the chat (and its document, if any) under a new name and
// switches to the copy. Both target files are checked before anything is
// written.
ipcMain.handle('chatfile:save-as', async (event, { chatPath, data }) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Chat As',
    defaultPath: chatPath,
    filters: [{ name: 'Chats', extensions: ['chat'] }]
  })
  if (result.canceled || !result.filePath) return { success: false, cancelled: true }

  const targetChat = path.resolve(withChatExtension(result.filePath))
  if (targetChat === path.resolve(chatPath)) {
    writeJsonAtomic(targetChat, { ...data, chatPath: targetChat })
    return { success: true, chatPath: targetChat }
  }
  const sourceDoc = docPathFor(chatPath)
  const targetDoc = docPathFor(targetChat)
  const existing = [targetChat, targetDoc].filter(p => fs.existsSync(p))
  if (existing.length) {
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: 'Files Already Exist',
      message: `${existing.map(p => `"${path.basename(p)}"`).join(' and ')} already ${existing.length > 1 ? 'exist' : 'exists'}. Replace?`,
      detail: fs.existsSync(targetDoc) && !fs.existsSync(sourceDoc)
        ? 'This chat has no document yet, so the existing document is moved to the .versions folder.'
        : 'A replaced document is kept in the .versions folder.',
      buttons: ['Replace', 'Cancel'],
      defaultId: 1,
      cancelId: 1
    })
    if (response !== 0) return { success: false, cancelled: true }
  }

  try {
    writeJsonAtomic(targetChat, { ...data, chatPath: targetChat })
    if (fs.existsSync(targetDoc)) backupDocument(targetDoc)
    if (fs.existsSync(sourceDoc)) fs.copyFileSync(sourceDoc, targetDoc)
    else if (fs.existsSync(targetDoc)) fs.rmSync(targetDoc)
  } catch (err) {
    log.error('Chat Save As failed:', err)
    dialog.showErrorBox('Save As Failed', err.message)
    return { success: false, error: err.message }
  }
  openChatFile(targetChat)
  return { success: true, chatPath: targetChat }
})

// The generated document of a standalone chat. Only "<name>.qmd" next to a
// "<name>.chat" can be read or written here, and the renderer only writes it
// for a /generate command.
function documentPathForChat(chatPath) {
  if (!isChatFile(chatPath)) throw new Error('Not a chat file')
  return docPathFor(path.resolve(chatPath))
}

ipcMain.handle('doc:read', (event, { chatPath }) => {
  try {
    const docPath = documentPathForChat(chatPath)
    if (!fs.existsSync(docPath)) return { success: true, exists: false, docPath, content: '' }
    return { success: true, exists: true, docPath, content: fs.readFileSync(docPath, 'utf8') }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('doc:write', (event, { chatPath, content }) => {
  try {
    const docPath = documentPathForChat(chatPath)
    fs.mkdirSync(path.dirname(docPath), { recursive: true })
    backupDocument(docPath)
    const tempPath = `${docPath}.tmp`
    fs.writeFileSync(tempPath, String(content), 'utf8')
    fs.renameSync(tempPath, docPath)
    return { success: true, docPath }
  } catch (err) {
    log.error('Failed to write document:', err)
    return { success: false, error: err.message }
  }
})

// --- Quarto: render the chat's document for the viewer ----------------------

ipcMain.handle('quarto:status', async (event, { refresh = false } = {}) => {
  const found = await findQuarto(String(store.get('quarto.path') || '').trim(), { refresh })
  return found ? { found: true, ...found } : { found: false }
})

let activeRender = null
// Documents whose code the user agreed to run (content hashes, this run of the app)
const approvedCode = new Set()

async function confirmRunCode(content) {
  const languages = codeCellLanguages(content)
  if (languages.length === 0) return 'run'
  const hash = crypto.createHash('sha256').update(content).digest('hex')
  if (approvedCode.has(hash)) return 'run'
  const counts = Object.entries(languages.reduce((acc, l) => ({ ...acc, [l]: (acc[l] || 0) + 1 }), {}))
    .map(([lang, n]) => `${n} ${lang}`).join(', ')
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: 'Run Code Cells?',
    message: `Run ${languages.length} code cell${languages.length === 1 ? '' : 's'} (${counts})?`,
    detail: 'The model wrote this code. Running it executes it on your computer with your permissions. ' +
      'Read the document first and only run code you trust.',
    buttons: ['Run Code', 'Show Without Running', 'Cancel'],
    defaultId: 1,
    cancelId: 2
  })
  if (response === 0) {
    approvedCode.add(hash)
    return 'run'
  }
  return response === 1 ? 'static' : 'cancel'
}

ipcMain.handle('doc:render', async (event, { chatPath, run = false }) => {
  let docPath
  try {
    docPath = documentPathForChat(chatPath)
  } catch (err) {
    return { success: false, code: 'config', error: err.message }
  }
  if (!fs.existsSync(docPath)) {
    return { success: false, code: 'no_document', error: 'There is no document for this chat yet. Use /generate first.' }
  }
  const quarto = await findQuarto(String(store.get('quarto.path') || '').trim())
  if (!quarto) {
    return {
      success: false,
      code: 'no_quarto',
      error: 'Quarto was not found. Install it from https://quarto.org/docs/get-started/ or set its path in Settings → Documents.'
    }
  }
  const content = fs.readFileSync(docPath, 'utf8')
  let execute = Boolean(run)
  if (execute) {
    const choice = await confirmRunCode(content)
    if (choice === 'cancel') return { success: false, code: 'cancelled', error: 'Cancelled' }
    execute = choice === 'run'
  }

  activeRender?.abort()
  const controller = new AbortController()
  activeRender = controller
  try {
    const result = await renderDocument({
      quartoPath: quarto.path,
      version: quarto.version,
      content,
      run: execute,
      cacheDir: path.join(app.getPath('userData'), 'quarto-renders'),
      signal: controller.signal
    })
    return { success: true, html: result.html, cached: result.cached, run: execute, docName: path.basename(docPath), quartoVersion: quarto.version }
  } catch (err) {
    if (err.code !== 'cancelled') log.warn('Quarto render failed:', err.message)
    return { success: false, code: err.code || 'render', error: err.message, log: err.log || '' }
  } finally {
    if (activeRender === controller) activeRender = null
  }
})

ipcMain.handle('doc:render-cancel', () => {
  activeRender?.abort()
  return { cancelled: Boolean(activeRender) }
})

ipcMain.handle('open-path', (event, filePath) => {
  if (filePath && fs.existsSync(filePath)) {
    openPath(filePath)
    return true
  }
  return false
})

ipcMain.handle('get-recent-files', () => store.get('recentFiles', []).map(filePath => ({
  path: filePath,
  name: path.basename(filePath),
  kind: isChatFile(filePath) ? 'chat' : 'pdf',
  exists: fs.existsSync(filePath)
})))

ipcMain.handle('get-chats-folder', () => resolveChatsFolder())

// App lifecycle
const gotSingleInstanceLock = app.requestSingleInstanceLock()

if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', (event, argv, workingDirectory) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
    const file = findPdfArgument(argv, 1, workingDirectory)
    if (file) openPath(file)
  })

  app.whenReady().then(() => {
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
      }
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('open-file', (event, filePath) => {
  event.preventDefault()
  if (mainWindow) {
    openPath(filePath)
  } else {
    app.whenReady().then(() => openPath(filePath))
  }
})

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  log.error('Uncaught exception:', error)
})
