<template>
  <div 
    class="annotation-box"
    :class="{ 
      selected: isSelected, 
      collapsed: annotation.isCollapsed && !isSelected 
    }"
    :style="boxStyle"
    @mousedown="handleMouseDown"
    @click.stop="handleClick"
  >
    <!-- Collapsed view -->
    <template v-if="annotation.isCollapsed && !isSelected">
      <span class="annotation-collapsed-icon">✏️</span>
      <span class="annotation-collapsed-title">{{ annotation.collapsedTitle || 'Note' }}</span>
    </template>
    
    <!-- Expanded view -->
    <template v-else>
      <!-- Action buttons - only show when selected -->
      <div class="annotation-actions" v-if="isSelected">
        <button 
          class="annotation-action-button" 
          @click.stop="toggleStylePanel"
          @mousedown.stop
          title="Edit style"
        >
          ✏️
        </button>
        <button 
          class="annotation-action-button" 
          @click.stop="$emit('delete', annotation.id)"
          @mousedown.stop
          title="Delete annotation"
        >
          🗑️
        </button>
      </div>
      
      <div 
        class="annotation-content"
        @mousedown="handleContentMouseDown"
      >
        <MarkdownEditor
          ref="markdownEditor"
          :content="annotation.content"
          :style-config="annotation.style"
          @update="handleContentUpdate"
          @hide-annotation="showHideDialog"
        />
      </div>
      
      <!-- Edge resize handles - only show when selected -->
      <template v-if="isSelected">
        <div class="resize-handle resize-n" @mousedown.stop="startResize($event, 'n')"></div>
        <div class="resize-handle resize-e" @mousedown.stop="startResize($event, 'e')"></div>
        <div class="resize-handle resize-s" @mousedown.stop="startResize($event, 's')"></div>
        <div class="resize-handle resize-w" @mousedown.stop="startResize($event, 'w')"></div>
        <div class="resize-handle resize-ne" @mousedown.stop="startResize($event, 'ne')"></div>
        <div class="resize-handle resize-se" @mousedown.stop="startResize($event, 'se')"></div>
        <div class="resize-handle resize-sw" @mousedown.stop="startResize($event, 'sw')"></div>
        <div class="resize-handle resize-nw" @mousedown.stop="startResize($event, 'nw')"></div>
      </template>
      
      <!-- Style panel -->
      <StylePanel
        v-if="showStylePanel"
        :style-config="annotation.style"
        @update="handleStyleUpdate"
        @close="showStylePanel = false"
      />
      
      <!-- Hide annotation dialog -->
      <div v-if="showHideInput" class="hide-annotation-input">
        <input
          ref="hideInput"
          type="text"
          v-model="hideTitle"
          placeholder="Enter a title for this note..."
          @keydown="handleHideInputKeydown"
        />
        <div class="hide-annotation-hint">
          Press Enter to hide, Ctrl+Enter for new line
        </div>
      </div>
    </template>
  </div>
</template>

<script>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useStore } from 'vuex'
import MarkdownEditor from './MarkdownEditor.vue'
import StylePanel from './StylePanel.vue'

