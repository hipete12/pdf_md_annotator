import { expect } from 'chai'
import { formatAccelerator, menuItemAt, serializeMenu, usesCustomTitleBar } from '../../src/common/menuModel'

const clicked = []
const fakeMenu = [
  {
    label: 'File',
    submenu: {
      items: [
        { label: 'Open...', accelerator: 'CmdOrCtrl+O', click: () => clicked.push('open') },
        { type: 'separator' },
        { label: 'Recent Files', submenu: { items: [] } },
        { label: 'Hidden', visible: false }
      ]
    }
  },
  {
    label: 'Edit',
    submenu: {
      items: [
        { role: 'copy', label: 'Copy', getDefaultRoleAccelerator: () => 'CommandOrControl+C' },
        { label: 'Wrap', type: 'checkbox', checked: true, enabled: false }
      ]
    }
  }
]

describe('Title bar menu model', () => {
  it('draws its own title bar on Windows and Linux only', () => {
    expect(usesCustomTitleBar('linux')).to.equal(true)
    expect(usesCustomTitleBar('win32')).to.equal(true)
    expect(usesCustomTitleBar('darwin')).to.equal(false)
  })

  it('serializes labels, separators, submenus and states', () => {
    const [file, edit] = serializeMenu(fakeMenu)
    expect(file.label).to.equal('File')
    expect(file.submenu.map(i => i.type)).to.deep.equal(['normal', 'separator', 'normal', 'normal'])
    expect(file.submenu[0].accelerator).to.equal('CmdOrCtrl+O')
    expect(file.submenu[2].submenu).to.deep.equal([])
    expect(file.submenu[3].visible).to.equal(false)
    expect(edit.submenu[1]).to.include({ type: 'checkbox', checked: true, enabled: false })
  })

  it('falls back to the default accelerator of role items', () => {
    const [, edit] = serializeMenu(fakeMenu)
    expect(edit.submenu[0].accelerator).to.equal('CommandOrControl+C')
  })

  it('produces data that survives IPC (structured clone)', () => {
    const data = serializeMenu(fakeMenu)
    expect(() => structuredClone(data)).to.not.throw()
  })

  it('finds items by index path and rejects bad paths', () => {
    expect(menuItemAt(fakeMenu, [0, 0]).label).to.equal('Open...')
    expect(menuItemAt(fakeMenu, [1, 1]).label).to.equal('Wrap')
    expect(menuItemAt(fakeMenu, [0, 9])).to.equal(null)
    expect(menuItemAt(fakeMenu, [0, 2, 0])).to.equal(null)
    expect(menuItemAt(fakeMenu, ['0', 0])).to.equal(null)
    expect(menuItemAt(fakeMenu, [])).to.equal(null)
  })

  it('formats accelerators for display', () => {
    expect(formatAccelerator('CmdOrCtrl+Shift+S', 'linux')).to.equal('Ctrl+Shift+S')
    expect(formatAccelerator('CommandOrControl+C', 'win32')).to.equal('Ctrl+C')
    expect(formatAccelerator('CmdOrCtrl+Plus', 'linux')).to.equal('Ctrl++')
    expect(formatAccelerator('CmdOrCtrl++', 'linux')).to.equal('Ctrl++')
    expect(formatAccelerator('CmdOrCtrl+\\', 'linux')).to.equal('Ctrl+\\')
    expect(formatAccelerator('Alt+F4', 'linux')).to.equal('Alt+F4')
    expect(formatAccelerator('Shift+CommandOrControl+Z', 'linux')).to.equal('Ctrl+Shift+Z')
    expect(formatAccelerator('Shift+Alt+CmdOrCtrl+I', 'win32')).to.equal('Ctrl+Alt+Shift+I')
    expect(formatAccelerator('cmdorctrl+o', 'linux')).to.equal('Ctrl+O')
    expect(formatAccelerator('CmdOrCtrl+O', 'darwin')).to.equal('⌘+O')
    expect(formatAccelerator('', 'linux')).to.equal('')
  })
})
