<template>
  <div class="pdf-viewer" ref="viewerContainer" @scroll="handleScroll">
    <div class="pdf-pages-container">
      <!-- Render all pages vertically -->
      <div 
        v-for="pageNum in visiblePages"
        :key="pageNum"
        class="pdf-page-wrapper"
        :data-page="pageNum"
        @dblclick="handleDoubleClick($event, pageNum)"
      >
        <canvas :ref="el => setCanvasRef(el, pageNum)" class="pdf-canvas"></canvas>
        
        <!-- Annotation layer for this page -->
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

// Debounce helper for zoom operations
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
    const annotationLayer = ref(null)
    const renderTasks = ref({})
    const isRendering = ref(false)
    const renderQueue = ref([])
    
    // Computed
    const pdfDocument = computed(() => store.state.pdfDocument)
    const currentPage = computed(() => store.state.currentPage)
    const scale = computed(() => store.state.scale)
    const visiblePages = computed(() => store.getters.visiblePages)
    
    const setCanvasRef = (el, pageNum) => {
      if (el) {
        canvasRefs.value[pageNum] = el
      }
    }
    
    // Helper function to render page with a specific viewport
    const renderPageWithViewport = async (page, canvas, viewport, pixelRatio) => {
      const context = canvas.getContext('2d', { alpha: false })
      if (!context) {
        console.error('Failed to get 2D context for canvas')
        return
      }
      
      // Store previous dimensions to prevent flipping
      const prevWidth = canvas.width
      const prevHeight = canvas.height
      
      // Only update dimensions if they've significantly changed (prevents flipping)
      const dimensionThreshold = 5 // pixels
      const widthChanged = Math.abs(viewport.width - prevWidth) > dimensionThreshold
      const heightChanged = Math.abs(viewport.height - prevHeight) > dimensionThreshold
      
      if (widthChanged || heightChanged || !prevWidth || !prevHeight) {
        // Set canvas internal dimensions (accounting for pixel ratio)
        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        
        // Set CSS dimensions (display size)
        const cssWidth = viewport.width / pixelRatio
        const cssHeight = viewport.height / pixelRatio
        canvas.style.width = `${Math.floor(cssWidth)}px`
        canvas.style.height = `${Math.floor(cssHeight)}px`
      }
      
      const renderTask = page.render({
        canvasContext: context,
        viewport,
        enableWebGL: false, // Disable WebGL to avoid memory issues with large PDFs
        intent: 'display' // Specify intent for better compatibility
      })
      
      renderTasks.value[page.pageNumber || page._pageIndex] = renderTask
      
      try {
        await renderTask.promise
      } catch (renderError) {
        // If rendering fails, try again with fallback rendering options
        if (renderError.name !== 'RenderingCancelledException') {
          console.warn(`Page ${page.pageNumber} had rendering issues, using fallback mode:`, renderError.message)
          // Clear the canvas and draw a simple background
          context.fillStyle = '#ffffff'
          context.fillRect(0, 0, canvas.width, canvas.height)
          context.fillStyle = '#666666'
          context.font = '16px Arial'
          context.textAlign = 'center'
          context.fillText(`Page ${page.pageNumber || page._pageIndex}`, canvas.width / 2, canvas.height / 2)
          context.fillText('(Rendering issue - partial content may be missing)', canvas.width / 2, canvas.height / 2 + 25)
        }
      }
    }
    
    const getPageAnnotations = (pageNum) => {
      return store.state.annotations[pageNum] || []
    }
    
    // Methods
    const renderPage = async (pageNum) => {
      if (!pdfDocument.value || !canvasRefs.value[pageNum]) {
        return
      }
      
      const canvas = canvasRefs.value[pageNum]
      
      // Cancel existing render for this page first
      if (renderTasks.value[pageNum]) {
        try {
          renderTasks.value[pageNum].cancel()
        } catch (e) {
          // Ignore cancellation errors
        }
        delete renderTasks.value[pageNum]
      }
      
      try {
        const page = await pdfDocument.value.getPage(pageNum)
        
        // Account for device pixel ratio for sharp rendering on HiDPI displays
        // Limit pixel ratio to prevent canvas size from exceeding browser limits
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
        const currentScale = scale.value
        const viewport = page.getViewport({ scale: currentScale * pixelRatio })
        
        // Check canvas size limits (most browsers have a max canvas size of ~16384x16384)
        const MAX_CANVAS_SIZE = 16384
        if (viewport.width > MAX_CANVAS_SIZE || viewport.height > MAX_CANVAS_SIZE) {
          console.warn(`Canvas size too large (${viewport.width}x${viewport.height}), using lower resolution`)
          // Recalculate with lower pixel ratio
          const adjustedRatio = Math.min(
            MAX_CANVAS_SIZE / (page.getViewport({ scale: currentScale }).width),
            MAX_CANVAS_SIZE / (page.getViewport({ scale: currentScale }).height)
          )
          const adjustedViewport = page.getViewport({ scale: currentScale * adjustedRatio })
          return await renderPageWithViewport(page, canvas, adjustedViewport, adjustedRatio)
        }
        
        await renderPageWithViewport(page, canvas, viewport, pixelRatio)
      } catch (err) {
        if (err.name !== 'RenderingCancelledException') {
          console.error('Failed to render page:', pageNum, 'Error:', err)
          // Even if this page fails, continue with other pages - don't throw
        }
      } finally {
        delete renderTasks.value[pageNum]
      }
    }
    
    // Cancel all pending renders
    const cancelAllRenders = async () => {
      const tasks = Object.entries(renderTasks.value)
      for (const [pageNum, task] of tasks) {
        try {
          task.cancel()
        } catch (e) {
          // Ignore
        }
        delete renderTasks.value[pageNum]
      }
    }
    
    let renderVersion = 0 // Track render version to handle rapid scale changes
    
    const renderAllPages = async () => {
      if (!pdfDocument.value) return
      
      // Increment version to invalidate any in-progress renders
      const currentVersion = ++renderVersion
      
      // Cancel any existing renders first
      await cancelAllRenders()
      isRendering.value = false // Reset the lock
      
      // If another render was triggered while we were cancelling, abort this one
      if (currentVersion !== renderVersion) return
      
      isRendering.value = true
      
      // Wait for DOM to update with new canvases
      await nextTick()
      
      // Render all pages in parallel to avoid one page blocking others
      const pagesToRender = [...visiblePages.value]
      const renderPromises = pagesToRender.map(async (pageNum) => {
        // Check if a new render was triggered - abort
        if (currentVersion !== renderVersion) return
        
        if (canvasRefs.value[pageNum]) {
          try {
            await renderPage(pageNum)
          } catch (err) {
            // Log but don't stop other pages from rendering
            if (err.name !== 'RenderingCancelledException') {
              console.error('Page render failed:', pageNum, err)
            }
            // Continue with other pages
          }
        }
      })
      
      // Use allSettled instead of all to ensure all pages are attempted even if some fail
      await Promise.allSettled(renderPromises)
      
      isRendering.value = false
    }
    
    const handleDoubleClick = (event, pageNum) => {
      // Get click position relative to the page canvas
      const canvas = canvasRefs.value[pageNum]
      if (!canvas) return
      
      const rect = canvas.getBoundingClientRect()
      // Get position in screen space
      const screenX = event.clientX - rect.left
      const screenY = event.clientY - rect.top
      
      // Convert to document space by dividing by scale
      // This ensures annotations stay in the same relative position regardless of zoom
      const x = screenX / scale.value
      const y = screenY / scale.value
      
      // Create new annotation at click position
      store.dispatch('createAnnotation', {
        pageIndex: pageNum,
        x,
        y
      })
    }
    
    // Scroll to a specific page
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
    
    // Create debounced render function (150ms delay for smooth zoom)
    const debouncedRender = debounce(() => {
      renderAllPages()
    }, 150)
    
    // Track pending scale for immediate UI feedback
    const pendingScale = ref(null)
    
    const handleWheel = (event) => {
      // Ctrl+scroll to zoom
      if (event.ctrlKey) {
        event.preventDefault()
        
        const delta = -event.deltaY
        const zoomSpeed = 0.001
        const zoomChange = delta * zoomSpeed
        
        const newScale = Math.max(0.25, Math.min(4, scale.value + zoomChange))
        
        // Update scale immediately for responsive UI
        store.commit('SET_SCALE', newScale)
        
        // Mark that we have a pending scale change
        pendingScale.value = newScale
        
        // Debounce the actual rendering
        debouncedRender()
      }
    }
    
    // Click outside to deselect annotation
    const handleClickOutside = (event) => {
      const isInsideAnnotation = event.target.closest('.annotation-box')
      if (!isInsideAnnotation) {
        store.dispatch('selectAnnotation', null)
      }
    }
    
    // Watch for changes
    watch(pdfDocument, () => {
      nextTick(() => {
        renderAllPages()
      })
    }, { immediate: true })
    
    // Debounce scale changes to prevent rapid re-renders during zoom
    watch(scale, () => {
      // Only trigger immediate render if not from wheel event
      if (pendingScale.value === null) {
        nextTick(() => {
          renderAllPages()
        })
      } else {
        // Reset pending scale after debounced render completes
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
    
    // Watch for page navigation (from sidebar)
    watch(currentPage, (newPage) => {
      scrollToPage(newPage)
    })
    
    onMounted(() => {
      nextTick(() => {
        renderAllPages()
      })
      document.addEventListener('click', handleClickOutside)
      if (viewerContainer.value) {
        viewerContainer.value.addEventListener('wheel', handleWheel, { passive: false })
      }
    })
    
    onUnmounted(() => {
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
