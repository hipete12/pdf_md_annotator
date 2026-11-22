<template>
  <header
    class="titlebar"
    :class="{ blurred: !focused }"
  >
    <nav
      ref="menuBar"
      class="titlebar-menu"
      aria-label="Application menu"
    >
      <div
        v-for="menu in topMenus"
        :key="menu.index"
        class="titlebar-menu-entry"
      >
        <!-- mousedown.prevent: keep focus in the editor so Edit > Copy etc.
             act on it, like the native menu -->
        <button
          class="titlebar-menu-button"
          :class="{ open: openIndex === menu.index }"
          type="button"
          aria-haspopup="menu"
          :aria-expanded="openIndex === menu.index"
          @mousedown.prevent="toggleMenu(menu.index)"
          @mouseenter="hoverMenu(menu.index)"
        >
          {{ menu.label }}
        </button>

        <div
          v-if="openIndex === menu.index"
          class="titlebar-dropdown"
          role="menu"
          @mousedown.prevent
        >
          <template
            v-for="(item, row) in menu.items"
            :key="item.index"
          >
            <div
              v-if="item.type === 'separator'"
              class="titlebar-separator"
              role="separator"
            />
            <div
              v-else
              class="titlebar-item"
              :class="{ disabled: !item.enabled, active: activeRow === row }"
              role="menuitem"
              :aria-disabled="!item.enabled"
              :aria-haspopup="item.submenu ? 'menu' : null"
              @mouseenter="hoverRow(row)"
              @click="activate(menu, row)"
            >
              <span class="titlebar-item-check">{{ item.checked ? '✓' : '' }}</span>
              <span class="titlebar-item-label">{{ item.label }}</span>
              <span class="titlebar-item-accel">{{ item.accelerator }}</span>
              <span
                v-if="item.submenu"
                class="titlebar-item-arrow"
              >›</span>

              <div
                v-if="item.submenu && activeRow === row && submenuOpen"
                class="titlebar-dropdown titlebar-submenu"
                role="menu"
              >
                <div
                  v-if="item.submenu.length === 0"
                  class="titlebar-item disabled"
                >
                  <span class="titlebar-item-check" />
                  <span class="titlebar-item-label">Empty</span>
                </div>
                <template
                  v-for="(sub, subRow) in item.submenu"
                  :key="sub.index"
                >
                  <div
                    v-if="sub.type === 'separator'"
                    class="titlebar-separator"
                    role="separator"
                  />
                  <div
                    v-else
                    class="titlebar-item"
                    :class="{ disabled: !sub.enabled, active: activeSubRow === subRow }"
                    role="menuitem"
                    :aria-disabled="!sub.enabled"
                    @mouseenter="activeSubRow = subRow"
                    @click.stop="activateSub(menu, row, subRow)"
                  >
                    <span class="titlebar-item-check">{{ sub.checked ? '✓' : '' }}</span>
                    <span class="titlebar-item-label">{{ sub.label }}</span>
                    <span class="titlebar-item-accel">{{ sub.accelerator }}</span>
                  </div>
                </template>
              </div>
            </div>
          </template>
        </div>
      </div>
    </nav>

    <div
      class="titlebar-title"
      :title="title"
    >
      {{ title }}
    </div>

    <div class="titlebar-controls">
      <button
        class="titlebar-control"
        type="button"
        title="Minimize"
        aria-label="Minimize"
        @click="send('window:minimize')"
      >
        <svg
          viewBox="0 0 10 10"
          aria-hidden="true"
        ><path d="M0 5.5h10" /></svg>
      </button>
      <button
        class="titlebar-control"
        type="button"
        :title="maximized ? 'Restore' : 'Maximize'"
        :aria-label="maximized ? 'Restore' : 'Maximize'"
        @click="send('window:toggle-maximize')"
      >
        <svg
          v-if="maximized"
          viewBox="0 0 10 10"
          aria-hidden="true"
        ><path d="M2.5 2.5V.5h7v7h-2M.5 2.5h7v7h-7z" /></svg>
        <svg
          v-else
          viewBox="0 0 10 10"
          aria-hidden="true"
        ><path d="M.5.5h9v9h-9z" /></svg>
      </button>
      <button
        class="titlebar-control titlebar-close"
        type="button"
        title="Close"
        aria-label="Close"
        @click="send('window:close')"
      >
        <svg
          viewBox="0 0 10 10"
          aria-hidden="true"
        ><path d="M.5.5l9 9M9.5.5l-9 9" /></svg>
      </button>
    </div>
  </header>
