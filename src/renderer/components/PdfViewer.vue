<template>
  <div
    ref="viewerContainer"
    class="pdf-viewer"
    @scroll="handleScroll"
    @mouseup="handleViewerMouseUp"
  >
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

        <!-- Text highlights: above the page image, below the text layer -->
        <div
          v-if="shouldRenderCanvas(pageNum) && getPageHighlights(pageNum).length"
          class="highlight-layer"
          aria-hidden="true"
        >
          <template
            v-for="highlight in getPageHighlights(pageNum)"
            :key="highlight.id"
          >
            <div
              v-for="(rect, index) in highlight.rects"
              :key="index"
              class="pdf-highlight"
              :data-highlight-id="highlight.id"
              :style="getHighlightRectStyle(rect, highlight.color)"
            />
          </template>
        </div>

        <div
          v-if="shouldRenderTextLayer(pageNum)"
          :ref="el => setTextLayerRef(el, pageNum)"
          class="textLayer"
        ></div>

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

        <HighlightMenu
          v-if="highlightMenu && highlightMenu.pageId === pageNum"
          :style="highlightMenuStyle"
          :mode="highlightMenu.mode"
          :color="highlightMenu.color"
          :can-remove="highlightMenu.canRemove"
          @pick="pickHighlightColor"
          @remove="removeMenuHighlights"
        />
      </div>
    </div>
  </div>
</template>

<script>
import { ref, computed, nextTick, watch, onMounted, onUnmounted, shallowRef } from 'vue'
import { useStore } from 'vuex'
import { TextLayer } from 'pdfjs-dist'
import AnnotationBox from './AnnotationBox.vue'
import HighlightMenu from './HighlightMenu.vue'
import { highlightAt, mergeLineRects, overlappingHighlights } from '../utils/highlights'
import { highlightTextDivs, restoreTextDivs } from '../utils/pdfSearch'

const MAX_CANVAS_SIZE = 16384
const PAGE_GAP = 20
const DEFAULT_PAGE_WIDTH = 612
const DEFAULT_PAGE_HEIGHT = 792
const MAX_CONCURRENT_RENDERS = 2
const OVERSCAN_RATIO = 0.5

function isCancelledError(err) {
  return err && (err.name === 'RenderingCancelledException' || err.name === 'AbortException')
}

