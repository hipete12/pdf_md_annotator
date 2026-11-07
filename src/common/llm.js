/**
 * LLM provider definitions and pure helpers shared by the main process (which
 * makes the requests) and the renderer (settings UI, prompt building).
 * Every supported provider speaks the OpenAI-compatible Chat Completions API.
 */

export const LLM_PROVIDERS = Object.freeze({
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    requiresKey: true,
    local: false
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    requiresKey: true,
    local: false
  },
  opencodego: {
    id: 'opencodego',
    label: 'OpenCode Go',
    baseUrl: 'https://opencode.ai/inference/go/openai/v1',
    // Model list is not under the chat base URL
    modelsUrl: 'https://opencode.ai/inference/go/v1/models',
    // The model list is public, so models can be browsed before adding a
    // key (a saved key is still sent, which validates it)
    publicModels: true,
    requiresKey: true,
    local: false,
    // Go rejects chat requests without a stable per-conversation session id
    // (error type MissingSessionID); it uses it for routing and prompt caching
    sessionHeader: 'x-opencode-session'
  },
  ollama: {
    id: 'ollama',
    label: 'Ollama (local)',
    baseUrl: 'http://localhost:11434/v1',
    requiresKey: false,
    local: true
  },
  lmstudio: {
    id: 'lmstudio',
    label: 'LM Studio (local)',
    baseUrl: 'http://localhost:1234/v1',
    requiresKey: false,
    local: true
  },
  custom: {
    id: 'custom',
    label: 'Custom (OpenAI-compatible)',
    baseUrl: '',
    requiresKey: false,
    local: false
  }
})

export const LLM_PROVIDER_IDS = Object.keys(LLM_PROVIDERS)

export const DEFAULT_SYSTEM_TEMPLATE = `You are a study assistant helping the user understand the PDF document "{{title}}".
- Base your answers on the document text below and cite pages as (p. N).
- If the document does not cover the question, say so before using outside knowledge.
- Use Markdown. Wrap all mathematics in LaTeX: $...$ for inline and $$...$$ for display math.
- Be concise by default; go deeper when the user asks.

When the user attaches context, it appears in <selected_context>, labelled by source:
- "PDF excerpt": text quoted from the document on that page.
- "user's note": the user's own annotation on that page; it may be a question or an unverified idea, not part of the document.
- "your earlier reply": something you wrote earlier in this conversation; re-check it rather than assuming it was correct.
Focus your answer on the attached context.

<document>
{{document}}
</document>`

// Earlier default system templates. Saved settings that still contain one of
// these unchanged are upgraded to the current default; edited ones are kept.
export const PREVIOUS_SYSTEM_TEMPLATES = [
  `You are a study assistant helping the user understand the PDF document "{{title}}".
- Base your answers on the document text below and cite pages as (p. N).
- If the document does not cover the question, say so before using outside knowledge.
- Use Markdown. Wrap all mathematics in LaTeX: $...$ for inline and $$...$$ for display math.
- Be concise by default; go deeper when the user asks.

<document>
{{document}}
</document>`
]

export const DEFAULT_STANDALONE_SYSTEM_TEMPLATE = `You are a patient tutor helping the user understand concepts.
- Build on what the user already knows; use concrete examples, analogies and step-by-step reasoning.
- Check for likely misconceptions and address them directly.
- Use Markdown. Wrap all mathematics in LaTeX: $...$ for inline and $$...$$ for display math.
- Be concise by default; go deeper when the user asks.
- Say so when something is uncertain or contested.

When the user attaches context, it appears in <selected_context>. "your earlier reply" is something you wrote earlier in this conversation; re-check it rather than assuming it was correct.`

export const DEFAULT_USER_TEMPLATE = `{{selections}}
{{input}}`

// Model ids that are known to accept image input. Used only when the provider
// does not report capabilities itself (OpenRouter does).
const VISION_MODEL_PATTERNS = [
  /gpt-4o/, /gpt-4\.1/, /gpt-4-turbo/, /gpt-4-vision/, /gpt-5/, /chatgpt-4o/,
  /(^|\/)o[134](-|$)/, /vision/, /[-_.]vl([-_.:]|$)/, /llava/, /bakllava/,
  /moondream/, /minicpm-v/, /gemma-?3/, /pixtral/, /claude-3/,
  /claude-(sonnet|opus|haiku)-4/, /claude-[0-9.]+-(sonnet|opus|haiku)/,
  /gemini/, /llama-?3\.2-vision/, /llama-?4/, /mistral-small-3/, /granite.*vision/
]

