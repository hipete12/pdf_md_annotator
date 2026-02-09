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
    
    // Computed
    const pdfDocument = computed(() => store.state.pdfDocument)
    const visiblePages = computed(() => store.getters.visiblePages)
    const selectedPages = computed(() => store.state.selectedPages)
    const currentPage = computed(() => store.state.currentPage)
    
    // Methods
    const setThumbnailRef = (el, pageNum) => {
      if (el) {
        thumbnailRefs.value[pageNum] = el
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
      if (!canvas || !pdfDocument.value) return
      
      renderingThumbnails.value.add(pageNum)
      
      try {
        const page = await pdfDocument.value.getPage(pageNum)
        const scale = 0.3
        const viewport = page.getViewport({ scale })
        
        canvas.width = viewport.width
        canvas.height = viewport.height
        
        const context = canvas.getContext('2d')
        await page.render({
          canvasContext: context,
          viewport
        }).promise
      } catch (err) {
        console.error(`Failed to render thumbnail for page ${pageNum}:`, err)
      } finally {
        renderingThumbnails.value.delete(pageNum)
      }
    }
    
    // Render thumbnails only for visible pages
    const renderThumbnails = async () => {
      if (!pdfDocument.value) return
      
      await nextTick()
      
      // Setup Intersection Observer if not already set up
      if (!observer.value) {
        observer.value = new IntersectionObserver(
          (entries) => {
            entries.forEach((entry) => {
              const pageNum = parseInt(entry.target.dataset.page, 10)
              if (entry.isIntersecting) {
                // Thumbnail is visible, render it
                visibleThumbnails.value.add(pageNum)
                renderSingleThumbnail(pageNum)
              } else {
                // Thumbnail is no longer visible
                visibleThumbnails.value.delete(pageNum)
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
      
      // Observe all thumbnail elements
      await nextTick()
      const thumbnailElements = thumbnailContainer.value?.querySelectorAll('.page-thumbnail')
      if (thumbnailElements) {
        thumbnailElements.forEach((el) => {
          observer.value.observe(el)
        })
      }
    }
    
    // Watch for PDF changes
    watch(pdfDocument, () => {
      // Disconnect old observer
      if (observer.value) {
        observer.value.disconnect()
        observer.value = null
      }
      visibleThumbnails.value.clear()
      renderingThumbnails.value.clear()
      renderThumbnails()
    })
    
    watch(visiblePages, () => {
      // Re-setup observer when pages change
      if (observer.value) {
        observer.value.disconnect()
        observer.value = null
      }
      nextTick(() => {
        renderThumbnails()
      })
    }, { deep: true })
    
    onMounted(() => {
      renderThumbnails()
    })
    
    onUnmounted(() => {
      // Cleanup observer on unmount
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
