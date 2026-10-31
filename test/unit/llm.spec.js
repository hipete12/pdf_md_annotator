/**
 * Unit tests for the LLM helpers (src/common/llm.js) and the main-process
 * client (src/main/llm.js), the latter against a local fake server.
 */
import http from 'http'
import {
  guessVisionSupport,
  normalizeModelList,
  resolveVisionSupport,
  createSseParser,
  describeHttpError,
  describeNetworkError,
  joinUrl,
  LLM_PROVIDERS
} from '../../src/common/llm'
import { DEFAULT_SETTINGS } from '../../src/common/constants'
const { listModels, streamChat } = require('../../src/main/llm')

describe('LLM helpers', () => {
  describe('guessVisionSupport', () => {
    it('recognizes common vision models', () => {
      for (const id of ['gpt-4o-mini', 'openai/gpt-4.1', 'llava:13b', 'qwen2.5-vl-7b-instruct',
        'gemma3:12b', 'anthropic/claude-3.5-sonnet', 'google/gemini-2.0-flash', 'o3', 'openai/o4-mini']) {
        expect(guessVisionSupport(id), id).to.equal(true)
      }
    })

    it('returns null (unknown) for others', () => {
      for (const id of ['llama3.1:8b', 'gpt-3.5-turbo', 'mistral:7b', 'deepseek-r1']) {
        expect(guessVisionSupport(id), id).to.equal(null)
      }
    })
  })

  describe('normalizeModelList', () => {
    it('uses OpenRouter input modalities and context length', () => {
      const models = normalizeModelList({
        data: [
          { id: 'x/text', name: 'Text Model', context_length: 8192, architecture: { input_modalities: ['text'] } },
          { id: 'x/vis', name: 'A Vision Model', context_length: '128000', architecture: { input_modalities: ['text', 'image'] } }
        ]
      })
      expect(models.map(m => m.id)).to.deep.equal(['x/vis', 'x/text']) // sorted by name
      expect(models[0]).to.include({ vision: true, visionSource: 'provider', contextLength: 128000 })
      expect(models[1]).to.include({ vision: false, visionSource: 'provider', contextLength: 8192 })
    })

    it('guesses for plain OpenAI-compatible lists and drops non-chat models', () => {
      const models = normalizeModelList({
        data: [{ id: 'gpt-4o' }, { id: 'text-embedding-3-small' }, { id: 'whisper-1' }, { id: 'llama3.1:8b' }]
      })
      expect(models.map(m => m.id)).to.deep.equal(['gpt-4o', 'llama3.1:8b'])
      expect(models[0]).to.include({ vision: true, visionSource: 'guess' })
      expect(models[1]).to.include({ vision: null, visionSource: 'unknown' })
    })

    it('tolerates odd shapes', () => {
      expect(normalizeModelList(null)).to.deep.equal([])
      expect(normalizeModelList({ data: [{}, null, 'm1'] }).map(m => m.id)).to.deep.equal(['m1'])
    })
  })

  describe('resolveVisionSupport', () => {
    it('prefers the user override', () => {
      const model = { id: 'm', vision: null }
      expect(resolveVisionSupport(model, { m: true }, 'm')).to.equal(true)
      expect(resolveVisionSupport({ id: 'm', vision: true }, { m: false }, 'm')).to.equal(false)
      expect(resolveVisionSupport(model, {}, 'm')).to.equal(null)
      expect(resolveVisionSupport(undefined, {}, 'gpt-4o')).to.equal(true)
    })
  })

  describe('createSseParser', () => {
    it('parses deltas split across chunks, meta, and DONE', () => {
      const events = []
      const parser = createSseParser(e => events.push(e))
      parser.feed('data: {"choices":[{"delta":{"content":"Hel')
      parser.feed('lo"}}]}\n\n: keep-alive\n\ndata: {"choices":[{"delta":{"reasoning":"hmm"}}]}\r\n')
      parser.feed('data: {"model":"m","choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"total_tokens":5}}\n')
      parser.feed('data: [DONE]\n')
      parser.end()
      expect(events).to.deep.equal([
        { type: 'delta', content: 'Hello', reasoning: '' },
        { type: 'delta', content: '', reasoning: 'hmm' },
        { type: 'meta', model: 'm', usage: { total_tokens: 5 }, finishReason: 'stop' },
        { type: 'done' }
      ])
    })

    it('reports in-stream errors', () => {
      const events = []
      const parser = createSseParser(e => events.push(e))
      parser.feed('data: {"error":{"message":"overloaded"}}\n')
      expect(events).to.deep.equal([{ type: 'error', message: 'overloaded' }])
    })

    it('flushes a final line without trailing newline on end()', () => {
      const events = []
      const parser = createSseParser(e => events.push(e))
      parser.feed('data: {"choices":[{"delta":{"content":"x"}}]}')
      expect(events).to.have.length(0)
      parser.end()
      expect(events).to.have.length(1)
    })
  })

  describe('error descriptions', () => {
    it('maps HTTP statuses to codes', () => {
      expect(describeHttpError(401, '{"error":{"message":"bad key"}}', 'OpenAI')).to.deep.equal({
        code: 'auth', message: 'OpenAI rejected the API key (HTTP 401): bad key'
      })
      expect(describeHttpError(400, '{"error":{"message":"This model does not support image input"}}', 'X').code).to.equal('image_unsupported')
      expect(describeHttpError(400, '{"error":{"message":"maximum context length exceeded"}}', 'X').code).to.equal('context_length')
      expect(describeHttpError(429, '', 'X').code).to.equal('rate_limit')
      expect(describeHttpError(500, 'boom', 'X')).to.deep.equal({ code: 'http', message: 'X returned HTTP 500: boom' })
    })

    it('gives local-server hints for refused connections', () => {
      const err = Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } })
      expect(describeNetworkError(err, 'http://localhost:11434/v1', LLM_PROVIDERS.ollama).message)
        .to.include('Is Ollama running')
      expect(describeNetworkError(Object.assign(new Error('x'), { name: 'AbortError' })).code).to.equal('aborted')
    })
  })

  it('joinUrl avoids double slashes', () => {
    expect(joinUrl('http://a/v1/', '/models')).to.equal('http://a/v1/models')
    expect(joinUrl('http://a/v1', 'chat/completions')).to.equal('http://a/v1/chat/completions')
  })

  it('default settings include llm and chat sections', () => {
    expect(DEFAULT_SETTINGS.llm.baseUrls.ollama).to.equal('http://localhost:11434/v1')
    expect(DEFAULT_SETTINGS.llm.models).to.have.all.keys(Object.keys(LLM_PROVIDERS))
    expect(DEFAULT_SETTINGS.llm.systemTemplate).to.include('{{document}}')
    expect(DEFAULT_SETTINGS.chat.visionEnabled).to.equal(false)
  })
})

