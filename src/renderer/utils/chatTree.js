/**
 * Conversation tree helpers for chat sessions.
 *
 * A session stores every message ever created in `messages` (insertion order).
 * Each message has `parentId` (null for the first turn) so edits/regenerations
 * create siblings instead of overwriting. Which branch is shown is recorded by
 * pointers: `session.rootActiveId` for the first turn and `message.activeChildId`
 * below that. Following the pointers from the top gives the visible path; each
 * fork therefore remembers the branch that was last shown under it.
 */

/** Children of a message (or of the session root when parentId is null), oldest first. */
export function childrenOf(session, parentId) {
  return session.messages.filter(m => (m.parentId ?? null) === parentId)
}

function byId(session) {
  return new Map(session.messages.map(m => [m.id, m]))
}

/** The visible conversation: root → leaf following the active pointers. */
export function activePath(session) {
  if (!session) return []
  const path = []
  const seen = new Set()
  let parentId = null
  let pointer = session.rootActiveId
  for (;;) {
    const children = childrenOf(session, parentId)
    if (children.length === 0) break
    // Missing/stale pointer: fall back to the newest child
    const next = children.find(c => c.id === pointer) || children[children.length - 1]
    if (seen.has(next.id)) break // corrupt data guard
    seen.add(next.id)
    path.push(next)
    parentId = next.id
    pointer = next.activeChildId
  }
  return path
}

/** Messages from the root down to (not including) the given message. */
export function ancestorsOf(session, messageId) {
  const index = byId(session)
  const chain = []
  let current = index.get(messageId)
  const seen = new Set()
  while (current && current.parentId != null && !seen.has(current.parentId)) {
    seen.add(current.parentId)
    current = index.get(current.parentId)
    if (current) chain.unshift(current)
  }
  return chain
}

/** Alternatives of a message at its fork (same parent, same role), oldest first. */
export function siblingsOf(session, message) {
  if (!message) return []
  return childrenOf(session, message.parentId ?? null).filter(m => m.role === message.role)
}

/**
 * Pointer updates that make `messageId` part of the visible path:
 * [{ parentId, childId }] from the root down. Below the message the existing
 * pointers are kept, so the branch reopens where the user last was.
 */
export function pointersToShow(session, messageId) {
  const target = byId(session).get(messageId)
  if (!target) return []
  return [...ancestorsOf(session, messageId), target].map(m => ({ parentId: m.parentId ?? null, childId: m.id }))
}

/** Ids of a message and everything below it. */
export function subtreeIds(session, messageId) {
  const ids = new Set([messageId])
  let added = true
  while (added) {
    added = false
    for (const m of session.messages) {
      if (m.parentId != null && ids.has(m.parentId) && !ids.has(m.id)) {
        ids.add(m.id)
        added = true
      }
    }
  }
  return ids
}

/**
 * Convert sessions saved before branching (a flat, ordered list) into a chain,
 * and make sure tree fields are consistent. Returns a new messages array plus
 * the root pointer.
 */
export function normalizeTree(messages, rootActiveId) {
  const isFlat = messages.length > 0 && messages.every(m => m.parentId === undefined)
  if (isFlat) {
    const chained = messages.map((m, i) => ({
      ...m,
      parentId: i === 0 ? null : messages[i - 1].id,
      activeChildId: messages[i + 1]?.id || null
    }))
    return { messages: chained, rootActiveId: chained[0]?.id || null }
  }
  const ids = new Set(messages.map(m => m.id))
  const fixed = messages.map(m => ({
    ...m,
    // Orphans (parent missing) become top-level turns rather than vanishing
    parentId: m.parentId != null && ids.has(m.parentId) ? m.parentId : null,
    activeChildId: m.activeChildId && ids.has(m.activeChildId) ? m.activeChildId : null
  }))
  return { messages: fixed, rootActiveId: rootActiveId && ids.has(rootActiveId) ? rootActiveId : null }
}

/**
 * Layout of the user turns for the branch map. Each user message is a node;
 * its depth is the turn number on its path (1-based). Columns come from a
 * depth-first walk: the first child continues its parent's column, later
 * children (branches) take new columns to the right.
 * @returns {{ nodes: Array<{id, depth, column, parentNodeId, active, excerpt, siblingIndex, siblingCount}>, columns: number, depth: number }}
 */
export function layoutBranchMap(session) {
  if (!session) return { nodes: [], columns: 0, depth: 0 }
  const index = byId(session)
  const activeIds = new Set(activePath(session).map(m => m.id))

  // User-turn tree: a user's next turns hang off its assistant replies
  const userChildren = (userId) => session.messages.filter(m => {
    if (m.role !== 'user' || m.parentId == null) return false
    const parent = index.get(m.parentId)
    return parent?.role === 'assistant' && parent.parentId === userId
  })
  const roots = session.messages.filter(m => m.role === 'user' && m.parentId == null)

  const nodes = []
  let nextColumn = 0
  let maxDepth = 0
  const visit = (message, depth, column, parentNodeId) => {
    const siblings = siblingsOf(session, message)
    nodes.push({
      id: message.id,
      depth,
      column,
      parentNodeId,
      active: activeIds.has(message.id),
      excerpt: String(message.content || '').replace(/\s+/g, ' ').trim().slice(0, 120) ||
        (message.contexts?.length ? '(attached context)' : ''),
      siblingIndex: siblings.findIndex(s => s.id === message.id) + 1,
      siblingCount: siblings.length
    })
    maxDepth = Math.max(maxDepth, depth)
    const kids = userChildren(message.id)
    kids.forEach((kid, i) => {
      const kidColumn = i === 0 ? column : ++nextColumn
      visit(kid, depth + 1, kidColumn, message.id)
    })
  }
  roots.forEach((root, i) => {
    const column = i === 0 ? 0 : ++nextColumn
    visit(root, 1, column, null)
  })
  return { nodes, columns: nodes.length ? nextColumn + 1 : 0, depth: maxDepth }
}
