<template>
  <aside class="sidebar" :class="{ collapsed }">
    <div class="sidebar-header">
      <span class="sidebar-title">Pages</span>
      <button class="sidebar-toggle" @click="$emit('toggle')" title="Hide sidebar">
        ◀
      </button>
    </div>
    
    <div class="sidebar-content" ref="thumbnailContainer">
      <div 
        v-for="(pageNum, index) in visiblePages"
        :key="pageNum"
        :data-page="pageNum"
        class="page-thumbnail"
        :class="{
          selected: isSelected(pageNum),
          dragging: draggedPage === pageNum,
          'drag-over': dragOverIndex === index
        }"
        draggable="true"
        @click="handleClick($event, pageNum, index)"
        @dblclick="goToPage(pageNum)"
        @dragstart="handleDragStart($event, pageNum, index)"
        @dragover="handleDragOver($event, index)"
        @dragleave="handleDragLeave"
        @drop="handleDrop($event, index)"
        @dragend="handleDragEnd"
      >
        <canvas :ref="el => setThumbnailRef(el, pageNum)"></canvas>
        <span class="page-thumbnail-number">{{ index + 1 }}</span>
        <button 
          class="page-thumbnail-delete"
          @click.stop="deletePage(pageNum)"
          title="Delete page"
        >
          ×
        </button>
      </div>
    </div>
    
    <div class="sidebar-footer" v-if="selectedPages.length > 0">
      <button class="btn btn-secondary" @click="deleteSelectedPages">
        Delete {{ selectedPages.length }} page(s)
      </button>
    </div>
  </aside>
</template>

<script>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useStore } from 'vuex'

function isCancelledError(err) {
  return err && err.name === 'RenderingCancelledException'
}

