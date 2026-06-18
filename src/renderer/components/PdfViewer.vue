<template>
  <div class="pdf-viewer" ref="viewerContainer" @scroll="handleScroll">
    <div class="pdf-pages-container">
      <div 
        v-for="pageNum in orderedPages"
        :key="pageNum"
        class="pdf-page-wrapper"
        :data-page="pageNum"
        :style="getPageShellStyle(pageNum)"
        @dblclick="handleDoubleClick($event, pageNum)"
      >
        <canvas 
          v-if="shouldRenderCanvas(pageNum)"
          :ref="el => setCanvasRef(el, pageNum)" 
          class="pdf-canvas"
        ></canvas>
        
        <div v-if="shouldRenderAnnotations(pageNum)" class="annotation-layer">
          <AnnotationBox
            v-for="annotation in getPageAnnotations(pageNum)"
            :key="annotation.id"
            :annotation="annotation"
            :scale="displayScale"
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
import { ref, computed, watch, onMounted, onUnmounted, shallowRef } from 'vue'
import { useStore } from 'vuex'
import AnnotationBox from './AnnotationBox.vue'

const MAX_CANVAS_SIZE = 16384
const PAGE_GAP = 20
const DEFAULT_PAGE_WIDTH = 612
const DEFAULT_PAGE_HEIGHT = 792
const MAX_CONCURRENT_RENDERS = 2
const OVERSCAN_RATIO = 0.5

function isCancelledError(err) {
  return err && err.name === 'RenderingCancelledException'
}

