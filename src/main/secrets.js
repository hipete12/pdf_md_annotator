/**
 * API key storage for LLM providers. Keys are encrypted with Electron's
 * safeStorage (OS keychain / libsecret / DPAPI) and kept in electron-store
 * under "llmKeys". They never leave the main process: the renderer only learns
 * whether a key is set.
 */
const { safeStorage } = require('electron')

const STORE_KEY = 'llmKeys'

function createSecrets(store) {
  const readAll = () => store.get(STORE_KEY, {}) || {}

  // On Linux without a keyring Electron falls back to a hard-coded password
  // ("basic_text"), which only obfuscates the key.
  function storageStatus() {
    const available = safeStorage.isEncryptionAvailable()
    let backend = null
    if (process.platform === 'linux' && typeof safeStorage.getSelectedStorageBackend === 'function') {
      backend = safeStorage.getSelectedStorageBackend()
    }
    return {
      available,
      backend,
      weak: !available || backend === 'basic_text' || backend === 'unknown'
    }
  }

  function setKey(providerId, apiKey) {
    const all = readAll()
    const trimmed = String(apiKey || '').trim()
    if (!trimmed) {
      delete all[providerId]
    } else {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('Secure storage is not available on this system, so the API key cannot be saved')
      }
      all[providerId] = safeStorage.encryptString(trimmed).toString('base64')
    }
    store.set(STORE_KEY, all)
  }

  function getKey(providerId) {
    const encrypted = readAll()[providerId]
    if (!encrypted) return ''
    try {
      return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
    } catch {
      return '' // keyring changed or entry corrupted: treat as unset
    }
  }

  function keyStatus() {
    const all = readAll()
    return Object.fromEntries(Object.keys(all).map(id => [id, Boolean(all[id])]))
  }

  return { setKey, getKey, keyStatus, storageStatus }
}

module.exports = { createSecrets }
