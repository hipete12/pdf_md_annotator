import {
  buildGenerateMessages, codeCellLanguages, extractQmd, formatTranscript, listCommands, parseCommand, DEFAULT_GENERATE_TEMPLATE
} from '../../src/common/docGen'

describe('docGen', () => {
  it('parses known commands only', () => {
    expect(parseCommand('/generate')).to.deep.equal({ name: 'generate', steer: '' })
    expect(parseCommand('  /generate focus on   entropy \n and examples')).to.deep.equal({ name: 'generate', steer: 'focus on   entropy \n and examples' })
    expect(parseCommand('/open')).to.deep.equal({ name: 'open', run: false })
    expect(parseCommand('/OPEN run')).to.deep.equal({ name: 'open', run: true })
    expect(parseCommand('/close')).to.deep.equal({ name: 'close' })
    expect(parseCommand('/open the pod bay doors')).to.equal(null)
    expect(parseCommand('/generated text')).to.equal(null)
    expect(parseCommand('/usr/bin is a folder')).to.equal(null)
    expect(parseCommand('please /generate')).to.equal(null)
  })

  it('suggests commands as they are typed', () => {
    expect(listCommands('/').map(c => c.name)).to.deep.equal(['generate', 'open', 'open run', 'close'])
    expect(listCommands('/o').map(c => c.name)).to.deep.equal(['open', 'open run'])
    expect(listCommands('/open r').map(c => c.name)).to.deep.equal(['open run'])
    expect(listCommands('/x')).to.deep.equal([])
  })

  it('formats the visible conversation, skipping failed replies and marking new parts', () => {
    const messages = [
      { id: 'u1', role: 'user', content: 'What is entropy?', contexts: [{ kind: 'reply', text: 'S = k ln W' }] },
      { id: 'a1', role: 'assistant', content: 'A measure of disorder.' },
      { id: 'u2', role: 'user', content: 'Why log?' },
      { id: 'a2', role: 'assistant', content: '', error: { code: 'http', message: 'x' } },
      { id: 'u3', role: 'user', content: 'Why log, again?' },
      { id: 'a3', role: 'assistant', content: 'Additivity.' }
    ]
    const text = formatTranscript(messages, { coveredMessageId: 'a1' })
    expect(text).to.equal([
      'User:\n> [quoted reply] S = k ln W\nWhat is entropy?',
      'Assistant:\nA measure of disorder.',
      '--- Everything below is new since the document was last generated ---',
      'User:\nWhy log?',
      'User:\nWhy log, again?',
      'Assistant:\nAdditivity.'
    ].join('\n\n'))
    expect(formatTranscript(messages.slice(0, 2), { coveredMessageId: 'a1' })).to.not.contain('new since')
  })

  it('fills the template with the conversation, document and steer', () => {
    const [system, user] = buildGenerateMessages({
      template: DEFAULT_GENERATE_TEMPLATE, title: 'untitled1', transcript: 'User:\nhi', currentDocument: '', steer: '  focus on proofs '
    })
    expect(system.role).to.equal('system')
    expect(user.content).to.contain('<conversation>\nUser:\nhi\n</conversation>')
    expect(user.content).to.contain('<current_document>\n(none yet)\n</current_document>')
    expect(user.content).to.contain('<steer>\nfocus on proofs\n</steer>')
    expect(user.content).to.contain('Use visualizations where you see fit')
  })

  it('extracts the .qmd from fenced or chatty replies and adds a header when missing', () => {
    const doc = '---\ntitle: Entropy\n---\n\n# Intro\n\n```{python}\nprint(1)\n```'
    expect(extractQmd(doc)).to.equal(`${doc}\n`)
    expect(extractQmd('```qmd\n' + doc + '\n```')).to.equal(`${doc}\n`)
    expect(extractQmd('````markdown\n' + doc + '\n````')).to.equal(`${doc}\n`)
    expect(extractQmd('Here is your document:\n\n' + doc)).to.equal(`${doc}\n`)
    expect(extractQmd('# Just markdown', 'untitled1')).to.match(/^---\ntitle: "untitled1"\n[\s\S]*---\n\n# Just markdown\n$/)
    expect(() => extractQmd('  ')).to.throw('empty')
  })

  it('lists executable code cell languages', () => {
    const qmd = '```{python}\nx\n```\n```{mermaid}\ngraph\n```\n```{r echo=FALSE}\ny\n```\n```python\nnot a cell\n```'
    expect(codeCellLanguages(qmd)).to.deep.equal(['python', 'r'])
  })
})
