<template>
  <!-- The chat drawn into its own window: same app, same store, same live
       conversation; only the DOM lives in the other window's document -->
  <Teleport
    v-if="target"
    :to="target"
  >
    <ChatPanel
      popout
      @dock="dock"
      @open-settings="$emit('open-settings')"
      @window-minimize="send('chat-popout:minimize')"
      @window-maximize="send('chat-popout:toggle-maximize')"
      @window-close="closeWindow"
    />
  </Teleport>
</template>

<script>
import { onMounted, onUnmounted, shallowRef, watch } from 'vue'
import { useStore } from 'vuex'
import ChatPanel from './ChatPanel.vue'

let ipcRenderer = null
try {
  ipcRenderer = window.require('electron').ipcRenderer
} catch (e) {
  // Not in Electron
}

const DEFAULT_SIZE = { width: 480, height: 760 }

export default {
  name: 'ChatPopout',

  components: { ChatPanel },

  props: {
    // Window title (e.g. "Chat - paper.pdf")
    title: { type: String, default: 'Chat' }
  },

  // dock: back into the main window (button, or the window was closed);
  // window: the new Window, for app-wide shortcuts
  emits: ['dock', 'window', 'open-settings'],

  setup(props, { emit }) {
    const store = useStore()
    const target = shallowRef(null)
    let child = null
    let observers = []
    let closedPoll = null

    const send = (channel) => ipcRenderer?.send(channel)

    // The app's stylesheets (style-loader <style> tags) and theme classes
    const copyStyle = (node) => child.document.head.appendChild(node.cloneNode(true))
    const syncThemeClasses = () => {
      // Not custom-titlebar: this window has no app title bar above the chat
      child.document.documentElement.className = [...document.documentElement.classList]
        .filter(name => name !== 'custom-titlebar').join(' ')
    }

    const cleanUp = () => {
      for (const observer of observers) observer.disconnect()
      observers = []
      clearInterval(closedPoll)
      target.value = null
      const win = child
      child = null
      return win
    }

    // The window went away (its close button, Alt+F4): the chat docks back
    const onWindowGone = () => {
      if (!child) return
      cleanUp()
      emit('dock')
    }

    const dock = () => emit('dock')
    const closeWindow = () => child?.close()

    // Ctrl+drag anywhere in the window moves it (the main process follows
    // the pointer's screen position); holding Ctrl shows the move cursor
    let moving = false
    const setRootClass = (name, on) => child?.document.documentElement.classList.toggle(name, on)
    const stopEvent = (event) => {
      event.preventDefault()
      event.stopPropagation()
    }
    const onCtrlMouseDown = (event) => {
      if (!event.ctrlKey || event.button !== 0 || !ipcRenderer) return
      // Moving, not clicking, selecting or focusing what is under the pointer
      stopEvent(event)
      moving = true
      setRootClass('window-moving', true)
      ipcRenderer.send('chat-popout:drag-start', { x: event.screenX, y: event.screenY })
    }
    const onMoveDrag = (event) => {
      if (!moving) return
      stopEvent(event)
      ipcRenderer.send('chat-popout:drag-move', { x: event.screenX, y: event.screenY })
    }
    const onEndDrag = (event) => {
      if (!moving) return
      moving = false
      setRootClass('window-moving', false)
      ipcRenderer.send('chat-popout:drag-end')
      if (event?.type !== 'mouseup' || !child) return
      // The press and release make a click on what is under the pointer: drop it
      child.addEventListener('click', stopEvent, { capture: true, once: true })
      setTimeout(() => child?.removeEventListener('click', stopEvent, true), 0)
    }
    const onCtrlKey = (event) => {
      if (event.key === 'Control') setRootClass('ctrl-move', event.type === 'keydown')
    }
    const onBlur = (event) => {
      setRootClass('ctrl-move', false)
      onEndDrag(event)
    }
    const dragListeners = [
      ['mousedown', onCtrlMouseDown, true],
      ['mousemove', onMoveDrag, true],
      ['mouseup', onEndDrag, true],
      ['keydown', onCtrlKey, true],
      ['keyup', onCtrlKey, true],
      ['blur', onBlur, false]
    ]

    onMounted(() => {
      const bounds = store.state.settings.chat.popoutBounds
      const features = [
        'popup=yes',
        `width=${Math.round(bounds?.width || DEFAULT_SIZE.width)}`,
        `height=${Math.round(bounds?.height || DEFAULT_SIZE.height)}`,
        ...(bounds && Number.isFinite(bounds.x) && Number.isFinite(bounds.y) ? [`left=${Math.round(bounds.x)}`, `top=${Math.round(bounds.y)}`] : [])
      ].join(',')
      child = window.open('', 'chat-popout', features)
      if (!child) {
        emit('dock')
        return
      }

      const doc = child.document
      // Standards mode, and relative URLs (fonts) resolve like in the app
      doc.open()
      doc.write('<!doctype html><html><head><meta charset="utf-8"></head><body class="chat-popout-body"></body></html>')
      doc.close()
      const base = doc.createElement('base')
      base.href = document.baseURI
      doc.head.appendChild(base)
      doc.title = props.title

      for (const node of document.head.querySelectorAll('style, link[rel="stylesheet"]')) copyStyle(node)
      const styles = new MutationObserver(records => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (node.matches?.('style, link[rel="stylesheet"]')) copyStyle(node)
          }
        }
      })
      styles.observe(document.head, { childList: true })
      syncThemeClasses()
      const theme = new MutationObserver(syncThemeClasses)
      theme.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
      observers = [styles, theme]

      const root = doc.createElement('div')
      root.className = 'chat-popout-root'
      doc.body.appendChild(root)
      target.value = root

      for (const [type, listener, capture] of dragListeners) child.addEventListener(type, listener, capture)
      child.addEventListener('pagehide', onWindowGone)
      // Safety net in case the window disappears without pagehide
      closedPoll = setInterval(() => { if (child?.closed) onWindowGone() }, 1000)
      emit('window', child)
    })

    watch(() => props.title, (title) => { if (child) child.document.title = title })

    onUnmounted(() => {
      const win = cleanUp()
      if (win && !win.closed) {
        win.removeEventListener('pagehide', onWindowGone)
        win.close()
      }
      emit('window', null)
    })

    return { target, dock, closeWindow, send }
  }
}
</script>
