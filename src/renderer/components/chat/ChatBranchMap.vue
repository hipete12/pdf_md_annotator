<template>
  <div
    class="branch-map"
    role="dialog"
    aria-label="Conversation branches"
  >
    <div class="branch-map-head">
      <span>Branches</span>
      <span class="branch-map-sub">{{ summary }}</span>
    </div>

    <p
      v-if="layout.nodes.length === 0"
      class="branch-map-empty"
    >
      No messages in this session yet.
    </p>

    <div
      v-else
      class="branch-map-scroll"
    >
      <svg
        :width="width"
        :height="height"
        :viewBox="`0 0 ${width} ${height}`"
        class="branch-map-svg"
      >
        <circle
          v-if="startDot"
          :cx="startDot.x"
          :cy="startDot.y"
          r="4"
          class="branch-map-start"
        >
          <title>Start of the conversation</title>
        </circle>
        <path
          v-for="edge in edges"
          :key="edge.id"
          :d="edge.d"
          class="branch-map-edge"
          :class="{ active: edge.active }"
        />
        <g
          v-for="node in placed"
          :key="node.id"
          class="branch-map-node"
          :class="{ active: node.active, locked }"
          role="button"
          :tabindex="locked ? -1 : 0"
          :aria-label="node.label"
          @click="open(node)"
          @keydown.enter.prevent="open(node)"
        >
          <title>{{ node.label }}</title>
          <circle
            :cx="node.x"
            :cy="node.y"
            :r="RADIUS"
          />
          <text
            :x="node.x"
            :y="node.y"
            dy="0.35em"
          >{{ node.depth }}</text>
        </g>
      </svg>
    </div>

    <p class="branch-map-hint">
      {{ locked ? 'Wait for the reply to finish to switch branches.' : 'Each circle is one of your messages, numbered by turn. Click one to open its branch.' }}
    </p>
  </div>
</template>

<script>
import { computed } from 'vue'
import { layoutBranchMap } from '../../utils/chatTree'

const RADIUS = 11
const COLUMN = 34
const ROW = 40
const PAD = 18

export default {
  name: 'ChatBranchMap',

  props: {
    session: { type: Object, default: null },
    locked: { type: Boolean, default: false }
  },

  emits: ['navigate'],

  setup(props, { emit }) {
    const layout = computed(() => layoutBranchMap(props.session))

    // When the first message itself has alternatives, a small start dot
    // joins them so the fork at turn 1 is visible
    const multipleRoots = computed(() => layout.value.nodes.filter(n => !n.parentNodeId).length > 1)
    const topOffset = computed(() => (multipleRoots.value ? ROW * 0.6 : 0))
    const startDot = computed(() => (multipleRoots.value ? { x: PAD + RADIUS, y: PAD + 4 } : null))

    const placed = computed(() => layout.value.nodes.map(node => ({
      ...node,
      x: PAD + RADIUS + node.column * COLUMN,
      y: PAD + RADIUS + topOffset.value + (node.depth - 1) * ROW,
      label: `Turn ${node.depth}` +
        (node.siblingCount > 1 ? ` · branch ${node.siblingIndex} of ${node.siblingCount}` : '') +
        (node.excerpt ? `: ${node.excerpt}` : '')
    })))

    const edges = computed(() => {
      const byId = new Map(placed.value.map(n => [n.id, n]))
      const curve = (x1, y1, x2, y2) => {
        const midY = (y1 + y2) / 2
        return `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`
      }
      return placed.value.flatMap(n => {
        if (n.parentNodeId) {
          const p = byId.get(n.parentNodeId)
          return [{ id: `${p.id}-${n.id}`, active: p.active && n.active, d: curve(p.x, p.y + RADIUS, n.x, n.y - RADIUS) }]
        }
        if (!startDot.value) return []
        const s = startDot.value
        return [{ id: `start-${n.id}`, active: n.active, d: curve(s.x, s.y + 4, n.x, n.y - RADIUS) }]
      })
    })

    const width = computed(() => PAD * 2 + RADIUS * 2 + Math.max(0, layout.value.columns - 1) * COLUMN)
    const height = computed(() => PAD * 2 + RADIUS * 2 + topOffset.value + Math.max(0, layout.value.depth - 1) * ROW)

    const summary = computed(() => {
      const forks = new Set(layout.value.nodes.filter(n => n.siblingCount > 1).map(n => `${n.parentNodeId}:${n.depth}`)).size
      const leaves = layout.value.columns
      if (!layout.value.nodes.length) return ''
      return forks === 0 ? 'No branches yet' : `${leaves} branches · ${forks} fork${forks === 1 ? '' : 's'}`
    })

    const open = (node) => {
      if (!props.locked) emit('navigate', node.id)
    }

    return { RADIUS, layout, startDot, placed, edges, width, height, summary, open }
  }
}
</script>

<style scoped>
.branch-map {
  position: absolute;
  top: 44px;
  right: 8px;
  width: min(320px, calc(100% - 16px));
  max-height: min(70%, 460px);
  display: flex;
  flex-direction: column;
  background: var(--annotation-bg);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  box-shadow: var(--shadow-lg);
  z-index: 20;
  overflow: hidden;
}

.branch-map-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border-color);
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
}

.branch-map-sub {
  font-weight: 400;
  font-size: 11px;
}

.branch-map-scroll {
  flex: 1;
  overflow: auto;
  display: flex;
  justify-content: center;
}

.branch-map-svg {
  flex: none;
}

.branch-map-edge {
  fill: none;
  stroke: var(--border-color);
  stroke-width: 2;
}

.branch-map-edge.active {
  stroke: var(--primary-color);
}

.branch-map-start {
  fill: var(--text-muted);
}

.branch-map-node {
  cursor: pointer;
  outline: none;
}

.branch-map-node.locked {
  cursor: default;
}

.branch-map-node circle {
  fill: var(--annotation-bg);
  stroke: var(--text-muted);
  stroke-width: 1.5;
}

.branch-map-node text {
  fill: var(--text-color);
  font-size: 11px;
  font-weight: 600;
  text-anchor: middle;
  pointer-events: none;
}

.branch-map-node.active circle {
  fill: var(--primary-color);
  stroke: var(--primary-color);
}

.branch-map-node.active text {
  fill: #fff;
}

.branch-map-node:not(.locked):hover circle,
.branch-map-node:focus-visible circle {
  stroke: var(--primary-color);
  stroke-width: 2.5;
}

.branch-map-empty,
.branch-map-hint {
  margin: 0;
  padding: 8px 10px;
  font-size: 11px;
  color: var(--text-muted);
}

.branch-map-hint {
  border-top: 1px solid var(--border-color);
}
</style>