</template>

<script>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { formatAccelerator } from '../../common/menuModel'

let ipcRenderer = null
try {
  ipcRenderer = require('electron').ipcRenderer
} catch (e) {
  // Outside Electron (unit tests)
}

const isItem = item => item.type !== 'separator'

/**
 * Window title bar for the frameless window on Windows and Linux: the
 * application menu, the window title and the window buttons, in the app theme.
 */
export default {
  name: 'TitleBar',

  setup() {
    const menuBar = ref(null)
    const menuData = ref([])
    const title = ref('PDF Annotator')
    const maximized = ref(false)
    const focused = ref(document.hasFocus())
    const platform = ref(process.platform)

    // Open menu (index into menuData), highlighted row, open submenu
    const openIndex = ref(-1)
    const activeRow = ref(-1)
    const submenuOpen = ref(false)
    const activeSubRow = ref(-1)

    // Visible entries with their original index (the IPC address) and
    // display-ready accelerators
    const prepare = (items) => items
      .map((item, index) => ({ ...item, index }))
      .filter(item => item.visible)
      .map(item => ({
        ...item,
        accelerator: formatAccelerator(item.accelerator, platform.value),
        submenu: item.submenu ? prepare(item.submenu) : null
      }))

    const topMenus = computed(() => prepare(menuData.value).map(menu => ({
      index: menu.index,
      label: menu.label,
      items: menu.submenu || []
    })))

    const openMenu = computed(() => topMenus.value.find(m => m.index === openIndex.value) || null)

    const send = (channel, ...args) => ipcRenderer?.send(channel, ...args)

    const loadMenu = async () => {
      if (!ipcRenderer) return
      menuData.value = await ipcRenderer.invoke('menu:get')
    }

    const closeMenus = () => {
      openIndex.value = -1
      activeRow.value = -1
      submenuOpen.value = false
      activeSubRow.value = -1
    }

    const showMenu = (index, row = -1) => {
      openIndex.value = index
      activeRow.value = row
      submenuOpen.value = false
      activeSubRow.value = -1
    }

    const toggleMenu = (index) => {
      if (openIndex.value === index) closeMenus()
      else showMenu(index)
    }

    // Like native menu bars: once a menu is open, hovering switches menus
    const hoverMenu = (index) => {
      if (openIndex.value !== -1 && openIndex.value !== index) showMenu(index)
    }

    const hoverRow = (row) => {
      activeRow.value = row
      const item = openMenu.value?.items[row]
      submenuOpen.value = Boolean(item?.submenu)
      activeSubRow.value = -1
    }

    const activate = (menu, row) => {
      const item = menu.items[row]
      if (!item || !item.enabled) return
      if (item.submenu) {
        activeRow.value = row
        submenuOpen.value = true
        return
      }
      closeMenus()
      send('menu:click', [menu.index, item.index])
    }

    const activateSub = (menu, row, subRow) => {
      const item = menu.items[row]
      const sub = item?.submenu?.[subRow]
      if (!sub || !sub.enabled) return
      closeMenus()
      send('menu:click', [menu.index, item.index, sub.index])
    }

    // Next selectable row from `start` in direction `step` (wraps around)
    const nextRow = (items, start, step) => {
      const count = items.length
      for (let i = 1; i <= count; i++) {
        const row = (start + step * i + count * 2) % count
        if (isItem(items[row]) && items[row].enabled) return row
      }
      return -1
    }

    const switchMenu = (step) => {
      const menus = topMenus.value
      const position = menus.findIndex(m => m.index === openIndex.value)
      const next = menus[(position + step + menus.length) % menus.length]
      showMenu(next.index, nextRow(next.items, -1, 1))
    }

    const handleMenuKeys = (event) => {
      const menu = openMenu.value
      if (!menu) return false
      const item = menu.items[activeRow.value]
      const inSubmenu = submenuOpen.value && activeSubRow.value !== -1 && item?.submenu
      switch (event.key) {
        case 'Escape':
          if (inSubmenu) {
            submenuOpen.value = false
            activeSubRow.value = -1
          } else {
            closeMenus()
          }
          return true
        case 'ArrowDown':
        case 'ArrowUp': {
          const step = event.key === 'ArrowDown' ? 1 : -1
          if (inSubmenu) activeSubRow.value = nextRow(item.submenu, activeSubRow.value, step)
          else {
            activeRow.value = nextRow(menu.items, activeRow.value === -1 && step < 0 ? 0 : activeRow.value, step)
            submenuOpen.value = false
          }
          return true
        }
        case 'ArrowRight':
          if (!inSubmenu && item?.submenu && item.submenu.some(s => isItem(s) && s.enabled)) {
            submenuOpen.value = true
            activeSubRow.value = nextRow(item.submenu, -1, 1)
          } else {
            switchMenu(1)
          }
          return true
        case 'ArrowLeft':
          if (inSubmenu) {
            submenuOpen.value = false
            activeSubRow.value = -1
          } else {
            switchMenu(-1)
          }
          return true
        case 'Enter':
        case ' ':
          if (inSubmenu) activateSub(menu, activeRow.value, activeSubRow.value)
          else if (item) {
            if (item.submenu) {
              submenuOpen.value = true
              activeSubRow.value = nextRow(item.submenu, -1, 1)
            } else {
              activate(menu, activeRow.value)
            }
          }
          return true
        default:
          return false
      }
    }

    // Alt pressed and released on its own (or F10) opens the menu bar, as in
    // native Windows/Linux apps
    let altAlone = false

    const onKeydown = (event) => {
      if (openIndex.value !== -1) {
        if (handleMenuKeys(event)) {
          event.preventDefault()
          event.stopPropagation()
          return
        }
        if (event.key !== 'Alt') closeMenus()
      }
      if (event.key === 'F10' && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) {
        event.preventDefault()
        if (topMenus.value.length) showMenu(topMenus.value[0].index, nextRow(topMenus.value[0].items, -1, 1))
        return
      }
      altAlone = event.key === 'Alt' && !event.ctrlKey && !event.shiftKey && !event.metaKey
    }

    const onKeyup = (event) => {
      if (event.key === 'Alt' && altAlone) {
        event.preventDefault()
        if (openIndex.value !== -1) closeMenus()
        else if (topMenus.value.length) showMenu(topMenus.value[0].index, nextRow(topMenus.value[0].items, -1, 1))
      }
      altAlone = false
    }

    const onPointerDown = (event) => {
      if (openIndex.value !== -1 && !menuBar.value?.contains(event.target)) closeMenus()
    }

    const onFocus = () => { focused.value = true }
    const onBlur = () => {
      focused.value = false
      closeMenus()
    }

    const onTitle = (event, value) => { title.value = value }
    const onState = (event, state) => { maximized.value = Boolean(state.maximized) }

    onMounted(async () => {
      window.addEventListener('keydown', onKeydown, true)
      window.addEventListener('keyup', onKeyup, true)
      window.addEventListener('focus', onFocus)
      window.addEventListener('blur', onBlur)
      document.addEventListener('mousedown', onPointerDown, true)
      if (!ipcRenderer) return
      ipcRenderer.on('window:title', onTitle)
      ipcRenderer.on('window:state', onState)
      ipcRenderer.on('menu:changed', loadMenu)
      const state = await ipcRenderer.invoke('window:get-state')
      title.value = state.title
      maximized.value = state.maximized
      platform.value = state.platform
      await loadMenu()
    })

    onUnmounted(() => {
      window.removeEventListener('keydown', onKeydown, true)
      window.removeEventListener('keyup', onKeyup, true)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('mousedown', onPointerDown, true)
      if (!ipcRenderer) return
      ipcRenderer.removeListener('window:title', onTitle)
      ipcRenderer.removeListener('window:state', onState)
      ipcRenderer.removeListener('menu:changed', loadMenu)
    })

    return {
      menuBar,
      topMenus,
      title,
      maximized,
      focused,
      openIndex,
      activeRow,
      submenuOpen,
      activeSubRow,
      send,
      toggleMenu,
      hoverMenu,
      hoverRow,
      activate,
      activateSub
    }
  }
}
</script>