export default {
  name: 'AnnotationBox',
  
  components: {
    MarkdownEditor,
    StylePanel
  },
  
  props: {
    annotation: {
      type: Object,
      required: true
    },
    scale: {
      type: Number,
      default: 1
    }
  },
  
  emits: ['select', 'update', 'delete'],
  
  setup(props, { emit }) {
    const store = useStore()
    const markdownEditor = ref(null)
    const hideInput = ref(null)
    const showStylePanel = ref(false)
    const showHideInput = ref(false)
    const hideTitle = ref('')
    
    // Drag state
    const isDragging = ref(false)
    const dragOffset = ref({ x: 0, y: 0 })
    
    // Resize state
    const isResizing = ref(false)
    const resizeDirection = ref('')
    const resizeStart = ref({ width: 0, height: 0, x: 0, y: 0, boxX: 0, boxY: 0 })
    
    // Computed
    const isSelected = computed(() => store.state.selectedAnnotation === props.annotation.id)
    
    const boxStyle = computed(() => {
      const { x, y, width, height } = props.annotation
      // Scale font size with zoom to match OneNote behavior
      // This ensures text appears at the same relative size to the PDF content
      const baseFontSize = props.annotation.style?.fontSize || 14
      const scaledFontSize = baseFontSize * props.scale
      
      // Scale padding to maintain proportions at different zoom levels
      const basePadding = 10
      const scaledPadding = basePadding * props.scale
      
      return {
        left: `${x * props.scale}px`,
        top: `${y * props.scale}px`,
        width: props.annotation.isCollapsed && !isSelected.value 
          ? 'auto' 
          : `${width * props.scale}px`,
        height: props.annotation.isCollapsed && !isSelected.value 
          ? 'auto' 
          : `${height * props.scale}px`,
        '--md-font-size': `${scaledFontSize}px`,
        '--md-line-height': props.annotation.style?.lineHeight || 1.6,
        '--md-font-family': props.annotation.style?.fontFamily || 'inherit',
        '--annotation-padding': `${scaledPadding}px`
      }
    })
    
    // Methods
    const handleClick = () => {
      emit('select', props.annotation.id)
    }
    
    const handleMouseDown = (e) => {
      if (!isSelected.value) {
        emit('select', props.annotation.id)
      }
      
      // Ctrl+click on selected annotation starts drag from anywhere
      if (e.ctrlKey && isSelected.value) {
        e.preventDefault()
        e.stopPropagation()
        startDragFromEvent(e)
      }
    }
    
    const startDragFromEvent = (e) => {
      isDragging.value = true
      dragOffset.value = {
        x: e.clientX - props.annotation.x * props.scale,
        y: e.clientY - props.annotation.y * props.scale
      }
      
      document.addEventListener('mousemove', handleDrag)
      document.addEventListener('mouseup', stopDrag)
    }
    
    const handleContentMouseDown = (e) => {
      // Ctrl+drag to move from content area
      if (e.ctrlKey && isSelected.value) {
        e.preventDefault()
        startDragFromEvent(e)
        return
      }
      
      // Only start dragging if clicking on the content area itself (not textarea, buttons, etc)
      if (!isSelected.value) return
      
      // Don't drag if clicking on interactive elements
      if (e.target.closest('textarea, button, input, .markdown-preview')) return
      
      isDragging.value = true
      dragOffset.value = {
        x: e.clientX - props.annotation.x * props.scale,
        y: e.clientY - props.annotation.y * props.scale
      }
      
      document.addEventListener('mousemove', handleDrag)
      document.addEventListener('mouseup', stopDrag)
      e.preventDefault()
    }
    
    const handleDrag = (e) => {
      if (!isDragging.value) return
      
      const newX = (e.clientX - dragOffset.value.x) / props.scale
      const newY = (e.clientY - dragOffset.value.y) / props.scale
      
      emit('update', props.annotation.id, {
        x: Math.max(0, newX),
        y: Math.max(0, newY)
      })
    }
    
    const stopDrag = () => {
      isDragging.value = false
      document.removeEventListener('mousemove', handleDrag)
      document.removeEventListener('mouseup', stopDrag)
    }
    
    const startResize = (e, direction) => {
      isResizing.value = true
      resizeDirection.value = direction
      resizeStart.value = {
        width: props.annotation.width,
        height: props.annotation.height,
        x: e.clientX,
        y: e.clientY,
        boxX: props.annotation.x,
        boxY: props.annotation.y
      }
      
      document.addEventListener('mousemove', handleResize)
      document.addEventListener('mouseup', stopResize)
    }
    
    const handleResize = (e) => {
      if (!isResizing.value) return
      
      const dx = (e.clientX - resizeStart.value.x) / props.scale
      const dy = (e.clientY - resizeStart.value.y) / props.scale
      
      const minWidth = store.state.settings.annotationBox.minWidth
      const minHeight = store.state.settings.annotationBox.minHeight
      
      const updates = {}
      const dir = resizeDirection.value
      
      // Handle horizontal resizing
      if (dir.includes('e')) {
        updates.width = Math.max(minWidth, resizeStart.value.width + dx)
      } else if (dir.includes('w')) {
        const newWidth = Math.max(minWidth, resizeStart.value.width - dx)
        updates.width = newWidth
        updates.x = resizeStart.value.boxX + (resizeStart.value.width - newWidth)
      }
      
      // Handle vertical resizing
      if (dir.includes('s')) {
        updates.height = Math.max(minHeight, resizeStart.value.height + dy)
      } else if (dir.includes('n')) {
        const newHeight = Math.max(minHeight, resizeStart.value.height - dy)
        updates.height = newHeight
        updates.y = resizeStart.value.boxY + (resizeStart.value.height - newHeight)
      }
      
      emit('update', props.annotation.id, updates)
    }
    
    const stopResize = () => {
      isResizing.value = false
      document.removeEventListener('mousemove', handleResize)
      document.removeEventListener('mouseup', stopResize)
    }
    
    const toggleStylePanel = () => {
      showStylePanel.value = !showStylePanel.value
    }
    
    const handleContentUpdate = (content) => {
      emit('update', props.annotation.id, { content })
    }
    
    const handleStyleUpdate = (styleUpdates) => {
      emit('update', props.annotation.id, {
        style: { ...props.annotation.style, ...styleUpdates }
      })
    }
    
    const showHideDialog = () => {
      showHideInput.value = true
      hideTitle.value = props.annotation.collapsedTitle || ''
      nextTick(() => {
        hideInput.value?.focus()
      })
    }
    
    const handleHideInputKeydown = (e) => {
      if (e.key === 'Enter' && !e.ctrlKey) {
        e.preventDefault()
        // Hide the annotation
        store.dispatch('hideAnnotation', {
          id: props.annotation.id,
          title: hideTitle.value || 'Note'
        })
        showHideInput.value = false
      } else if (e.key === 'Enter' && e.ctrlKey) {
        // Insert newline - but since this is a single-line input, do nothing
        // For multi-line support, would need textarea
      } else if (e.key === 'Escape') {
        showHideInput.value = false
      }
    }
    
    // Global keyboard handler for Ctrl+H and Delete
    const handleKeydown = (e) => {
      if (!isSelected.value) return
      
      // Delete key - delete annotation
      if (e.key === 'Delete' || e.key === 'Backspace') {
        // Don't delete if user is typing in an input
        if (e.target.closest('textarea, input')) return
        
        e.preventDefault()
        emit('delete', props.annotation.id)
        return
      }
      
      if (e.ctrlKey && e.key === 'h') {
        e.preventDefault()
        
        if (props.annotation.isCollapsed) {
          // Unhide the annotation
          store.dispatch('unhideAnnotation', props.annotation.id)
        } else {
          // Show hide dialog
          showHideDialog()
        }
      }
    }
    
    onMounted(() => {
      document.addEventListener('keydown', handleKeydown)
    })
    
    onUnmounted(() => {
      document.removeEventListener('keydown', handleKeydown)
      document.removeEventListener('mousemove', handleDrag)
      document.removeEventListener('mouseup', stopDrag)
      document.removeEventListener('mousemove', handleResize)
      document.removeEventListener('mouseup', stopResize)
    })
    
    return {
      markdownEditor,
      hideInput,
      isSelected,
      boxStyle,
      showStylePanel,
      showHideInput,
      hideTitle,
      handleClick,
      handleMouseDown,
      handleContentMouseDown,
      startResize,
      toggleStylePanel,
      handleContentUpdate,
      handleStyleUpdate,
      showHideDialog,
      handleHideInputKeydown
    }
  }
}
</script>

<style scoped>
.annotation-drag-handle {
  cursor: move;
  color: var(--text-muted);
  font-size: 12px;
  user-select: none;
}

.annotation-header-actions {
  display: flex;
  gap: 4px;
}
</style>