export default {
  name: 'PdfViewer',
  
  components: {
    AnnotationBox
  },
  
  setup() {
    const store = useStore()
    const viewerContainer = ref(null)
    
    // Reactive template state
    const displayScale = computed(() => store.state.scale)
    const rasterScale = ref(displayScale.value)
    const currentPage = computed(() => store.state.currentPage)
    const pdfDocument = computed(() => store.state.pdfDocument)
    const orderedPages = computed(() => store.getters.visiblePages)
    const selectedAnnotation = computed(() => store.state.selectedAnnotation)
    const additionalPdfs = computed(() => store.state.additionalPdfs)
    const renderWindowPages = shallowRef(new Set())
    const layoutVersion = ref(0)

    // Non-reactive render state
    const canvasRefs = new Map()
    const renderTasks = new Map()
    const renderedPages = new Set()
    const pageMetrics = new Map()
    const pendingPages = new Set()
    const inFlightRenders = new Set()

    let activeRenders = 0
    let renderGeneration = 0
    let estimatedWidth = DEFAULT_PAGE_WIDTH
    let estimatedHeight = DEFAULT_PAGE_HEIGHT
    let scrollTickPending = false
    let resizeTimeout = null
    let rasterCommitTimeout = null
    
    const setCanvasRef = (el, pageNum) => {
      if (el) {
        canvasRefs.set(pageNum, el)
        if (renderWindowPages.value.has(pageNum) && !renderedPages.has(pageNum)) {
          pendingPages.add(pageNum)
          processQueue()
        }
      } else {
        canvasRefs.delete(pageNum)
      }
    }
    
    const getPageAnnotations = (pageNum) => store.state.annotations[pageNum] || []
    
    const getPageShellStyle = (pageNum) => {
      // Reactive dependency: ensure shell styles update when metrics or estimates change
      void layoutVersion.value
      const metric = pageMetrics.get(pageNum)
      const width = (metric ? metric.width : estimatedWidth) * displayScale.value
      const height = (metric ? metric.height : estimatedHeight) * displayScale.value
      return {
        width: `${Math.floor(width)}px`,
        height: `${Math.floor(height)}px`
      }
    }
    
    const shouldRenderCanvas = (pageNum) => renderWindowPages.value.has(pageNum)
    
    const shouldRenderAnnotations = (pageNum) => {
      if (renderWindowPages.value.has(pageNum)) return true
      if (!selectedAnnotation.value) return false
      return getPageAnnotations(pageNum).some(a => a.id === selectedAnnotation.value)
    }
    
    const getPageSource = (pageNum) => {
      const source = store.getters.getPageSource(pageNum)
      return source && source.document ? source : null
    }
    
    const isCurrentRender = (pageNum, canvas, generation) => {
      return generation === renderGeneration &&
        renderWindowPages.value.has(pageNum) &&
        canvasRefs.get(pageNum) === canvas
    }
    
    const finishRenderTask = (pageNum, renderTask, generation) => {
      if (renderTasks.get(pageNum) !== renderTask) return
      renderTasks.delete(pageNum)
      // If generation changed, a reset/schedule cycle will requeue as needed.
      if (generation !== renderGeneration) return
      // Re-queue page now that its canvas is free, if it is still wanted.
      if (
        pdfDocument.value &&
        renderWindowPages.value.has(pageNum) &&
        !renderedPages.has(pageNum) &&
        canvasRefs.has(pageNum)
      ) {
        pendingPages.add(pageNum)
        processQueue()
      }
    }
    
    const recordPageMetric = (pageNum, metric) => {
      const existing = pageMetrics.get(pageNum)
      if (existing && existing.width === metric.width && existing.height === metric.height) {
        return
      }
      pageMetrics.set(pageNum, metric)
      // Avoid a separate layout bump if the estimate also changes; one bump covers both.
      const estimateChanged = recomputeEstimate()
      if (!estimateChanged) {
        void layoutVersion.value++
      }
    }

    const recomputeEstimate = () => {
      if (pageMetrics.size === 0) return false
      let totalWidth = 0
      let totalHeight = 0
      for (const metric of pageMetrics.values()) {
        totalWidth += metric.width
        totalHeight += metric.height
      }
      const newWidth = totalWidth / pageMetrics.size
      const newHeight = totalHeight / pageMetrics.size
      if (newWidth !== estimatedWidth || newHeight !== estimatedHeight) {
        estimatedWidth = newWidth
        estimatedHeight = newHeight
        void layoutVersion.value++
        return true
      }
      return false
    }
    
    const computeRenderWindow = () => {
      const container = viewerContainer.value
      if (!container || orderedPages.value.length === 0) return []
      
      const viewportTop = container.scrollTop
      const viewportBottom = viewportTop + container.clientHeight
      const overscan = Math.max(container.clientHeight * OVERSCAN_RATIO, 300)
      const windowTop = viewportTop - overscan
      const windowBottom = viewportBottom + overscan
      
      const offsets = new Map()
      let offset = 0
      for (const pageNum of orderedPages.value) {
        offsets.set(pageNum, offset)
        const metric = pageMetrics.get(pageNum)
        const height = (metric ? metric.height : estimatedHeight) * displayScale.value
        offset += height + PAGE_GAP
      }

      return orderedPages.value.filter(pageNum => {
        const top = offsets.get(pageNum)
        const metric = pageMetrics.get(pageNum)
        const height = (metric ? metric.height : estimatedHeight) * displayScale.value
        const bottom = top + height
        return bottom >= windowTop && top <= windowBottom
      })
    }
    
    const updateCanvasTransforms = () => {
      const ratio = displayScale.value / rasterScale.value
      if (ratio === 1) {
        for (const canvas of canvasRefs.values()) {
          canvas.style.transform = ''
          canvas.style.transformOrigin = ''
        }
        return
      }
      const transform = `scale(${ratio})`
      for (const canvas of canvasRefs.values()) {
        canvas.style.transform = transform
        canvas.style.transformOrigin = 'top left'
      }
    }

    const cancelRender = (pageNum) => {
      const task = renderTasks.get(pageNum)
      if (!task) return
      try {
        task.cancel()
      } catch (e) {
        // Cancellation is best-effort; stale render guards still prevent paint.
      }
      // Leave the task tracked until its promise settles in finishRenderTask
      // so the same canvas is never reused while pdf.js is still finishing.
    }

    const cancelAllRenders = () => {
      for (const task of renderTasks.values()) {
        try {
          task.cancel()
        } catch (e) {
          // Cancellation is best-effort; stale render guards still prevent paint.
        }
      }
      // Leave tasks tracked until their finally blocks run; renderPage awaits
      // any existing task before reusing its canvas.
    }
    
    const renderPageWithViewport = async (pageNum, page, canvas, viewport, pixelRatio, generation) => {
      const context = canvas.getContext('2d', { alpha: false })
      if (!context) return
      
      if (generation !== renderGeneration) return
      
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      canvas.style.width = `${Math.floor(viewport.width / pixelRatio)}px`
      canvas.style.height = `${Math.floor(viewport.height / pixelRatio)}px`
      
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      
      const renderTask = page.render({
        canvasContext: context,
        viewport,
        background: 'white'
      })
      renderTasks.set(pageNum, renderTask)
      
      try {
        await renderTask.promise
        if (isCurrentRender(pageNum, canvas, generation)) {
          renderedPages.add(pageNum)
          updateCanvasTransforms()
        }
      } catch (err) {
        if (!isCancelledError(err)) {
          console.error(`Page ${pageNum} render error:`, err.message)
        }
      } finally {
        finishRenderTask(pageNum, renderTask, generation)
      }
    }

    const renderPage = async (pageNum, generation) => {
      if (generation !== renderGeneration) return
      if (!pdfDocument.value) return

      const canvas = canvasRefs.get(pageNum)
      if (!canvas) return

      // Guard against reusing a canvas while pdf.js is still finishing a prior
      // render() on it. Wait for any active or cancelling task to settle first.
      const existingTask = renderTasks.get(pageNum)
      if (existingTask) {
        try {
          existingTask.cancel()
        } catch (e) {
          // Cancellation is best-effort.
        }
        try {
          await existingTask.promise
        } catch (e) {
          // Expected RenderingCancelledException or other cancellation errors.
        }
        if (generation !== renderGeneration) return
        if (!renderWindowPages.value.has(pageNum) || renderedPages.has(pageNum)) return
        // If another task started on this canvas while we awaited, let it win.
        const currentTask = renderTasks.get(pageNum)
        if (currentTask && currentTask !== existingTask) return
      }

      let page = null
      try {
        const source = getPageSource(pageNum)
        if (!source) return
        
        page = await source.document.getPage(source.actualPage)
        if (generation !== renderGeneration) return
        
        const baseViewport = page.getViewport({ scale: 1.0 })
        recordPageMetric(pageNum, { width: baseViewport.width, height: baseViewport.height })
        
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
        const viewport = page.getViewport({ scale: rasterScale.value * pixelRatio })

        let renderViewport = viewport
        let canvasPixelRatio = pixelRatio
        if (viewport.width > MAX_CANVAS_SIZE || viewport.height > MAX_CANVAS_SIZE) {
          const baseWidthAtScale = baseViewport.width * rasterScale.value
          const baseHeightAtScale = baseViewport.height * rasterScale.value
          const adjustedRatio = Math.min(
            MAX_CANVAS_SIZE / baseWidthAtScale,
            MAX_CANVAS_SIZE / baseHeightAtScale
          )
          renderViewport = page.getViewport({ scale: rasterScale.value * adjustedRatio })
          canvasPixelRatio = adjustedRatio
        }
        
        await renderPageWithViewport(pageNum, page, canvas, renderViewport, canvasPixelRatio, generation)
      } catch (err) {
        if (!isCancelledError(err)) {
          console.error(`Failed to render page ${pageNum}:`, err)
        }
      } finally {
        if (page) page.cleanup()
      }
    }
    
    const processQueue = () => {
      if (activeRenders >= MAX_CONCURRENT_RENDERS || pendingPages.size === 0) return

      const pageNum = pendingPages.values().next().value

      if (
        !renderWindowPages.value.has(pageNum) ||
        renderedPages.has(pageNum) ||
        inFlightRenders.has(pageNum)
      ) {
        pendingPages.delete(pageNum)
        processQueue()
        return
      }

      pendingPages.delete(pageNum)
      inFlightRenders.add(pageNum)
      activeRenders++
      const generation = renderGeneration
      renderPage(pageNum, generation).finally(() => {
        inFlightRenders.delete(pageNum)
        activeRenders--
        processQueue()
      })

      processQueue()
    }
    
    const scheduleRenderWindow = () => {
      if (!pdfDocument.value || !viewerContainer.value) return
      if (orderedPages.value.length === 0) return
      
      pendingPages.clear()
      const windowPages = computeRenderWindow()
      renderWindowPages.value = new Set(windowPages)
      const renderWindowSet = renderWindowPages.value
      
      for (const pageNum of Array.from(renderTasks.keys())) {
        if (!renderWindowSet.has(pageNum)) {
          cancelRender(pageNum)
        }
      }
      
      // Prune rendered state outside the new window
      for (const pageNum of Array.from(renderedPages)) {
        if (!renderWindowSet.has(pageNum)) {
          renderedPages.delete(pageNum)
        }
      }
      
      for (const pageNum of windowPages) {
        if (!renderedPages.has(pageNum)) {
          pendingPages.add(pageNum)
        }
      }
      
      processQueue()
    }
    
    const commitRasterScale = () => {
      if (rasterScale.value === displayScale.value) return
      rasterScale.value = displayScale.value
      bumpGeneration()
      resetRenderState()
      scheduleRenderWindow()
    }

    const debounceCommitRasterScale = () => {
      clearTimeout(rasterCommitTimeout)
      rasterCommitTimeout = setTimeout(commitRasterScale, 250)
    }

    const bumpGeneration = () => {
      renderGeneration++
    }
    
    const resetRenderState = () => {
      cancelAllRenders()
      renderedPages.clear()
      pendingPages.clear()
    }
    
    const handleScroll = () => {
      if (scrollTickPending) return
      scrollTickPending = true
      requestAnimationFrame(() => {
        scrollTickPending = false
        scheduleRenderWindow()
      })
    }
    
    const handleResize = () => {
      clearTimeout(resizeTimeout)
      resizeTimeout = setTimeout(() => scheduleRenderWindow(), 150)
    }
    
    const handleWheel = (event) => {
      if (event.ctrlKey) {
        event.preventDefault()
        const delta = -event.deltaY
        const zoomSpeed = 0.001
        const zoomChange = delta * zoomSpeed
        const newScale = Math.max(0.25, Math.min(4, displayScale.value + zoomChange))
        store.commit('SET_SCALE', newScale)
      }
    }
    
    const handleDoubleClick = (event, pageNum) => {
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
      
      const rect = event.currentTarget.getBoundingClientRect()
      const screenX = event.clientX - rect.left
      const screenY = event.clientY - rect.top
      const x = screenX / displayScale.value
      const y = screenY / displayScale.value
      
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
    
    const handleClickOutside = (event) => {
      const isInsideAnnotation = event.target.closest('.annotation-box')
      if (!isInsideAnnotation) {
        store.dispatch('selectAnnotation', null)
      }
    }
    
    watch(pdfDocument, () => {
      bumpGeneration()
      resetRenderState()
      pageMetrics.clear()
      estimatedWidth = DEFAULT_PAGE_WIDTH
      estimatedHeight = DEFAULT_PAGE_HEIGHT
      rasterScale.value = displayScale.value
      void layoutVersion.value++
      scheduleRenderWindow()
    })

    watch(displayScale, () => {
      // Instant visual feedback: shells/annotations follow display scale,
      // existing canvases are CSS-scaled, high-res rerender is debounced.
      updateCanvasTransforms()
      scheduleRenderWindow()
      debounceCommitRasterScale()
    })

    watch(orderedPages, () => {
      bumpGeneration()
      resetRenderState()
      // Drop metrics and canvas refs for pages that no longer exist (deletion/reorder)
      const validPages = new Set(orderedPages.value)
      for (const pageNum of pageMetrics.keys()) {
        if (!validPages.has(pageNum)) pageMetrics.delete(pageNum)
      }
      for (const pageNum of canvasRefs.keys()) {
        if (!validPages.has(pageNum)) canvasRefs.delete(pageNum)
      }
      if (pageMetrics.size === 0) {
        estimatedWidth = DEFAULT_PAGE_WIDTH
        estimatedHeight = DEFAULT_PAGE_HEIGHT
      }
      void layoutVersion.value++
      scheduleRenderWindow()
    })
    
    watch(currentPage, (newPage) => {
      scrollToPage(newPage)
    })
    
    watch(selectedAnnotation, () => {
      // Ensure selected annotation stays mounted if its page leaves the window
      scheduleRenderWindow()
    })
    
    watch(additionalPdfs, () => {
      // Additional concatenated PDFs may finish loading after the main document;
      // reschedule so their pages can render once page-source mapping is ready.
      scheduleRenderWindow()
    }, { deep: true })
    
    onMounted(() => {
      document.addEventListener('click', handleClickOutside)
      window.addEventListener('resize', handleResize)
      if (viewerContainer.value) {
        viewerContainer.value.addEventListener('wheel', handleWheel, { passive: false })
      }
      
      if (pdfDocument.value) {
        bumpGeneration()
        rasterScale.value = displayScale.value
        scheduleRenderWindow()
      }
    })

    onUnmounted(() => {
      cancelAllRenders()
      document.removeEventListener('click', handleClickOutside)
      window.removeEventListener('resize', handleResize)
      if (viewerContainer.value) {
        viewerContainer.value.removeEventListener('wheel', handleWheel)
      }
      clearTimeout(resizeTimeout)
      clearTimeout(rasterCommitTimeout)
    })

    return {
      viewerContainer,
      displayScale,
      orderedPages,
      setCanvasRef,
      getPageShellStyle,
      shouldRenderCanvas,
      shouldRenderAnnotations,
      getPageAnnotations,
      handleDoubleClick,
      handleScroll,
      selectAnnotation,
      updateAnnotation,
      deleteAnnotation,
      scrollToPage
    }
  }
}
</script>

<style scoped>
/* Component-specific styles are in main.css */
</style>
