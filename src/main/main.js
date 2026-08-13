const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const Store = require('electron-store')
const log = require('electron-log')

// Initialize store for settings
const store = new Store({
  name: 'pdf-annotator-settings',
  defaults: {
    // Markdown defaults
    markdown: {
      fontSize: 14,
      lineHeight: 1.6,
      fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    },
    // Annotation box defaults
    annotationBox: {
      defaultWidth: 300,
      defaultHeight: 200,
      minWidth: 100,
      minHeight: 50
    },
    // LaTeX defaults
    latex: {
      macros: {},
      throwOnError: false
    },
    // Keyboard shortcuts
    shortcuts: {
      bold: 'Ctrl+B',
      italic: 'Ctrl+I',
      underline: 'Ctrl+U',
      save: 'Ctrl+S',
      hideAnnotation: 'Ctrl+H'
    },
    // UI settings
    ui: {
      sidebarWidth: 200,
      sidebarVisible: true,
      theme: 'light'
    },
    // Recent files
    recentFiles: []
  }
})

let mainWindow = null
let currentPdfPath = null

const isDev = process.env.NODE_ENV === 'development'

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
    const args = process.argv.slice(isDev ? 2 : 1)
    const pdfFile = args.find(arg => arg.endsWith('.pdf'))
    if (pdfFile && fs.existsSync(pdfFile)) {
      openPdfFile(pdfFile)
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
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
              detail: 'A PDF viewer with Markdown and LaTeX annotation support.\nVersion 1.0.0'
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
  const settings = store.store
  // Remove legacy list margin settings (configs removed)
  if (settings.markdown) {
    delete settings.markdown.listMargin
    delete settings.markdown.listItemMargin
  }
  return settings
})

ipcMain.handle('set-settings', (event, settings) => {
  Object.entries(settings).forEach(([key, value]) => {
    store.set(key, value)
  })
  return store.store
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

// Get PDF page count
ipcMain.handle('get-pdf-page-count', async (event, filePath) => {
  try {
    const buffer = fs.readFileSync(filePath)
    // Count pages by counting /Type /Page entries (simple heuristic)
    // The renderer will get exact count from PDF.js
    const content = buffer.toString('binary')
    const matches = content.match(/\/Type\s*\/Page[^s]/g)
    return matches ? matches.length : 1
  } catch (err) {
    log.error('Failed to get PDF page count:', err)
    return 0
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

// App lifecycle
app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

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