// Model ids that are not chat models (OpenAI lists these under /models)
const NON_CHAT_PATTERNS = [
  /embed/, /whisper/, /tts/, /dall-e/, /moderation/, /^davinci/, /^babbage/,
  /transcribe/, /^gpt-image/, /realtime/, /^sora/
]

/**
 * Guess whether a model accepts images from its id.
 * @param {string} modelId
 * @returns {boolean|null} true when it looks like a vision model, null when unknown
 */
export function guessVisionSupport(modelId) {
  const id = String(modelId || '').toLowerCase()
  return VISION_MODEL_PATTERNS.some(re => re.test(id)) ? true : null
}

/**
 * Normalize a GET /models response into a sorted list of chat models.
 * Handles OpenRouter (reports input modalities and context length) and plain
 * OpenAI-compatible servers (ids only).
 * @param {object} body - Parsed JSON response
 * @returns {Array<{id: string, name: string, contextLength: number|null, vision: boolean|null, visionSource: string}>}
 */
export function normalizeModelList(body) {
  const items = Array.isArray(body?.data) ? body.data : (Array.isArray(body) ? body : [])
  const models = []
  for (const item of items) {
    const id = typeof item === 'string' ? item : item?.id
    if (!id) continue
    if (NON_CHAT_PATTERNS.some(re => re.test(id.toLowerCase()))) continue

    // Skip entries that declare a non-chat type (e.g. embeddings)
    if (typeof item?.type === 'string' && !['chat', 'llm', 'vlm'].includes(item.type)) continue

    // OpenRouter: architecture.input_modalities ['text', 'image'];
    // OpenCode: modalities.input ['text', 'image/jpeg', ...]
    const modalities = item?.architecture?.input_modalities || item?.modalities?.input
    let vision
    let visionSource
    if (Array.isArray(modalities)) {
      vision = modalities.some(m => typeof m === 'string' && m.startsWith('image'))
      visionSource = 'provider'
    } else {
      vision = guessVisionSupport(id)
      visionSource = vision === null ? 'unknown' : 'guess'
    }

    models.push({
      id,
      name: item?.name || id,
      contextLength: Number(item?.context_length || item?.limit?.context) || null,
      vision,
      visionSource
    })
  }
  return models.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Resolve whether a model supports images: user override > provider/guess.
 * @param {object|undefined} model - Entry from normalizeModelList
 * @param {object} overrides - settings.llm.visionOverrides
 * @param {string} modelId
 * @returns {boolean|null}
 */
export function resolveVisionSupport(model, overrides, modelId) {
  const override = overrides?.[modelId]
  if (override === true || override === false) return override
  if (model && model.vision !== undefined) return model.vision
  return guessVisionSupport(modelId)
}

/**
 * Incremental parser for an OpenAI-style server-sent events stream.
 * Feed it decoded text chunks; it calls onEvent for every complete event:
 *   { type: 'delta', content, reasoning }  text/reasoning tokens
 *   { type: 'error', message }             error object sent inside the stream
 *   { type: 'done' }                       the [DONE] sentinel
 *   { type: 'meta', model, usage, finishReason }
 * @param {(event: object) => void} onEvent
 * @returns {{ feed: (chunk: string) => void, end: () => void }}
 */
export function createSseParser(onEvent) {
  let buffer = ''

  const handleData = (data) => {
    if (data === '[DONE]') {
      onEvent({ type: 'done' })
      return
    }
    let json
    try {
      json = JSON.parse(data)
    } catch {
      return // ignore malformed / partial keep-alive lines
    }
    if (json.error) {
      onEvent({ type: 'error', message: json.error.message || JSON.stringify(json.error) })
      return
    }
    const choice = json.choices?.[0]
    const delta = choice?.delta || {}
    const content = typeof delta.content === 'string' ? delta.content : ''
    const reasoning = delta.reasoning || delta.reasoning_content || ''
    if (content || reasoning) onEvent({ type: 'delta', content, reasoning })
    if (json.usage || choice?.finish_reason) {
      onEvent({
        type: 'meta',
        model: json.model || null,
        usage: json.usage || null,
        finishReason: choice?.finish_reason || null
      })
    }
  }

  const processLines = (flushAll) => {
    const lines = buffer.split(/\r?\n/)
    buffer = flushAll ? '' : lines.pop()
    for (const line of lines) {
      if (!line.startsWith('data:')) continue // comments (": keep-alive"), event:, id:
      handleData(line.slice(5).trim())
    }
  }

  return {
    feed(chunk) {
      buffer += chunk
      processLines(false)
    },
    end() {
      processLines(true)
    }
  }
}

/**
 * Turn an HTTP error response into a user-facing message and a code.
 * @param {number} status
 * @param {string} bodyText
 * @param {string} providerLabel
 * @returns {{ code: string, message: string }}
 */
export function describeHttpError(status, bodyText, providerLabel) {
  let detail = ''
  try {
    const json = JSON.parse(bodyText)
    detail = json?.error?.message || json?.message || json?.detail || ''
    if (typeof detail !== 'string') detail = JSON.stringify(detail)
  } catch {
    detail = (bodyText || '').slice(0, 300)
  }
  const suffix = detail ? `: ${detail}` : ''

  if (status === 401 || status === 403) {
    return { code: 'auth', message: `${providerLabel} rejected the API key (HTTP ${status})${suffix}` }
  }
  if (status === 404) {
    return { code: 'not_found', message: `Not found (HTTP 404) – check the base URL and model name${suffix}` }
  }
  if (status === 429) {
    return { code: 'rate_limit', message: `Rate limited or out of credits (HTTP 429)${suffix}` }
  }
  if (status === 400 && /image|vision|multimodal|modalit/i.test(detail)) {
    return { code: 'image_unsupported', message: `This model does not accept images${suffix}` }
  }
  if (status === 400 && /context|too long|maximum.*tokens|token limit/i.test(detail)) {
    return { code: 'context_length', message: `The request is too long for this model${suffix}` }
  }
  return { code: 'http', message: `${providerLabel} returned HTTP ${status}${suffix}` }
}

/**
 * Turn a fetch/network error into a user-facing message and a code.
 * @param {Error} err
 * @param {string} baseUrl
 * @param {object} provider - Entry from LLM_PROVIDERS
 * @returns {{ code: string, message: string }}
 */
export function describeNetworkError(err, baseUrl, provider) {
  if (err?.name === 'AbortError') return { code: 'aborted', message: 'Request cancelled' }
  // Node may wrap per-address failures (IPv4 + IPv6 for "localhost") in an
  // AggregateError, so look inside cause.errors too.
  const nested = Array.isArray(err?.cause?.errors) ? err.cause.errors.map(e => e?.code) : []
  const causeCode = err?.cause?.code || nested.find(Boolean) || err?.code || ''
  if (causeCode === 'ECONNREFUSED') {
    const hint = provider?.id === 'ollama'
      ? ' Is Ollama running (ollama serve)?'
      : provider?.id === 'lmstudio'
        ? ' Is the LM Studio server started?'
        : ''
    return { code: 'connection', message: `Could not connect to ${baseUrl}.${hint}` }
  }
  if (causeCode === 'ENOTFOUND' || causeCode === 'EAI_AGAIN') {
    return { code: 'connection', message: `Could not resolve the host for ${baseUrl}. Check the URL and your connection.` }
  }
  return { code: 'network', message: `Network error contacting ${baseUrl}: ${err?.cause?.message || err?.message || err}` }
}

/**
 * URL of the model list for a provider. Usually <baseUrl>/models; OpenCode Go
 * serves it from .../go/v1/models while chat lives under .../go/openai/v1.
 */
export function getModelsUrl(provider, baseUrl) {
  if (provider?.modelsUrl) {
    if (!baseUrl || baseUrl.replace(/\/+$/, '') === provider.baseUrl) return provider.modelsUrl
    if (provider.id === 'opencodego' && /\/openai\/v1\/?$/.test(baseUrl)) {
      return baseUrl.replace(/\/openai\/v1\/?$/, '/v1/models')
    }
  }
  return joinUrl(baseUrl, 'models')
}

/**
 * Join a base URL and a path without doubling slashes.
 */
export function joinUrl(baseUrl, path) {
  return `${String(baseUrl || '').replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}
