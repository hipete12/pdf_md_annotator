import {
  chatBaseName, docPathFor, isChatFile, isPdfFile, nextUntitledName, withChatExtension
} from '../../src/common/chatFiles'

describe('chatFiles', () => {
  it('picks the lowest untitled number free for both the chat and its document', () => {
    expect(nextUntitledName([])).to.equal('untitled1')
    expect(nextUntitledName(['untitled1.chat', 'untitled2.chat'])).to.equal('untitled3')
    // A leftover document also blocks the name
    expect(nextUntitledName(['untitled1.chat', 'untitled2.qmd'])).to.equal('untitled3')
    expect(nextUntitledName(['untitled2.chat', 'notes.chat'])).to.equal('untitled1')
    expect(nextUntitledName(['Untitled1.CHAT'])).to.equal('untitled2')
  })

  it('derives names and document paths', () => {
    expect(chatBaseName('/a/b/untitled3.chat')).to.equal('untitled3')
    expect(chatBaseName('C:\\chats\\Physics.chat')).to.equal('Physics')
    expect(docPathFor('/a/b/untitled3.chat')).to.equal('/a/b/untitled3.qmd')
    expect(withChatExtension('/a/notes')).to.equal('/a/notes.chat')
    expect(withChatExtension('/a/notes.chat')).to.equal('/a/notes.chat')
  })

  it('recognises file kinds', () => {
    expect(isChatFile('/x/a.chat')).to.equal(true)
    expect(isChatFile('/x/a.pdf')).to.equal(false)
    expect(isPdfFile('/x/A.PDF')).to.equal(true)
  })
})