<style scoped>
.titlebar {
  position: relative;
  z-index: 3000;
  flex: 0 0 var(--titlebar-height);
  display: flex;
  align-items: stretch;
  height: var(--titlebar-height);
  background: var(--titlebar-bg);
  border-bottom: 1px solid var(--border-color);
  color: var(--text-color);
  font-size: 13px;
  user-select: none;
  /* The empty parts of the bar move the window */
  -webkit-app-region: drag;
}

.titlebar-menu {
  display: flex;
  align-items: stretch;
  padding-left: 4px;
  -webkit-app-region: no-drag;
}

.titlebar-menu-entry {
  position: relative;
  display: flex;
}

.titlebar-menu-button {
  padding: 0 10px;
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: default;
}

.titlebar-menu-button:hover,
.titlebar-menu-button.open {
  background: var(--menu-hover);
}

.titlebar.blurred .titlebar-menu-button,
.titlebar.blurred .titlebar-title {
  opacity: 0.6;
}

.titlebar-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  min-width: 240px;
  padding: 4px 0;
  background: var(--annotation-bg);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  box-shadow: var(--shadow-lg);
  -webkit-app-region: no-drag;
}

.titlebar-submenu {
  top: -5px;
  left: 100%;
  margin-left: 2px;
}

.titlebar-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 12px 5px 4px;
  white-space: nowrap;
  cursor: default;
}