export default {
  name: 'Sidebar',
  
  props: {
    collapsed: {
      type: Boolean,
      default: false
    }
  },
  
  emits: ['toggle'],
  
  setup() {
    const store = useStore()
    const thumbnailContainer = ref(null)
    const thumbnailRefs = ref({})
    const draggedPage = ref(null)
    const dragOverIndex = ref(null)
    const dragStartIndex = ref(null)
    const visibleThumbnails = ref(new Set()) // Track which thumbnails are visible
    const observer = ref(null) // Intersection Observer
    const renderingThumbnails = ref(new Set()) // Track which thumbnails are currently being rendered
    
    // Non-reactive render task tracking (pdf.js render tasks should not be reactive)
    const thumbnailRenderTasks = new Map()
    
    // Computed
    const pdfDocument = computed(() => store.state.pdfDocument)
    const visiblePages = computed(() => store.getters.visiblePages)
    const selectedPages = computed(() => store.state.selectedPages)
    const currentPage = computed(() => store.state.currentPage)
    
    // Cancel a single thumbnail render task (best-effort; cancellation errors ignored)
    const cancelThumbnailRender = (pageNum) => {
      const task = thumbnailRenderTasks.get(pageNum)
      if (!task) return
      try {
        task.cancel()
      } catch (e) {
        // Cancellation is best-effort
      }
      // Leave the task entry; renderSingleThumbnail's finally cleans it up by identity
    }
    
    // Cancel all thumbnail render tasks (e.g. on document change or unmount)
    const cancelAllThumbnailRenders = () => {
      for (const task of thumbnailRenderTasks.values()) {
        try {
          task.cancel()
        } catch (e) {
          // Cancellation is best-effort
        }
      }
      // Entries are removed by each render's finally block; clear as a safety net
      thumbnailRenderTasks.clear()
      renderingThumbnails.value.clear()
    }
    
    // Methods
    const setThumbnailRef = (el, pageNum) => {
      if (el) {
        thumbnailRefs.value[pageNum] = el
      } else {
        // Canvas was unmounted (page deleted/reordered out); clean up ref and cancel any render
        delete thumbnailRefs.value[pageNum]
        cancelThumbnailRender(pageNum)
      }
    }
    
    const isSelected = (pageNum) => {
      return selectedPages.value.includes(pageNum)
    }
    
    const handleClick = (event, pageNum, index) => {
      if (event.ctrlKey || event.metaKey) {
        // Multi-select with Ctrl/Cmd
        const newSelection = [...selectedPages.value]
        const idx = newSelection.indexOf(pageNum)
        if (idx === -1) {
          newSelection.push(pageNum)
        } else {
          newSelection.splice(idx, 1)
        }
        store.commit('SET_SELECTED_PAGES', newSelection)
      } else if (event.shiftKey && selectedPages.value.length > 0) {
        // Range select with Shift
        const lastSelected = selectedPages.value[selectedPages.value.length - 1]
        const lastIndex = visiblePages.value.indexOf(lastSelected)
        const start = Math.min(lastIndex, index)
        const end = Math.max(lastIndex, index)
        const range = visiblePages.value.slice(start, end + 1)
        store.commit('SET_SELECTED_PAGES', range)
      } else {
        // Single select
        store.commit('SET_SELECTED_PAGES', [pageNum])
      }
    }
    
    const goToPage = (pageNum) => {
      store.commit('SET_CURRENT_PAGE', pageNum)
    }
    
    const deletePage = (pageNum) => {
      store.dispatch('deletePages', [pageNum])
    }
    
    const deleteSelectedPages = () => {
      store.dispatch('deletePages', selectedPages.value)
    }
    
    // Drag and drop handlers
    const handleDragStart = (event, pageNum, index) => {
      draggedPage.value = pageNum
      dragStartIndex.value = index
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', pageNum.toString())
      
      // If dragged page is not in selection, select only it
      if (!selectedPages.value.includes(pageNum)) {
        store.commit('SET_SELECTED_PAGES', [pageNum])
      }
    }
    
    const handleDragOver = (event, index) => {
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      dragOverIndex.value = index
    }
    
    const handleDragLeave = () => {
      dragOverIndex.value = null
    }
    
    const handleDrop = (event, toIndex) => {
      event.preventDefault()
      
      if (dragStartIndex.value !== null && dragStartIndex.value !== toIndex) {
        // Move all selected pages
        const pagesToMove = selectedPages.value.length > 0 
          ? selectedPages.value 
          : [draggedPage.value]
        
        // For simplicity, move the dragged page only
        store.dispatch('reorderPages', {
          fromIndex: dragStartIndex.value,
          toIndex
        })
      }
      
      dragOverIndex.value = null
      draggedPage.value = null
      dragStartIndex.value = null
    }
    
    const handleDragEnd = () => {
      dragOverIndex.value = null
      draggedPage.value = null
      dragStartIndex.value = null
    }
    
    // Render a single thumbnail (called when it becomes visible)
    const renderSingleThumbnail = async (pageNum) => {
      // Skip if already rendering this thumbnail
      if (renderingThumbnails.value.has(pageNum)) {
        return
      }
      
      const canvas = thumbnailRefs.value[pageNum]
      if (!canvas) return
      
      // Route through page-source mapping so concatenated pages resolve correctly
      const source = store.getters.getPageSource(pageNum)
      if (!source || !source.document) return
      
      renderingThumbnails.value.add(pageNum)
      
      let page = null
      let renderTask = null
      try {
        page = await source.document.getPage(source.actualPage)
        
        // Re-check after async: page may have scrolled out or document changed
        if (!visibleThumbnails.value.has(pageNum)) return
        const currentCanvas = thumbnailRefs.value[pageNum]
        if (!currentCanvas || currentCanvas !== canvas) return
        
        const scale = 0.3
        const viewport = page.getViewport({ scale })
        
        // Set canvas size with proper rounding
        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        
        // Ensure canvas has valid dimensions
        if (canvas.width === 0 || canvas.height === 0) {
          console.error(`Invalid canvas dimensions for page ${pageNum}: ${canvas.width}x${canvas.height}`)
          return
        }
        
        const context = canvas.getContext('2d', { alpha: false })
        if (!context) {
          console.error(`Failed to get 2D context for page ${pageNum} thumbnail`)
          return
        }
        
        // Fill entire canvas with white background FIRST
        context.save()
        context.fillStyle = '#ffffff'
        context.fillRect(0, 0, canvas.width, canvas.height)
        context.restore()
        
        // Render the page
        renderTask = page.render({
          canvasContext: context,
          viewport: viewport,
          background: 'white'
        })
        thumbnailRenderTasks.set(pageNum, renderTask)
        
        await renderTask.promise
      } catch (err) {
        if (!isCancelledError(err)) {
          console.error(`Failed to render thumbnail for page ${pageNum}:`, err)
          // Draw error indicator
          const context = canvas.getContext('2d')
          if (context && canvas.width > 0) {
            context.fillStyle = '#ffeeee'
            context.fillRect(0, 0, canvas.width, canvas.height)
            context.fillStyle = '#ff0000'
            context.font = '12px Arial'
            context.textAlign = 'center'
            context.fillText('Error', canvas.width / 2, canvas.height / 2)
          }
        }
      } finally {
        // Only delete the task if it's still the same one (avoid clobbering a newer render)
        if (renderTask && thumbnailRenderTasks.get(pageNum) === renderTask) {
          thumbnailRenderTasks.delete(pageNum)
        }
        if (page) page.cleanup()
        renderingThumbnails.value.delete(pageNum)
      }
    }
    
    // Set up the IntersectionObserver (creates once, reused across page-list changes)
    const setupObserver = () => {
      if (observer.value) return
      observer.value = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            const pageNum = parseInt(entry.target.dataset.page, 10)
            if (entry.isIntersecting) {
              // Thumbnail is visible, render it
              visibleThumbnails.value.add(pageNum)
              renderSingleThumbnail(pageNum)
            } else {
              // Thumbnail is no longer visible; cancel any in-flight render
              visibleThumbnails.value.delete(pageNum)
              cancelThumbnailRender(pageNum)
            }
          })
        },
        {
          root: thumbnailContainer.value,
          rootMargin: '200px', // Render thumbnails 200px before they come into view
          threshold: 0.01
        }
      )
    }
    
    // Observe all thumbnail elements (idempotent; safe to call on existing elements)
    const observeThumbnailElements = () => {
      setupObserver()
      if (!observer.value) return
      const thumbnailElements = thumbnailContainer.value?.querySelectorAll('.page-thumbnail')
      if (thumbnailElements) {
        thumbnailElements.forEach((el) => {
          observer.value.observe(el)
        })
      }
    }
    
    // Clean stale thumbnail refs and cancel renders for pages no longer in the page list
    const cleanStaleThumbnails = () => {
      const validPages = new Set(visiblePages.value)
      for (const key of Object.keys(thumbnailRefs.value)) {
        const pageNum = parseInt(key, 10)
        if (!validPages.has(pageNum)) {
          delete thumbnailRefs.value[key]
          cancelThumbnailRender(pageNum)
          visibleThumbnails.value.delete(pageNum)
        }
      }
      for (const pageNum of Array.from(thumbnailRenderTasks.keys())) {
        if (!validPages.has(pageNum)) {
          cancelThumbnailRender(pageNum)
        }
      }
    }
    
    // Watch for PDF document changes
    watch(pdfDocument, () => {
      // Cancel all in-flight thumbnail renders for the old document
      cancelAllThumbnailRenders()
      visibleThumbnails.value.clear()
      
      // Old thumbnail refs are stale; clear them so renders don't target unmounted canvases
      thumbnailRefs.value = {}
      
      // Disconnect observer (old elements are gone) but keep the instance for reuse
      if (observer.value) {
        observer.value.disconnect()
      }
      
      // Let IntersectionObserver decide when to render new thumbnails (no artificial delay)
      nextTick(() => {
        observeThumbnailElements()
      })
    })
    
    // Watch for page list changes (deletion, reorder, concatenation)
    watch(visiblePages, () => {
      // Clean stale refs and cancel renders for removed pages
      cleanStaleThumbnails()
      // Observe new elements; reuses existing observer (no disconnect/recreate)
      nextTick(() => {
        observeThumbnailElements()
      })
    })
    
    onMounted(() => {
      observeThumbnailElements()
    })
    
    onUnmounted(() => {
      // Cleanup observer and cancel renders on unmount
      cancelAllThumbnailRenders()
      if (observer.value) {
        observer.value.disconnect()
        observer.value = null
      }
    })
    
    return {
      thumbnailContainer,
      thumbnailRefs,
      visiblePages,
      selectedPages,
      currentPage,
      draggedPage,
      dragOverIndex,
      setThumbnailRef,
      isSelected,
      handleClick,
      goToPage,
      deletePage,
      deleteSelectedPages,
      handleDragStart,
      handleDragOver,
      handleDragLeave,
      handleDrop,
      handleDragEnd
    }
  }
}
</script>

<style scoped>
.sidebar-footer {
  padding: 12px;
  border-top: 1px solid var(--border-color);
}

.sidebar-footer .btn {
  width: 100%;
}
</style>
