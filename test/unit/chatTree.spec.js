/**
 * Unit tests for the conversation tree helpers
 */
import {
  childrenOf, activePath, ancestorsOf, siblingsOf, pointersToShow, subtreeIds, normalizeTree, layoutBranchMap
} from '../../src/renderer/utils/chatTree'

// u1 → a1 → u2 → a2
//            └→ u2b → a2b   (edit of u2; currently shown)
// └→ u1b → a1b               (edit of u1)
function sampleSession() {
  const m = (id, role, parentId, activeChildId = null, content = id) => ({ id, role, parentId, activeChildId, content })
  return {
    rootActiveId: 'u1',
    messages: [
      m('u1', 'user', null, 'a1'),
      m('a1', 'assistant', 'u1', 'u2b'),
      m('u2', 'user', 'a1', 'a2'),
      m('a2', 'assistant', 'u2'),
      m('u1b', 'user', null, 'a1b'),
      m('a1b', 'assistant', 'u1b'),
      m('u2b', 'user', 'a1', 'a2b'),
      m('a2b', 'assistant', 'u2b')
    ]
  }
}

const ids = (list) => list.map(m => m.id)

describe('chatTree', () => {
  it('follows the active pointers', () => {
    expect(ids(activePath(sampleSession()))).to.deep.equal(['u1', 'a1', 'u2b', 'a2b'])
  })

  it('falls back to the newest child for missing pointers', () => {
    const s = sampleSession()
    s.rootActiveId = null
    s.messages.find(m => m.id === 'u1b').activeChildId = 'gone'
    expect(ids(activePath(s))).to.deep.equal(['u1b', 'a1b'])
    expect(activePath(null)).to.deep.equal([])
  })

  it('finds children, ancestors and siblings', () => {
    const s = sampleSession()
    expect(ids(childrenOf(s, null))).to.deep.equal(['u1', 'u1b'])
    expect(ids(ancestorsOf(s, 'a2'))).to.deep.equal(['u1', 'a1', 'u2'])
    expect(ids(siblingsOf(s, s.messages.find(m => m.id === 'u2')))).to.deep.equal(['u2', 'u2b'])
  })

  it('computes pointer updates that show a branch, keeping pointers below it', () => {
    const s = sampleSession()
    expect(pointersToShow(s, 'u2')).to.deep.equal([
      { parentId: null, childId: 'u1' },
      { parentId: 'u1', childId: 'a1' },
      { parentId: 'a1', childId: 'u2' }
    ])
    expect(pointersToShow(s, 'missing')).to.deep.equal([])
  })

  it('collects a subtree', () => {
    expect([...subtreeIds(sampleSession(), 'u2b')].sort()).to.deep.equal(['a2b', 'u2b'])
    expect([...subtreeIds(sampleSession(), 'u1')].sort()).to.deep.equal(['a1', 'a2', 'a2b', 'u1', 'u2', 'u2b'])
  })

  it('converts flat (pre-branching) sessions into a chain', () => {
    const { messages, rootActiveId } = normalizeTree([
      { id: 'x', role: 'user', content: 'q' },
      { id: 'y', role: 'assistant', content: 'a' },
      { id: 'z', role: 'user', content: 'q2' }
    ])
    expect(rootActiveId).to.equal('x')
    expect(messages.map(m => [m.id, m.parentId, m.activeChildId])).to.deep.equal([
      ['x', null, 'y'], ['y', 'x', 'z'], ['z', 'y', null]
    ])
    expect(ids(activePath({ messages, rootActiveId }))).to.deep.equal(['x', 'y', 'z'])
  })

  it('repairs broken references', () => {
    const { messages, rootActiveId } = normalizeTree([
      { id: 'a', role: 'user', parentId: null, activeChildId: 'nope' },
      { id: 'b', role: 'assistant', parentId: 'missing' }
    ], 'gone')
    expect(rootActiveId).to.equal(null)
    expect(messages[0].activeChildId).to.equal(null)
    expect(messages[1].parentId).to.equal(null)
  })

  it('lays out user turns with branches in new columns', () => {
    const { nodes, columns, depth } = layoutBranchMap(sampleSession())
    const byId = Object.fromEntries(nodes.map(n => [n.id, n]))
    expect(columns).to.equal(3)
    expect(depth).to.equal(2)
    expect(byId.u1).to.include({ depth: 1, column: 0, active: true, siblingIndex: 1, siblingCount: 2 })
    expect(byId.u2).to.include({ depth: 2, column: 0, parentNodeId: 'u1', active: false })
    expect(byId.u2b).to.include({ depth: 2, column: 1, parentNodeId: 'u1', active: true, siblingIndex: 2 })
    expect(byId.u1b).to.include({ depth: 1, column: 2, parentNodeId: null, active: false })
    expect(nodes.every(n => n.excerpt)).to.equal(true)
  })
})
