const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const Store = require('electron-store')
const log = require('electron-log')
const { fileURLToPath } = require('url')

const { createDefaultSettings, pickSettings } = require('../common/constants')
const { LLM_PROVIDERS } = require('../common/llm')
const { listModels, streamChat } = require('./llm')
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

let mainWindow = null
let currentPdfPath = null

const isDev = process.env.NODE_ENV === 'development'

function resolvePdfPath(candidate, baseDir) {
  if (!candidate || typeof candidate !== 'string') return null
  if (candidate.startsWith('-')) return null
  let candidatePath = candidate
  if (candidatePath.startsWith('file://')) {
    try { candidatePath = fileURLToPath(candidatePath) } catch { return null }
  }
  const resolved = path.resolve(baseDir || process.cwd(), candidatePath)
  if (!/\.pdf$/i.test(resolved)) return null
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
    
    // Check if opened with a file argument
    const pdfFile = findPdfArgument(process.argv, isDev ? 2 : 1)
    if (pdfFile) {
      openPdfFile(pdfFile)
    }
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
          label: 'Open PDF...',
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
            click: () => openPdfFile(file)
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
    filters: [
      { name: 'PDF Files', extensions: ['pdf'] }
    ]
  })

  if (!result.canceled && result.filePaths.length > 0) {
    openPdfFile(result.filePaths[0])
  }
}

function openPdfFile(filePath) {
  filePath = path.resolve(filePath)

  if (!fs.existsSync(filePath)) {
    dialog.showErrorBox('File Not Found', `The file "${filePath}" does not exist.`)
    return
  }

  currentPdfPath = filePath
  
  // Update recent files
  let recentFiles = store.get('recentFiles', [])
  recentFiles = recentFiles.filter(f => f !== filePath)
  recentFiles.unshift(filePath)
  recentFiles = recentFiles.slice(0, 20)
  store.set('recentFiles', recentFiles)
  createMenu() // Refresh menu with new recent files

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
    filters: [
      { name: 'PDF Files', extensions: ['pdf'] }
    ]
  })

  if (!result.canceled && result.filePaths.length > 0) {
    openPdfFile(result.filePaths[0])
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

ipcMain.handle('llm:set-key', (event, { providerId, apiKey }) => {
  if (!LLM_PROVIDERS[providerId]) return { success: false, error: 'Unknown provider' }
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
    const models = await listModels({ providerId, baseUrl, apiKey: secrets.getKey(providerId) })
    return { success: true, models }
  } catch (err) {
    return { success: false, code: err.code || 'unknown', error: err.message }
  }
})

// Streaming chat: the renderer picks a requestId and listens for
// llm:chat-delta / llm:chat-done / llm:chat-error events carrying it.
const activeChats = new Map()

ipcMain.handle('llm:chat-start', (event, { requestId, providerId, baseUrl, model, messages, temperature }) => {
  if (!requestId || activeChats.has(requestId)) return { started: false, error: 'Invalid request id' }

  const controller = new AbortController()
  activeChats.set(requestId, controller)
  const sender = event.sender
  const send = (channel, payload) => {
    if (!sender.isDestroyed()) sender.send(channel, { requestId, ...payload })
  }

  streamChat({
    providerId,
    baseUrl,
    apiKey: secrets.getKey(providerId),
    model,
    messages,
    temperature,
    signal: controller.signal,
    onEvent: (e) => {
      if (e.type === 'delta') send('llm:chat-delta', { content: e.content, reasoning: e.reasoning })
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
    const pdfFile = findPdfArgument(argv, 1, workingDirectory)
    if (pdfFile) openPdfFile(pdfFile)
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
    openPdfFile(filePath)
  } else {
    app.whenReady().then(() => openPdfFile(filePath))
  }
})

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  log.error('Uncaught exception:', error)
})
