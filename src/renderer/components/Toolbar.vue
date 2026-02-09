<template>
  <div class="toolbar">
    <div class="toolbar-group">
      <button class="toolbar-button" @click="$emit('zoom-out')" title="Zoom out">
        −
      </button>
      <span class="zoom-display">{{ Math.round(scale * 100) }}%</span>
      <button class="toolbar-button" @click="$emit('zoom-in')" title="Zoom in">
        +
      </button>
      <button class="toolbar-button" @click="$emit('zoom-reset')" title="Reset zoom">
        Reset
      </button>
    </div>
    
    <div class="toolbar-group">
      <button 
        class="toolbar-button" 
        @click="prevPage" 
        :disabled="currentPage <= 1"
        title="Previous page"
      >
        ◀
      </button>
      <span class="page-info">
        <input 
          type="number" 
          class="page-input" 
          :value="currentPage" 
          @change="handlePageInput"
          :min="1"
          :max="pageCount"
        />
        <span class="page-separator">/</span>
        <span class="page-total">{{ pageCount }}</span>
      </span>
      <button 
        class="toolbar-button" 
        @click="nextPage" 
        :disabled="currentPage >= pageCount"
        title="Next page"
      >
        ▶
      </button>
    </div>
    
    <div class="toolbar-spacer"></div>
    
    <div class="toolbar-group">
      <button 
        class="toolbar-button" 
        @click="$emit('open-settings')" 
        title="Settings"
      >
        ⚙ Settings
      </button>
    </div>
    
    <div class="toolbar-group" v-if="isDirty">
      <span class="unsaved-indicator" title="Unsaved changes">●</span>
    </div>
  </div>
</template>

<script>
import { computed } from 'vue'
import { useStore } from 'vuex'

export default {
  name: 'Toolbar',
  
  emits: ['zoom-in', 'zoom-out', 'zoom-reset', 'open-settings'],
  
  setup() {
    const store = useStore()
    
    const scale = computed(() => store.state.scale)
    const currentPage = computed(() => store.state.currentPage)
    const pageCount = computed(() => store.getters.visiblePages.length)
    const isDirty = computed(() => store.state.isDirty)
    
    const prevPage = () => {
      if (currentPage.value > 1) {
        store.commit('SET_CURRENT_PAGE', currentPage.value - 1)
      }
    }
    
    const nextPage = () => {
      if (currentPage.value < pageCount.value) {
        store.commit('SET_CURRENT_PAGE', currentPage.value + 1)
      }
    }
    
    const handlePageInput = (event) => {
      const page = parseInt(event.target.value)
      if (page >= 1 && page <= pageCount.value) {
        store.commit('SET_CURRENT_PAGE', page)
      } else {
        event.target.value = currentPage.value
      }
    }
    
    return {
      scale,
      currentPage,
      pageCount,
      isDirty,
      prevPage,
      nextPage,
      handlePageInput
    }
  }
}
</script>

<style scoped>
.toolbar-spacer {
  flex: 1;
}

.page-info {
  display: flex;
  align-items: center;
  gap: 4px;
}

.page-separator {
  color: var(--text-muted);
}

.page-total {
  color: var(--text-muted);
  font-size: 13px;
}

.unsaved-indicator {
  color: var(--warning-color);
  font-size: 18px;
}
</style>
