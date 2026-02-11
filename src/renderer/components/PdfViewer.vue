<template>
  <div class="pdf-viewer" ref="viewerContainer" @scroll="handleScroll">
    <div class="pdf-pages-container">
      <div 
        v-for="pageNum in visiblePages"
        :key="pageNum"
        class="pdf-page-wrapper"
        :data-page="pageNum"
        @dblclick="handleDoubleClick($event, pageNum)"
      >
        <canvas 
          :ref="el => setCanvasRef(el, pageNum)" 
          class="pdf-canvas"
        ></canvas>
        
        <div class="annotation-layer">
          <AnnotationBox
            v-for="annotation in getPageAnnotations(pageNum)"
            :key="annotation.id"
            :annotation="annotation"
            :scale="scale"
            @select="selectAnnotation"
            @update="updateAnnotation"
            @delete="deleteAnnotation"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useStore } from 'vuex'
import AnnotationBox from './AnnotationBox.vue'

// Debounce helper
function debounce(fn, delay) {
  let timeoutId
  return function (...args) {
    clearTimeout(timeoutId)
    timeoutId = setTimeout(() => fn.apply(this, args), delay)
  }
}

export default {
  name: 'PdfViewer',
  
  components: {
    AnnotationBox
  },
  
  setup() {
    const store = useStore()
    const viewerContainer = ref(null)
    const canvasRefs = ref({})
    const renderTasks = ref({})
    const isRendering = ref(false)
    
    // Computed
    const pdfDocument = computed(() => store.state.pdfDocument)
    const currentPage = computed(() => store.state.currentPage)
    const scale = computed(() => store.state.scale)
    const visiblePages = computed(() => store.getters.visiblePages)
    
    const setCanvasRef = (el, pageNum) => {
      if (el) {
        canvasRefs.value[pageNum] = el
      } else {
        delete canvasRefs.value[pageNum]
      }
    }
    
    // Render a single page
    const renderPage = async (pageNum) => {
      if (!pdfDocument.value || !canvasRefs.value[pageNum]) {
        return
      }
      
      const canvas = canvasRefs.value[pageNum]
      
      // Cancel existing render for this page
      if (renderTasks.value[pageNum]) {
        try {
          renderTasks.value[pageNum].cancel()
        } catch (e) {}
        delete renderTasks.value[pageNum]
      }
      
      let page = null
      try {
        page = await pdfDocument.value.getPage(pageNum)
        
        // Use device pixel ratio for sharp rendering, capped at 2x
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
        const currentScale = scale.value
        const viewport = page.getViewport({ scale: currentScale * pixelRatio })
        
        // Check canvas size limits
        const MAX_CANVAS_SIZE = 16384
        if (viewport.width > MAX_CANVAS_SIZE || viewport.height > MAX_CANVAS_SIZE) {
          console.warn(`Canvas too large for page ${pageNum}, reducing resolution`)
          const adjustedRatio = Math.min(
            MAX_CANVAS_SIZE / (page.getViewport({ scale: currentScale }).width),
            MAX_CANVAS_SIZE / (page.getViewport({ scale: currentScale }).height)
          )
          const adjustedViewport = page.getViewport({ scale: currentScale * adjustedRatio })
          await renderPageWithViewport(page, canvas, adjustedViewport, adjustedRatio)
        } else {
          await renderPageWithViewport(page, canvas, viewport, pixelRatio)
        }
      } catch (err) {
        console.error(`Failed to render page ${pageNum}:`, err)
      } finally {
        if (page) page.cleanup()
      }
    }
    
    // Helper to render page with specific viewport
    const renderPageWithViewport = async (page, canvas, viewport, pixelRatio) => {
      const context = canvas.getContext('2d', { alpha: false })
      if (!context) {
        console.error('Failed to get 2D context')
        return
      }
      
      const pageNum = page.pageNumber
      
      // Set canvas dimensions
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      
      // Set CSS size
      canvas.style.width = `${Math.floor(viewport.width / pixelRatio)}px`
      canvas.style.height = `${Math.floor(viewport.height / pixelRatio)}px`
      
      // Clear canvas with white background
      context.save()
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.restore()
      
      // Render
      const renderTask = page.render({
        canvasContext: context,
        viewport: viewport,
        background: 'white'
      })
      
      renderTasks.value[pageNum] = renderTask
      
      try {
        await renderTask.promise
        console.log(`Page ${pageNum} rendered (${canvas.width}x${canvas.height})`)
      } catch (renderError) {
        if (renderError.name !== 'RenderingCancelledException') {
          console.error(`Page ${pageNum} render error:`, renderError.message)
        }
      } finally {
        delete renderTasks.value[pageNum]
      }
    }
    
    // Render all pages sequentially
    const renderAllPages = async () => {
      if (!pdfDocument.value) return
      
      // Cancel any in-progress renders
      for (const [pageNum, task] of Object.entries(renderTasks.value)) {
        try {
          task.cancel()
        } catch (e) {}
        delete renderTasks.value[pageNum]
      }
      
      // If already rendering, mark that we need another render after this completes
      if (isRendering.value) {
        console.log('Render in progress, will re-render after completion')
        setTimeout(() => renderAllPages(), 50)
        return
      }
      
      isRendering.value = true
      
      try {
        await nextTick()
        
        // Render pages one by one
        const pages = visiblePages.value
        for (const pageNum of pages) {
          if (canvasRefs.value[pageNum]) {
            await renderPage(pageNum)
          }
        }
      } finally {
        isRendering.value = false
      }
    }
    
    const getPageAnnotations = (pageNum) => {
      return store.state.annotations[pageNum] || []
    }
    
    const handleDoubleClick = (event, pageNum) => {
      // Don't create annotation if clicking on UI elements (prevents accidental creation)
      const target = event.target
      if (target.closest('.annotation-box') || 
          target.closest('.annotation-actions') ||
          target.closest('.annotation-action-button') ||
          target.closest('.style-panel') ||
          target.closest('button') ||
          target.closest('input') ||
          target.closest('select')) {
        return
      }
      
      const canvas = canvasRefs.value[pageNum]
      if (!canvas) return
      
      const rect = canvas.getBoundingClientRect()
      const screenX = event.clientX - rect.left
      const screenY = event.clientY - rect.top
      const x = screenX / scale.value
      const y = screenY / scale.value
      
      store.dispatch('createAnnotation', {
        pageIndex: pageNum,
        x,
        y
      })
    }
    
    const scrollToPage = (pageNum) => {
      const pageWrapper = viewerContainer.value?.querySelector(`[data-page="${pageNum}"]`)
      if (pageWrapper) {
        pageWrapper.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    }
    
    const selectAnnotation = (id) => {
      store.dispatch('selectAnnotation', id)
    }
    
    const updateAnnotation = (id, updates) => {
      store.dispatch('updateAnnotation', { id, updates })
    }
    
    const deleteAnnotation = (id) => {
      store.dispatch('deleteAnnotation', id)
    }
    
    const handleScroll = () => {
      // Could implement scroll-based page navigation here
    }
    
    // Debounced render for zoom
    const debouncedRender = debounce(() => {
      renderAllPages()
    }, 150)
    
    const pendingScale = ref(null)
    
    const handleWheel = (event) => {
      if (event.ctrlKey) {
        event.preventDefault()
        
        const delta = -event.deltaY
        const zoomSpeed = 0.001
        const zoomChange = delta * zoomSpeed
        const newScale = Math.max(0.25, Math.min(4, scale.value + zoomChange))
        
        store.commit('SET_SCALE', newScale)
        pendingScale.value = newScale
        debouncedRender()
      }
    }
    
    const handleClickOutside = (event) => {
      const isInsideAnnotation = event.target.closest('.annotation-box')
      if (!isInsideAnnotation) {
        store.dispatch('selectAnnotation', null)
      }
    }
    
    // Watch for PDF document changes
    watch(pdfDocument, async (newDoc) => {
      if (newDoc) {
        await nextTick()
        renderAllPages()
      }
    })
    
    // Watch for scale changes (zoom)
    watch(scale, () => {
      if (pendingScale.value === null) {
        nextTick(() => {
          renderAllPages()
        })
      } else {
        setTimeout(() => {
          pendingScale.value = null
        }, 200)
      }
    })
    
    watch(visiblePages, () => {
      nextTick(() => {
        renderAllPages()
      })
    })
    
    watch(currentPage, (newPage) => {
      scrollToPage(newPage)
    })
    
    onMounted(() => {
      document.addEventListener('click', handleClickOutside)
      if (viewerContainer.value) {
        viewerContainer.value.addEventListener('wheel', handleWheel, { passive: false })
      }
      
      // Initial render if PDF is already loaded
      if (pdfDocument.value) {
        nextTick(() => {
          renderAllPages()
        })
      }
    })
    
    onUnmounted(() => {
      // Cancel all renders
      for (const [pageNum, task] of Object.entries(renderTasks.value)) {
        try {
          task.cancel()
        } catch (e) {}
      }
      
      document.removeEventListener('click', handleClickOutside)
      if (viewerContainer.value) {
        viewerContainer.value.removeEventListener('wheel', handleWheel)
      }
    })
    
    return {
      viewerContainer,
      canvasRefs,
      scale,
      visiblePages,
      setCanvasRef,
      getPageAnnotations,
      handleDoubleClick,
      selectAnnotation,
      updateAnnotation,
      deleteAnnotation,
      handleScroll,
      scrollToPage
    }
  }
}
</script>

<style scoped>
/* Component-specific styles are in main.css */
</style>
