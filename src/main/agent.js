/**
 * Agent loop for chat replies: the model may call web tools, see their
 * results and continue, but every run ends with a final text answer.
 *
 *   round 1..N   tools offered; tool calls are executed and their results
 *                appended, then the model is asked again
 *   last round   after maxSteps tool calls the tools are withdrawn
 *                (tool_choice "none") and the model is told to answer now
 *   empty answer the model is nudged once more without tools, then it fails
 *
 * Kept free of Electron imports so it can be unit tested.
 */
const { streamChat, LlmError } = require('./llm')
const { TOOL_DEFINITIONS, executeTool, describeCall } = require('./webTools')

const FINAL_ANSWER_NUDGE = 'You have used all available tool calls. Do not call any more tools. ' +
  'Write your final answer now, based on what you found; say clearly if something could not be verified.'
const EMPTY_ANSWER_NUDGE = 'Please write your final answer to my last message now, as text.'

/**
 * @param {object} params
 * @param {object} params.chat - streamChat parameters except messages/tools/onEvent
 *   ({ providerId, baseUrl, apiKey, model, temperature, sessionId, userAgent, signal })
 * @param {Array} params.messages - OpenAI-format messages
 * @param {boolean} params.webTools - offer web_search / web_fetch
 * @param {number} [params.maxSteps=6] - maximum tool calls per reply
 * @param {object} [params.toolOptions] - { apiKey, baseUrl } for Tavily
 * @param {(event: object) => void} params.onEvent
 *   { type: 'delta', content, reasoning }   answer text (may be intermediate, see reset)
 *   { type: 'reset' }                       text streamed so far was a preamble to tool calls
 *   { type: 'step', step }                  a tool call started ({ status: 'running' }) or finished
 *   { type: 'notice', message }             e.g. the model does not support tools
 * @returns {Promise<object>} streamChat result of the final round plus { toolSteps }
 */
async function runAgent({ chat, messages, webTools, maxSteps = 6, toolOptions = {}, onEvent }) {
  const conversation = [...messages]
  let toolsOn = Boolean(webTools)
  let toolsUsed = false
  let toolSteps = 0
  let nudged = false
  const emit = (event) => onEvent?.(event)

  for (;;) {
    const finalRound = !toolsOn || toolSteps >= maxSteps
    // Once the conversation contains tool calls, keep the definitions so the
    // history stays valid, but forbid further calls
    const tools = toolsOn || toolsUsed ? TOOL_DEFINITIONS : undefined
    let result
    try {
      result = await streamChat({
        ...chat,
        messages: conversation,
        tools,
        toolChoice: tools && finalRound ? 'none' : undefined,
        onEvent: (e) => { if (e.type === 'delta') emit(e) }
      })
    } catch (err) {
      if (err.code === 'tools_unsupported' && tools && !toolsUsed) {
        toolsOn = false
        emit({ type: 'reset' })
        emit({ type: 'notice', message: 'This model does not support tools, so it answered without web search.' })
        continue
      }
      throw err
    }

    if (!finalRound && result.toolCalls.length) {
      toolsUsed = true
      emit({ type: 'reset' })
      conversation.push({
        role: 'assistant',
        content: result.content || null,
        tool_calls: result.toolCalls.map(call => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: call.arguments || '{}' }
        }))
      })
      for (const call of result.toolCalls) {
        // Calls beyond the budget are answered without running them
        if (toolSteps >= maxSteps) {
          conversation.push({ role: 'tool', tool_call_id: call.id, content: 'Not run: the tool call limit was reached.' })
          continue
        }
        toolSteps++
        emit({ type: 'step', step: { id: call.id, ...describeCall(call.name, call.arguments), status: 'running' } })
        const { content, step } = await executeTool(call.name, call.arguments, { ...toolOptions, signal: chat.signal })
        emit({ type: 'step', step: { id: call.id, ...step } })
        conversation.push({ role: 'tool', tool_call_id: call.id, content })
      }
      if (toolSteps >= maxSteps) conversation.push({ role: 'user', content: FINAL_ANSWER_NUDGE })
      continue
    }

    if (!result.content.trim()) {
      if (!nudged) {
        nudged = true
        toolsOn = false
        emit({ type: 'reset' })
        conversation.push({ role: 'user', content: EMPTY_ANSWER_NUDGE })
        continue
      }
      throw new LlmError({ code: 'empty', message: 'The model did not return an answer' })
    }
    return { ...result, toolSteps }
  }
}

module.exports = { runAgent, FINAL_ANSWER_NUDGE, EMPTY_ANSWER_NUDGE }