describe('LLM client (fake server)', () => {
  let server
  let baseUrl
  let lastRequest
  let handler

  before(async () => {
    server = http.createServer((req, res) => {
      let body = ''
      req.on('data', c => { body += c })
      req.on('end', () => {
        lastRequest = { method: req.method, url: req.url, headers: req.headers, body: body ? JSON.parse(body) : null }
        handler(req, res, lastRequest)
      })
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    baseUrl = `http://127.0.0.1:${server.address().port}/v1`
  })

  after(() => new Promise(resolve => server.close(resolve)))

  const sse = (res, events, { delayMs = 0 } = {}) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    let i = 0
    const next = () => {
      if (i >= events.length) return res.end()
      res.write(`data: ${typeof events[i] === 'string' ? events[i] : JSON.stringify(events[i])}\n\n`)
      i++
      setTimeout(next, delayMs)
    }
    next()
  }

  it('lists models with the API key and OpenRouter headers', async () => {
    handler = (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ data: [{ id: 'a/b', name: 'B', architecture: { input_modalities: ['text', 'image'] } }] }))
    }
    const models = await listModels({ providerId: 'openrouter', baseUrl, apiKey: 'sk-test' })
    expect(lastRequest.url).to.equal('/v1/models')
    expect(lastRequest.headers.authorization).to.equal('Bearer sk-test')
    expect(lastRequest.headers['x-title']).to.equal('PDF Annotator')
    expect(models).to.have.length(1)
    expect(models[0].vision).to.equal(true)
  })

  it('requires a key for hosted providers but not for local ones', async () => {
    let error
    try { await listModels({ providerId: 'openai', baseUrl, apiKey: '' }) } catch (e) { error = e }
    expect(error.code).to.equal('auth')

    handler = (req, res) => {
      if (req.url === '/api/show') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        return res.end(JSON.stringify({ capabilities: lastRequest.body.model === 'llava' ? ['completion', 'vision'] : ['completion'] }))
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ data: [{ id: 'llava' }, { id: 'llama3.1' }] }))
    }
    const models = await listModels({ providerId: 'ollama', baseUrl, apiKey: '' })
    expect(lastRequest.headers.authorization).to.equal(undefined)
    const byId = Object.fromEntries(models.map(m => [m.id, m]))
    expect(byId.llava).to.include({ vision: true, visionSource: 'provider' })
    expect(byId['llama3.1']).to.include({ vision: false, visionSource: 'provider' })
  })

  it('streams a chat completion', async () => {
    handler = (req, res) => sse(res, [
      { choices: [{ delta: { content: 'Hi ' } }] },
      { choices: [{ delta: { content: 'there' } }] },
      { model: 'm1', choices: [{ delta: {}, finish_reason: 'stop' }] },
      '[DONE]'
    ])
    const deltas = []
    const result = await streamChat({
      providerId: 'custom',
      baseUrl,
      model: 'm1',
      messages: [{ role: 'user', content: 'hello' }],
      temperature: 0.2,
      onEvent: e => { if (e.type === 'delta') deltas.push(e.content) }
    })
    expect(lastRequest.url).to.equal('/v1/chat/completions')
    expect(lastRequest.body).to.deep.equal({
      model: 'm1', messages: [{ role: 'user', content: 'hello' }], stream: true, temperature: 0.2
    })
    expect(deltas).to.deep.equal(['Hi ', 'there'])
    expect(result).to.include({ content: 'Hi there', model: 'm1', finishReason: 'stop' })
  })

  it('maps HTTP errors', async () => {
    handler = (req, res) => {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end('{"error":{"message":"Invalid key"}}')
    }
    let error
    try {
      await streamChat({ providerId: 'openai', baseUrl, apiKey: 'bad', model: 'm', messages: [] })
    } catch (e) { error = e }
    expect(error.code).to.equal('auth')
    expect(error.message).to.include('Invalid key')
  })

  it('surfaces errors sent inside the stream', async () => {
    handler = (req, res) => sse(res, [{ choices: [{ delta: { content: 'part' } }] }, { error: { message: 'Provider overloaded' } }])
    let error
    try {
      await streamChat({ providerId: 'custom', baseUrl, model: 'm', messages: [] })
    } catch (e) { error = e }
    expect(error.code).to.equal('stream')
    expect(error.message).to.equal('Provider overloaded')
  })

  it('can be aborted mid-stream', async () => {
    handler = (req, res) => sse(res, Array.from({ length: 50 }, (_, i) => ({ choices: [{ delta: { content: `${i} ` } }] })), { delayMs: 20 })
    const controller = new AbortController()
    let count = 0
    let error
    try {
      await streamChat({
        providerId: 'custom',
        baseUrl,
        model: 'm',
        messages: [],
        signal: controller.signal,
        onEvent: () => { if (++count === 3) controller.abort() }
      })
    } catch (e) { error = e }
    expect(error.code).to.equal('aborted')
    expect(count).to.be.lessThan(10)
  })

  it('reports refused connections', async () => {
    // Grab a free port and close it again so nothing is listening there
    const probe = http.createServer()
    await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve))
    const port = probe.address().port
    await new Promise(resolve => probe.close(resolve))

    for (const host of ['127.0.0.1', 'localhost']) {
      let error
      try {
        await listModels({ providerId: 'lmstudio', baseUrl: `http://${host}:${port}/v1`, apiKey: '' })
      } catch (e) { error = e }
      expect(error.code, host).to.equal('connection')
      expect(error.message).to.include('LM Studio')
    }
  })

  it('unwraps AggregateError causes', () => {
    const err = Object.assign(new Error('fetch failed'), {
      cause: { errors: [{ code: 'ECONNREFUSED' }, { code: 'ECONNREFUSED' }] }
    })
    expect(describeNetworkError(err, 'http://localhost:11434/v1', LLM_PROVIDERS.ollama).code).to.equal('connection')
  })
})
