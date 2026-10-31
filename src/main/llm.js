/**
 * Network side of the LLM integration (main process). Kept free of Electron
 * imports so it can be unit tested against a local HTTP server.
 */
const {
  LLM_PROVIDERS,
  normalizeModelList,
  createSseParser,
  describeHttpError,
  describeNetworkError,
  joinUrl
} = require('../common/llm')

const APP_REFERER = 'https://github.com/hipete12/pdf_md_annotator'
const APP_TITLE = 'PDF Annotator'

class LlmError extends Error {
  constructor({ code, message }) {
    super(message)
    this.code = code
  }
}

function getProvider(providerId) {
  const provider = LLM_PROVIDERS[providerId]
  if (!provider) throw new LlmError({ code: 'config', message: `Unknown provider "${providerId}"` })
  return provider
}

function buildHeaders(provider, apiKey) {
  const headers = { 'Content-Type': 'application/json' }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  if (provider.id === 'openrouter') {
    headers['HTTP-Referer'] = APP_REFERER
    headers['X-Title'] = APP_TITLE
  }
  return headers
}

async function request(provider, baseUrl, path, options) {
  if (!baseUrl) throw new LlmError({ code: 'config', message: 'No base URL configured for this provider' })
  let response
  try {
    response = await fetch(joinUrl(baseUrl, path), options)
  } catch (err) {
    throw new LlmError(describeNetworkError(err, baseUrl, provider))
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new LlmError(describeHttpError(response.status, text, provider.label))
  }
  return response
}

// Local servers expose richer model info than their OpenAI-compatible
// /models endpoint; use it (best effort) to detect vision support.
async function enrichLocalVision(provider, baseUrl, models, signal) {
  const origin = String(baseUrl).replace(/\/v1\/?$/, '')
  try {
    if (provider.id === 'ollama') {
      await Promise.all(models.map(async (model) => {
        const res = await fetch(`${origin}/api/show`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: model.id }),
          signal
        })
        if (!res.ok) return
        const info = await res.json()
        if (Array.isArray(info.capabilities)) {
          model.vision = info.capabilities.includes('vision')
          model.visionSource = 'provider'
        }
      }))
    } else if (provider.id === 'lmstudio') {
      const res = await fetch(`${origin}/api/v0/models`, { signal })
      if (!res.ok) return
      const info = await res.json()
      const byId = new Map((info.data || []).map(m => [m.id, m]))
      for (const model of models) {
        const entry = byId.get(model.id)
        if (entry?.type) {
          model.vision = entry.type === 'vlm'
          model.visionSource = 'provider'
        }
        if (entry?.max_context_length) model.contextLength = entry.max_context_length
      }
    }
  } catch {
    // Older server versions: keep the name-based guess
  }
}

/**
 * List chat models for a provider.
 * @returns {Promise<Array>} normalized models (see normalizeModelList)
 */
async function listModels({ providerId, baseUrl, apiKey, timeoutMs = 15000 }) {
  const provider = getProvider(providerId)
  if (provider.requiresKey && !apiKey) {
    throw new LlmError({ code: 'auth', message: `Add your ${provider.label} API key first` })
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await request(provider, baseUrl, 'models', {
      headers: buildHeaders(provider, apiKey),
      signal: controller.signal
    })
    const models = normalizeModelList(await response.json())
    if (provider.local) await enrichLocalVision(provider, baseUrl, models, controller.signal)
    return models
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new LlmError({ code: 'timeout', message: `Timed out contacting ${baseUrl}` })
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Stream a chat completion.
 * @param {object} params
 * @param {string} params.providerId
 * @param {string} params.baseUrl
 * @param {string} [params.apiKey]
 * @param {string} params.model
 * @param {Array} params.messages - OpenAI-format messages
 * @param {number} [params.temperature]
 * @param {AbortSignal} [params.signal]
 * @param {(event: object) => void} params.onEvent - receives parser events
 * @returns {Promise<{ content: string, reasoning: string, model: string|null, usage: object|null, finishReason: string|null }>}
 */
async function streamChat({ providerId, baseUrl, apiKey, model, messages, temperature, signal, onEvent }) {
  const provider = getProvider(providerId)
  if (provider.requiresKey && !apiKey) {
    throw new LlmError({ code: 'auth', message: `Add your ${provider.label} API key in Settings` })
  }
  if (!model) throw new LlmError({ code: 'config', message: 'Choose a model in Settings first' })

  const body = { model, messages, stream: true }
  if (typeof temperature === 'number') body.temperature = temperature

  const response = await request(provider, baseUrl, 'chat/completions', {
    method: 'POST',
    headers: buildHeaders(provider, apiKey),
    body: JSON.stringify(body),
    signal
  })

  const result = { content: '', reasoning: '', model: null, usage: null, finishReason: null }
  let streamError = null
  const parser = createSseParser((event) => {
    if (event.type === 'delta') {
      result.content += event.content
      result.reasoning += event.reasoning
    } else if (event.type === 'meta') {
      result.model = event.model || result.model
      result.usage = event.usage || result.usage
      result.finishReason = event.finishReason || result.finishReason
    } else if (event.type === 'error') {
      streamError = event.message
    }
    onEvent?.(event)
  })

  const decoder = new TextDecoder()
  try {
    for await (const chunk of response.body) {
      parser.feed(decoder.decode(chunk, { stream: true }))
    }
    parser.feed(decoder.decode())
    parser.end()
  } catch (err) {
    throw new LlmError(describeNetworkError(err, baseUrl, provider))
  }

  if (streamError) throw new LlmError({ code: 'stream', message: streamError })
  return result
}

module.exports = { listModels, streamChat, LlmError }
