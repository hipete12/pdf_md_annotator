/**
 * E2E tests for choosing a model's thinking (reasoning) effort in the chat
 * model picker and in Settings, against a fake OpenAI-compatible server
 * whose model list reports effort levels the way OpenRouter does.
 */

const { test, expect } = require('@playwright/test')
const fs = require('fs')
const { startFakeLlm, launchWithSettings } = require('./helpers')

const MODELS = [
  { id: 'fake-model' },
  { id: 'thinker', name: 'Thinker', reasoning: { supported_efforts: ['max', 'high', 'low'], default_effort: 'high' } }
]

test.describe('Thinking effort', () => {
  let app
  let window
  let tempDir
  let fake

  test.beforeEach(async () => {
    fake = await startFakeLlm(() => 'A considered answer.', { models: MODELS })
    ;({ app, window, tempDir } = await launchWithSettings(() => ({
      llm: { provider: 'custom', baseUrls: { custom: fake.baseUrl }, models: { custom: 'fake-model' } }
    })))
    await window.locator('.welcome-card', { hasText: 'New chat' }).click()
    await window.waitForSelector('.chat-panel.standalone')
  })

  test.afterEach(async () => {
    if (app) await app.close()
    fake?.server.close()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  const pickerButton = () => window.locator('.model-picker-button')

  test('picking a thinking model offers its efforts; the choice shows as model:effort and is sent', async () => {
    await pickerButton().click()
    const thinker = window.locator('.model-picker-item', { hasText: 'Thinker' })
    await expect(thinker.locator('.model-picker-badge.thinking')).toBeVisible()
    // Models without levels are chosen in one step
    await expect(window.locator('.model-picker-item', { hasText: 'fake-model' }).locator('.thinking')).toHaveCount(0)

    await thinker.click()
    const step = window.locator('[aria-label="Thinking effort"]')
    await expect(step.locator('.model-picker-item-name')).toHaveText(['Default', 'low', 'high', 'max'])
    await expect(step.locator('.model-picker-item').first()).toContainText("the model's default (high)")
    await step.locator('.model-picker-item', { hasText: 'max' }).click()

    await expect(window.locator('.model-picker-menu')).toHaveCount(0)
    await expect(pickerButton()).toHaveText('thinker:max')

    await window.fill('.chat-input', 'Think hard')
    await window.press('.chat-input', 'Enter')
    await expect(window.locator('.chat-message-model')).toHaveText('thinker:max')
    const request = fake.chatRequests()[0]
    expect(request).toMatchObject({ model: 'thinker', reasoning_effort: 'max' })

    // The effort can be changed later without picking the model again
    await pickerButton().click()
    const row = window.locator('.model-picker-effort-row')
    await expect(row).toContainText('max')
    await row.click()
    await step.locator('.model-picker-item', { hasText: 'Default' }).click()
    await expect(pickerButton()).toHaveText('thinker')
  })

  test('Settings set the effort of the default model', async () => {
    await window.keyboard.press('Control+,')
    await window.locator('.ai-settings .btn', { hasText: /Load models|Refresh/ }).click()
    await expect(window.locator('#ai-effort')).toHaveCount(0) // fake-model has no levels

    await window.locator('#ai-model').fill('thinker')
    await window.locator('#ai-model').press('Tab')
    const effort = window.locator('#ai-effort')
    await expect(effort.locator('option')).toHaveText(['Default (high)', 'low', 'high', 'max'])
    await effort.selectOption('low')
    await expect(window.locator('.ai-model-label')).toHaveText('thinker:low')
    await window.locator('.modal-close').click()

    await expect(pickerButton()).toHaveText('thinker:low')
    await window.fill('.chat-input', 'Quick one')
    await window.press('.chat-input', 'Enter')
    await expect(window.locator('.chat-message-model')).toHaveText('thinker:low')
    expect(fake.chatRequests()[0]).toMatchObject({ model: 'thinker', reasoning_effort: 'low' })

    // Switching to a model without levels clears the effort
    await window.keyboard.press('Control+,')
    await window.locator('#ai-model').fill('fake-model')
    await window.locator('#ai-model').press('Tab')
    await expect(window.locator('#ai-effort')).toHaveCount(0)
    expect(await window.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.state.settings.llm.efforts)).toEqual({})
  })
})