.titlebar-item.active:not(.disabled) {
  background: var(--menu-hover);
}

.titlebar-item.disabled {
  color: var(--text-muted);
  opacity: 0.7;
}

.titlebar-item-check {
  width: 16px;
  text-align: center;
  color: var(--primary-color);
}

.titlebar-item-label {
  flex: 1;
}

.titlebar-item-accel {
  margin-left: 24px;
  color: var(--text-muted);
  font-size: 12px;
}

.titlebar-item-arrow {
  color: var(--text-muted);
}

.titlebar-separator {
  height: 1px;
  margin: 4px 8px;
  background: var(--border-color);
}

.titlebar-title {
  flex: 1;
  min-width: 0;
  align-self: center;
  padding: 0 16px;
  overflow: hidden;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-muted);
}

.titlebar-controls {
  display: flex;
  -webkit-app-region: no-drag;
}

.titlebar-control {
  width: 46px;
  border: none;
  background: transparent;
  color: var(--text-color);
  cursor: default;
}

.titlebar-control svg {
  width: 10px;
  height: 10px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1;
  shape-rendering: crispEdges;
}

.titlebar-control:hover {
  background: var(--menu-hover);
}

.titlebar-close:hover {
  background: #e81123;
  color: #ffffff;
}

.titlebar-menu-button:focus-visible,
.titlebar-control:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: -2px;
}
</style>
