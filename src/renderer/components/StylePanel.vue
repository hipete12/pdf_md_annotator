<template>
  <div class="style-panel">
    <div class="style-panel-header">
      <span class="style-panel-title">Style Settings</span>
      <button class="style-panel-close" @click="$emit('close')">×</button>
    </div>
    
    <div class="style-panel-body">
      <div class="style-row">
        <label>Font Size</label>
        <input 
          type="number" 
          :value="styleConfig.fontSize || 14"
          @input="updateStyle('fontSize', parseInt($event.target.value))"
          min="8"
          max="72"
        />
        <span class="style-unit">px</span>
      </div>
      
      <div class="style-row">
        <label>Line Height</label>
        <input 
          type="number" 
          :value="styleConfig.lineHeight || 1.6"
          @input="updateStyle('lineHeight', parseFloat($event.target.value))"
          min="1"
          max="3"
          step="0.1"
        />
      </div>
      
      <div class="style-row">
        <label>Font Family</label>
        <select 
          :value="styleConfig.fontFamily || 'system-ui'"
          @change="updateStyle('fontFamily', $event.target.value)"
        >
          <option value="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif">System Default</option>
          <option value="'Times New Roman', serif">Times New Roman</option>
          <option value="'Georgia', serif">Georgia</option>
          <option value="'Arial', sans-serif">Arial</option>
          <option value="'Helvetica', sans-serif">Helvetica</option>
          <option value="'Consolas', monospace">Consolas</option>
          <option value="'Monaco', monospace">Monaco</option>
        </select>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'StylePanel',
  
  props: {
    styleConfig: {
      type: Object,
      default: () => ({})
    }
  },
  
  emits: ['update', 'close'],
  
  setup(props, { emit }) {
    const updateStyle = (key, value) => {
      emit('update', { [key]: value })
    }
    
    return {
      updateStyle
    }
  }
}
</script>

<style scoped>
.style-panel {
  position: absolute;
  top: 36px;
  right: 0;
  background: var(--annotation-bg);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  box-shadow: var(--shadow-lg);
  z-index: 100;
  min-width: 250px;
}

.style-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-color);
}

.style-panel-title {
  font-size: 13px;
  font-weight: 600;
}

.style-panel-close {
  background: none;
  border: none;
  font-size: 18px;
  cursor: pointer;
  color: var(--text-muted);
  padding: 0;
  line-height: 1;
}

.style-panel-close:hover {
  color: var(--text-color);
}

.style-panel-body {
  padding: 12px;
}

.style-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.style-row:last-child {
  margin-bottom: 0;
}

.style-row label {
  flex: 1;
  font-size: 12px;
  color: var(--text-color);
}

.style-row input[type="number"] {
  width: 60px;
  padding: 4px 8px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  font-size: 12px;
}

.style-row select {
  width: 140px;
  padding: 4px 8px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  font-size: 12px;
}

.style-unit {
  font-size: 11px;
  color: var(--text-muted);
}
</style>
