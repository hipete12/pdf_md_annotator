/**
 * E2E Tests for PDF Annotator application
 * Uses Playwright with Electron
 */

const { test, expect, _electron } = require('@playwright/test')
const path = require('path')
const fs = require('fs')
const os = require('os')

// Helper to get a unique temp directory for each test
function getTempDir() {
  return path.join(os.tmpdir(), `pdf-annotator-test-${Date.now()}`)
}

// Helper to launch the Electron app
async function launchApp(userDataDir) {
  const electronPath = require('electron')
  const appPath = path.join(__dirname, '../../dist/main/main.js')
  
  const app = await _electron.launch({
    executablePath: electronPath,
    args: [appPath],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      ELECTRON_USER_DATA_DIR: userDataDir
    },
    timeout: 30000
  })
  
  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  
  return { app, window }
}

test.describe('Application Launch', () => {
  let app
  let window
  let userDataDir
  
  test.beforeEach(async () => {
    userDataDir = getTempDir()
    fs.mkdirSync(userDataDir, { recursive: true })
  })
  
  test.afterEach(async () => {
    if (app) {
      await app.close()
    }
    // Cleanup temp dir
    if (fs.existsSync(userDataDir)) {
      fs.rmSync(userDataDir, { recursive: true, force: true })
    }
  })
  
  test('should launch and show welcome screen', async () => {
    const result = await launchApp(userDataDir)
    app = result.app
    window = result.window
    
    // Check for welcome screen elements
    const welcomeTitle = await window.locator('.welcome-title')
    await expect(welcomeTitle).toBeVisible()
    await expect(welcomeTitle).toHaveText('PDF Annotator')
    
    // Check for open button
    const openButton = await window.locator('.btn-primary')
    await expect(openButton).toBeVisible()
    await expect(openButton).toHaveText('Open PDF File')
  })
  
  test('should have correct window title', async () => {
    const result = await launchApp(userDataDir)
    app = result.app
    window = result.window
    
    const title = await window.title()
    expect(title).toContain('PDF Annotator')
  })
})

test.describe('Keyboard Shortcuts Display', () => {
  let app
  let window
  let userDataDir
  
  test.beforeEach(async () => {
    userDataDir = getTempDir()
    fs.mkdirSync(userDataDir, { recursive: true })
    const result = await launchApp(userDataDir)
    app = result.app
    window = result.window
  })
  
  test.afterEach(async () => {
    if (app) await app.close()
    if (fs.existsSync(userDataDir)) {
      fs.rmSync(userDataDir, { recursive: true, force: true })
    }
  })
  
  test('should display keyboard shortcuts in welcome screen', async () => {
    const shortcuts = await window.locator('.welcome-shortcuts')
    await expect(shortcuts).toBeVisible()
    
    // Check for specific shortcuts
    const shortcutItems = await window.locator('.welcome-shortcuts li')
    const count = await shortcutItems.count()
    expect(count).toBeGreaterThan(0)
    
    // Check for Ctrl+B
    const boldShortcut = await window.locator('text=Ctrl+B')
    await expect(boldShortcut).toBeVisible()
  })
})

test.describe('Settings Modal', () => {
  let app
  let window
  let userDataDir
  
  test.beforeEach(async () => {
    userDataDir = getTempDir()
    fs.mkdirSync(userDataDir, { recursive: true })
    const result = await launchApp(userDataDir)
    app = result.app
    window = result.window
  })
  
  test.afterEach(async () => {
    if (app) await app.close()
    if (fs.existsSync(userDataDir)) {
      fs.rmSync(userDataDir, { recursive: true, force: true })
    }
  })
  
  test('should open settings modal via keyboard shortcut', async () => {
    // Press Ctrl+, to open settings
    await window.keyboard.press('Control+,')
    
    // Wait for modal to appear
    const modal = await window.locator('.modal')
    await expect(modal).toBeVisible({ timeout: 5000 })
    
    // Check modal title
    const title = await window.locator('.modal-title')
    await expect(title).toHaveText('Settings')
  })
  
  test('should close settings modal with close button', async () => {
    await window.keyboard.press('Control+,')
    
    const modal = await window.locator('.modal')
    await expect(modal).toBeVisible()
    
    // Click close button
    await window.locator('.modal-close').click()
    
    await expect(modal).not.toBeVisible()
  })
  
  test('should display all settings sections', async () => {
    await window.keyboard.press('Control+,')
    
    // Check for settings sections
    const sections = await window.locator('.settings-section-title')
    const count = await sections.count()
    expect(count).toBeGreaterThanOrEqual(4) // Markdown, Annotation Box, LaTeX, Shortcuts, UI
  })
})

// Note: These tests require a built application
// Run: npm run build && npm run test:e2e