export default {
  name: 'PdfViewer',
  
  components: {
    AnnotationBox,
    HighlightMenu
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

    // Text layer state
    const textLayerRefs = new Map()
    const textLayerEntries = new Map()
    const textLayerTasks = new Map()
    const renderedTextLayers = new Set()
    const baseViewports = new Map()
    // Find: text layer spans changed by the highlights, per page
    const highlightedDivs = new Map()
    // Current match waiting for its page's text layer before scrolling to it
    let pendingReveal = null

    let activeRenders = 0
    let renderGeneration = 0
    let estimatedWidth = DEFAULT_PAGE_WIDTH
    let estimatedHeight = DEFAULT_PAGE_HEIGHT
    let scrollTickPending = false
    let resizeTimeout = null
    let rasterCommitTimeout = null
    let textScaleUpdateTimeout = null
    
    const setCanvasRef = (el, pageNum) => {
      if (el) {
        canvasRefs.set(pageNum, el)
      if (renderWindowPages.value.has(pageNum) && !renderedPages.has(pageNum)) {
        pendingPages.add(pageNum)
        // Wait for Vue to finish mounting the canvas before starting a render.
        // Queueing synchronously here can race the first render pass and leave
        // the canvas at its default 300x150 size until the user scrolls.
        nextTick(processQueue)
      }
      } else {
        canvasRefs.delete(pageNum)
      }
    }
    
    const setTextLayerRef = (el, pageNum) => {
      if (el) {
        textLayerRefs.set(pageNum, el)
      } else {
        textLayerRefs.delete(pageNum)
        cancelTextLayer(pageNum)
        baseViewports.delete(pageNum)
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

    const shouldRenderTextLayer = (pageNum) => renderWindowPages.value.has(pageNum)
    
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

      // Page under the middle of the viewport ("the page being read")
      const viewportMiddle = (viewportTop + viewportBottom) / 2
      let middlePage = orderedPages.value[0]
      for (const pageNum of orderedPages.value) {
        if (offsets.get(pageNum) <= viewportMiddle) middlePage = pageNum
        else break
      }
      if (store.state.viewPage !== middlePage) store.commit('SET_VIEW_PAGE', middlePage)

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

    const cancelTextLayer = (pageNum) => {
      const task = textLayerTasks.get(pageNum)
      if (task) {
        try {
          task.layer.cancel()
        } catch (e) {
          // Cancellation is best-effort; stale text layer guards still apply.
        }
        textLayerTasks.delete(pageNum)
      }

      const entry = textLayerEntries.get(pageNum)
      if (entry) {
        try {
          entry.layer.cancel()
        } catch (e) {
          // Cancellation is best-effort.
        }
        textLayerEntries.delete(pageNum)
      }

      renderedTextLayers.delete(pageNum)
      highlightedDivs.delete(pageNum)

      const container = textLayerRefs.get(pageNum)
      if (container) {
        container.replaceChildren()
      }
    }

    // --- Text highlights (see utils/highlights.js) ---------------------------
    const getPageHighlights = (pageNum) => store.state.highlights[pageNum] || []

    const getHighlightRectStyle = (rect, color) => {
      const scale = displayScale.value
      return {
        left: `${rect.x * scale}px`,
        top: `${rect.y * scale}px`,
        width: `${rect.w * scale}px`,
        height: `${rect.h * scale}px`,
        backgroundColor: color
      }
    }

    // Selected PDF text as [{ pageId, rects, text }], rectangles in page
    // units; text outside the text layers (notes) is left out
    const getSelectionTargets = () => {
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return []
      const range = selection.getRangeAt(0)
      const common = range.commonAncestorContainer
      const root = common.nodeType === Node.ELEMENT_NODE ? common : common.parentElement
      if (!root || !viewerContainer.value?.contains(root)) return []

      const scale = displayScale.value
      const byPage = new Map()
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!range.intersectsNode(node)) continue
        const parent = node.parentElement
        const wrapper = parent?.closest('.textLayer')?.closest('.pdf-page-wrapper')
        if (!wrapper) continue
        const start = node === range.startContainer ? range.startOffset : 0
        const end = node === range.endContainer ? range.endOffset : node.length
        if (end <= start) continue

        const pageId = Number(wrapper.dataset.page)
        if (!byPage.has(pageId)) byPage.set(pageId, { pageId, rects: [], text: '' })
        const entry = byPage.get(pageId)
        const origin = wrapper.getBoundingClientRect()
        const part = document.createRange()
        part.setStart(node, start)
        part.setEnd(node, end)
        for (const r of part.getClientRects()) {
          entry.rects.push({ x: (r.left - origin.left) / scale, y: (r.top - origin.top) / scale, w: r.width / scale, h: r.height / scale })
        }
        // Text layer spans end a line with a <br>
        const textSpan = parent.classList.contains('search-hit') ? parent.parentElement : parent
        entry.text += node.textContent.slice(start, end)
        if (end === node.length && textSpan.nextSibling?.nodeName === 'BR') entry.text += '\n'
      }
      return [...byPage.values()]
        .map(entry => ({ ...entry, rects: mergeLineRects(entry.rects), text: entry.text.replace(/[ \t]+/g, ' ').trim() }))
        .filter(entry => entry.rects.length)
    }

    // Menu shown under selected text or a clicked highlight:
    // { mode, pageId, x, y (page units), targets, ids, color, canRemove }
    const highlightMenu = ref(null)
    const closeHighlightMenu = () => { highlightMenu.value = null }

    const highlightMenuStyle = computed(() => {
      const menu = highlightMenu.value
      if (!menu) return null
      void layoutVersion.value
      const scale = displayScale.value
      const pageWidth = (pageMetrics.get(menu.pageId)?.width ?? estimatedWidth) * scale
      return {
        left: `${Math.max(4, Math.min(menu.x * scale, pageWidth - 330))}px`,
        top: `${menu.y * scale + 6}px`
      }
    })

    const openSelectionMenu = (targets) => {
      const last = targets[targets.length - 1]
      const rect = last.rects[last.rects.length - 1]
      const overlapped = targets.flatMap(t => overlappingHighlights(getPageHighlights(t.pageId), t.rects))
      highlightMenu.value = {
        mode: 'selection',
        pageId: last.pageId,
        x: rect.x,
        y: rect.y + rect.h,
        targets,
        ids: overlapped.map(h => h.id),
        color: store.state.settings.ui.highlightColor,
        canRemove: overlapped.length > 0
      }
    }

    // After a mouse selection, or a click on a highlight, show the menu
    const handleViewerMouseUp = (event) => {
      if (event.button !== 0) return
      if (event.target.closest?.('.highlight-menu, .annotation-box, .style-panel')) return
      const { clientX, clientY } = event
      const wrapper = event.target.closest?.('.pdf-page-wrapper')
      // Let the selection settle first (e.g. a double-clicked word)
      setTimeout(() => {
        const targets = getSelectionTargets()
        if (targets.length) {
          openSelectionMenu(targets)
          return
        }
        if (!wrapper) return closeHighlightMenu()
        const pageId = Number(wrapper.dataset.page)
        const origin = wrapper.getBoundingClientRect()
        const scale = displayScale.value
        const hit = highlightAt(getPageHighlights(pageId), (clientX - origin.left) / scale, (clientY - origin.top) / scale)
        if (!hit) return closeHighlightMenu()
        highlightMenu.value = {
          mode: 'highlight',
          pageId,
          x: hit.rect.x,
          y: hit.rect.y + hit.rect.h,
          targets: [],
          ids: [hit.highlight.id],
          color: hit.highlight.color,
          canRemove: true
        }
      }, 0)
    }

    const pickHighlightColor = (color) => {
      const menu = highlightMenu.value
      if (!menu) return
      store.dispatch('setHighlightColor', color)
      if (menu.mode === 'selection') {
        store.dispatch('highlightTargets', { targets: menu.targets, color })
        window.getSelection()?.removeAllRanges()
      } else {
        store.dispatch('recolorHighlights', { ids: menu.ids, color })
      }
      closeHighlightMenu()
    }

    const removeMenuHighlights = () => {
      const menu = highlightMenu.value
      if (!menu) return
      store.dispatch('removeHighlights', menu.ids)
      if (menu.mode === 'selection') window.getSelection()?.removeAllRanges()
      closeHighlightMenu()
    }

    // Ctrl+Shift+H (Edit > Highlight Selection): remove the highlights in the
    // selection if there are any, otherwise highlight it
    const toggleSelectionHighlight = () => {
      const targets = getSelectionTargets()
      if (!targets.length) {
        if (highlightMenu.value?.mode === 'highlight') removeMenuHighlights()
        return
      }
      const overlapped = targets.flatMap(t => overlappingHighlights(getPageHighlights(t.pageId), t.rects))
      if (overlapped.length) store.dispatch('removeHighlights', overlapped.map(h => h.id))
      else store.dispatch('highlightTargets', { targets })
      window.getSelection()?.removeAllRanges()
      closeHighlightMenu()
    }

    // Close the menu on a press anywhere else, and on Esc
    const onDocumentMouseDown = (event) => {
      if (highlightMenu.value && !event.target.closest?.('.highlight-menu')) closeHighlightMenu()
    }
    const onDocumentKeyDown = (event) => {
      if (event.key === 'Escape' && highlightMenu.value) closeHighlightMenu()
    }

    // --- Find (search bar, see store/search.js) ------------------------------
    // Matches to highlight, per page; the current one is "selected"
    const matchesByPage = computed(() => {
      const byPage = new Map()
      const { open, matches, current } = store.state.search
      if (!open) return byPage
      matches.forEach((match, index) => {
        if (!byPage.has(match.pageId)) byPage.set(match.pageId, [])
        byPage.get(match.pageId).push({ segments: match.segments, selected: index === current })
      })
      return byPage
    })

    const highlightPage = (pageNum) => {
      const entry = textLayerEntries.get(pageNum)
      if (!entry) return
      const { textDivs, textContentItemsStr } = entry.layer
      const previous = highlightedDivs.get(pageNum)
      if (previous) restoreTextDivs(textDivs, textContentItemsStr, previous)
      const changed = highlightTextDivs(textDivs, textContentItemsStr, matchesByPage.value.get(pageNum) || [])
      if (changed.length) highlightedDivs.set(pageNum, changed)
      else highlightedDivs.delete(pageNum)
    }

    const highlightAllPages = () => {
      for (const pageNum of textLayerEntries.keys()) highlightPage(pageNum)
    }

    // Scroll so the element is in view (centered), unless it already is
    const scrollIntoViewer = (element) => {
      const container = viewerContainer.value
      if (!container) return
      const view = container.getBoundingClientRect()
      const rect = element.getBoundingClientRect()
      const margin = 40
      if (rect.top < view.top + margin || rect.bottom > view.bottom - margin) {
        container.scrollTop += (rect.top + rect.height / 2) - (view.top + view.height / 2)
      }
      if (rect.left < view.left || rect.right > view.right) {
        container.scrollLeft += (rect.left + rect.width / 2) - (view.left + view.width / 2)
      }
    }

    const revealCurrentMatch = () => {
      const match = store.state.search.open ? store.getters['search/currentMatch'] : null
      pendingReveal = null
      if (!match) return
      const hit = textLayerEntries.has(match.pageId) &&
        textLayerRefs.get(match.pageId)?.querySelector('.search-hit.selected')
      if (hit) {
        scrollIntoViewer(hit)
        return
      }
      // Bring the page into view; its text layer renders and highlightPage
      // finishes the scroll
      pendingReveal = match
      const container = viewerContainer.value
      const wrapper = container?.querySelector(`[data-page="${match.pageId}"]`)
      if (wrapper) {
        container.scrollTop += wrapper.getBoundingClientRect().top - container.getBoundingClientRect().top
      }
    }

    watch(
      () => [matchesByPage.value, store.state.search.revealNonce],
      ([byPage, nonce], [oldByPage, oldNonce] = []) => {
        if (byPage !== oldByPage) highlightAllPages()
        if (nonce !== oldNonce) revealCurrentMatch()
      }
    )

    const cancelAllTextLayers = () => {
      const pageNums = new Set([
        ...textLayerTasks.keys(),
        ...textLayerEntries.keys(),
        ...renderedTextLayers
      ])
      for (const pageNum of pageNums) {
        cancelTextLayer(pageNum)
      }
    }

    const syncTextLayerScale = () => {
      const scale = String(displayScale.value)
      for (const container of textLayerRefs.values()) {
        container.style.setProperty('--scale-factor', scale)
      }
    }

    const updateTextLayerViewports = () => {
      const scale = displayScale.value
      for (const [pageNum, entry] of textLayerEntries) {
        const container = textLayerRefs.get(pageNum)
        if (!container || textLayerTasks.has(pageNum)) continue
        container.style.setProperty('--scale-factor', String(scale))
        try {
          entry.layer.update({
            viewport: entry.baseViewport.clone({ scale })
          })
        } catch (e) {
          // Stale layers are discarded by the next render.
        }
      }
    }

    const scheduleTextLayerScaleUpdate = () => {
      syncTextLayerScale()
      clearTimeout(textScaleUpdateTimeout)
      textScaleUpdateTimeout = setTimeout(() => {
        textScaleUpdateTimeout = null
        updateTextLayerViewports()
      }, 150)
    }

    const renderTextLayer = async (pageNum, page, baseViewport, generation) => {
      const container = textLayerRefs.get(pageNum)
      if (!container) return

      if (renderedTextLayers.has(pageNum) && textLayerEntries.has(pageNum)) {
        return
      }

      // Replace any previous text layer for this page.
      cancelTextLayer(pageNum)
      container.replaceChildren()

      const scale = displayScale.value
      container.style.setProperty('--scale-factor', String(scale))

      const layer = new TextLayer({
        textContentSource: page.streamTextContent({ includeMarkedContent: true }),
        container,
        viewport: baseViewport.clone({ scale })
      })
      const task = { layer, container }
      textLayerTasks.set(pageNum, task)

      try {
        await layer.render()

        if (
          generation !== renderGeneration ||
          textLayerRefs.get(pageNum) !== container ||
          textLayerTasks.get(pageNum) !== task
        ) {
          return
        }

        const currentScale = displayScale.value
        if (currentScale !== scale) {
          layer.update({
            viewport: baseViewport.clone({ scale: currentScale })
          })
          container.style.setProperty('--scale-factor', String(currentScale))
        }

        renderedTextLayers.add(pageNum)
        textLayerEntries.set(pageNum, { layer, baseViewport })
        highlightPage(pageNum)
        if (pendingReveal?.pageId === pageNum) revealCurrentMatch()
      } catch (err) {
        if (!isCancelledError(err)) {
          console.error(`Page ${pageNum} text layer error:`, err)
        }
      } finally {
        if (textLayerTasks.get(pageNum) === task) {
          textLayerTasks.delete(pageNum)
        }
      }
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
        baseViewports.set(pageNum, baseViewport)
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
        
        await Promise.all([
          renderPageWithViewport(pageNum, page, canvas, renderViewport, canvasPixelRatio, generation),
          renderTextLayer(pageNum, page, baseViewport, generation)
        ])
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
          target.closest('.highlight-menu') ||
          target.closest('.textLayer span') ||
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
      cancelAllTextLayers()
      textLayerRefs.clear()
      textLayerEntries.clear()
      textLayerTasks.clear()
      renderedTextLayers.clear()
      baseViewports.clear()
      highlightedDivs.clear()
      pendingReveal = null
      closeHighlightMenu()
      clearTimeout(textScaleUpdateTimeout)
      textScaleUpdateTimeout = null
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
      scheduleTextLayerScaleUpdate()
      updateCanvasTransforms()
      scheduleRenderWindow()
      debounceCommitRasterScale()
    })

    watch(orderedPages, () => {
      closeHighlightMenu()
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
      const textLayerPages = new Set([
        ...textLayerRefs.keys(),
        ...textLayerEntries.keys(),
        ...textLayerTasks.keys(),
        ...renderedTextLayers,
        ...baseViewports.keys()
      ])
      for (const pageNum of textLayerPages) {
        if (!validPages.has(pageNum)) {
          cancelTextLayer(pageNum)
          textLayerRefs.delete(pageNum)
          baseViewports.delete(pageNum)
        }
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
    
    // Explicit navigation requests (e.g. clicking a chat context) scroll even
    // when the target equals currentPage, which does not follow scrolling
    watch(() => store.state.scrollRequest, (request) => {
      if (request) scrollToPage(request.pageId)
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
      document.addEventListener('mousedown', onDocumentMouseDown, true)
      document.addEventListener('keydown', onDocumentKeyDown)
      window.addEventListener('pdf:toggle-highlight', toggleSelectionHighlight)
      window.addEventListener('resize', handleResize)
      if (viewerContainer.value) {
        viewerContainer.value.addEventListener('wheel', handleWheel, { passive: false })
      }
      
      if (pdfDocument.value) {
        bumpGeneration()
        rasterScale.value = displayScale.value
        scheduleRenderWindow()
        // The first pass only creates the canvas elements; run a second pass
        // once they exist so the initial page rasterizes without user input.
        nextTick(() => scheduleRenderWindow())
      }
    })

    onUnmounted(() => {
      cancelAllRenders()
      cancelAllTextLayers()
      document.removeEventListener('click', handleClickOutside)
      document.removeEventListener('mousedown', onDocumentMouseDown, true)
      document.removeEventListener('keydown', onDocumentKeyDown)
      window.removeEventListener('pdf:toggle-highlight', toggleSelectionHighlight)
      window.removeEventListener('resize', handleResize)
      if (viewerContainer.value) {
        viewerContainer.value.removeEventListener('wheel', handleWheel)
      }
      clearTimeout(resizeTimeout)
      clearTimeout(rasterCommitTimeout)
      clearTimeout(textScaleUpdateTimeout)
    })

    return {
      getPageHighlights,
      getHighlightRectStyle,
      highlightMenu,
      highlightMenuStyle,
      handleViewerMouseUp,
      pickHighlightColor,
      removeMenuHighlights,
      viewerContainer,
      displayScale,
      orderedPages,
      setCanvasRef,
      setTextLayerRef,
      getPageShellStyle,
      shouldRenderCanvas,
      shouldRenderTextLayer,
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
