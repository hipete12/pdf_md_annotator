<template>
  <div
    class="highlight-menu"
    role="toolbar"
    :aria-label="mode === 'selection' ? 'Highlight the selected text' : 'Highlight'"
    @mousedown="keepSelection"
  >
    <!-- keepSelection: clicking here keeps the PDF text selection -->
    <button
      v-if="mode === 'selection'"
      class="highlight-menu-main"
      title="Highlight (Ctrl+Shift+H)"
      @click="$emit('pick', color)"
    >
      <span
        class="highlight-menu-dot"
        :style="{ backgroundColor: color }"
      />
      Highlight
    </button>
    <span
      v-if="mode === 'selection'"
      class="highlight-menu-divider"
    />
    <button
      v-for="option in colors"
      :key="option.value"
      class="highlight-swatch"
      :class="{ current: mode === 'highlight' && option.value === color }"
      :style="{ backgroundColor: option.value }"
      :title="mode === 'selection' ? `Highlight in ${option.name.toLowerCase()}` : `Change to ${option.name.toLowerCase()}`"
      :aria-label="option.name"
      @click="$emit('pick', option.value)"
    />
    <label
      class="highlight-swatch custom"
      :class="{ current: mode === 'highlight' && isCustom }"
      :style="isCustom ? { backgroundColor: color } : null"
      title="Other colour…"
    >
      <input
        type="color"
        :value="color"
        aria-label="Other colour"
        @change="$emit('pick', $event.target.value)"
      >
    </label>
    <template v-if="canRemove">
      <span class="highlight-menu-divider" />
      <button
        class="highlight-menu-remove"
        :title="mode === 'selection' ? 'Remove the highlights in the selection' : 'Remove highlight'"
        @click="$emit('remove')"
      >
        <svg
          viewBox="0 0 16 16"
          aria-hidden="true"
        ><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" /></svg>
        Remove
      </button>
    </template>
  </div>
</template>

<script>
import { computed } from 'vue'
import { HIGHLIGHT_COLORS } from '../utils/highlights'

export default {
  name: 'HighlightMenu',

  props: {
    // 'selection': text is selected; 'highlight': an existing highlight was clicked
    mode: { type: String, default: 'selection' },
    // Colour of new highlights, or of the clicked highlight
    color: { type: String, required: true },
    // Offer removing (the selection overlaps highlights, or one was clicked)
    canRemove: { type: Boolean, default: false }
  },

  emits: ['pick', 'remove'],

  setup(props) {
    const isCustom = computed(() => !HIGHLIGHT_COLORS.some(option => option.value === props.color))

    // The colour input must get its mousedown to open the picker
    const keepSelection = (event) => {
      if (event.target.tagName !== 'INPUT') event.preventDefault()
    }

    return { colors: HIGHLIGHT_COLORS, isCustom, keepSelection }
  }
}
</script>

<style scoped>
.highlight-menu {
  position: absolute;
  z-index: 999;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--annotation-bg);
  box-shadow: var(--shadow-lg);
  color: var(--text-color);
  font-size: 12px;
  white-space: nowrap;
  cursor: default;
  user-select: none;
}

.highlight-menu button {
  font: inherit;
  cursor: pointer;
}

.highlight-menu-main,
.highlight-menu-remove {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 8px;
  border: none;
  border-radius: 5px;
  background: none;
  color: inherit;
}

.highlight-menu-main:hover,
.highlight-menu-remove:hover {
  background: var(--menu-hover);
}

.highlight-menu-remove {
  color: var(--danger-color);
}

.highlight-menu-remove svg {
  width: 13px;
  height: 13px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.4;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.highlight-menu-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.15);
}

.highlight-menu-divider {
  width: 1px;
  height: 18px;
  margin: 0 2px;
  background: var(--border-color);
}

.highlight-swatch {
  position: relative;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  border-radius: 50%;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.15);
}

.highlight-swatch:hover {
  transform: scale(1.15);
}

.highlight-swatch.current {
  box-shadow: 0 0 0 2px var(--annotation-bg), 0 0 0 3.5px var(--text-color);
}

/* "Other colour": a rainbow ring around the native colour picker */
.highlight-swatch.custom {
  overflow: hidden;
  background: conic-gradient(#f87171, #facc15, #4ade80, #60a5fa, #c084fc, #f87171);
  cursor: pointer;
}

.highlight-swatch.custom input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  padding: 0;
  border: none;
  opacity: 0;
  cursor: pointer;
}
</style>
