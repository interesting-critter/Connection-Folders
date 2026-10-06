/**
 * DOM-layer tests.
 *
 * happy-dom globals are installed per-file (mirroring the Lumiverse frontend
 * harness pattern) so these tests never touch a real browser and can assert on
 * happy-dom's `getComputedStyle`, which resolves inline styles — the same
 * capability probe `isFlexColumn` relies on.
 */
import { describe, it, expect, beforeEach } from 'bun:test'
import { Window as HappyDomWindow } from 'happy-dom'

import {
  isFlexColumn,
  locateHost,
  locateList,
  locateRows,
  locateTabRoot,
  describeUnsupported,
} from '../src/dom/locate'
import { assignOrder, resetOrder } from '../src/dom/order'
import { createFolderHeader, updateFolderHeader, FOLDER_ATTR, CF_LIST_ANCHOR_CLASS } from '../src/dom/headers'
import { FolderController } from '../src/dom/controller'

const NewWindow = HappyDomWindow as unknown as new () => unknown

const DOM_GLOBALS = [
  'document',
  'HTMLElement',
  'HTMLButtonElement',
  'HTMLInputElement',
  'Element',
  'Node',
  'Event',
  'MouseEvent',
  'CustomEvent',
  'getComputedStyle',
  'MutationObserver',
] as const

let win: Record<string, unknown>

beforeEach(() => {
  win = new NewWindow() as Record<string, unknown>
  const target = globalThis as unknown as Record<string, unknown>
  for (const key of DOM_GLOBALS) target[key] = win[key]
})

function doc(): Document {
  return document
}

function el(tag: string, className?: string): HTMLElement {
  const node = doc().createElement(tag)
  if (className) node.className = className
  return node
}

function row(): HTMLElement {
  const node = el('div', 'item_ab12cd')
  node.setAttribute('data-component', 'ConnectionItem')
  node.style.transform = 'translate3d(0px, 0px, 0)'
  node.style.transition = 'transform 200ms'
  return node
}

/**
 * Mirrors ConnectionManager.tsx: a non-flex wrapper around the hashed
 * `.list` flex column, plus a second manager below it (embeddings) so tests
 * prove we do not pick the wrong list.
 */
function buildHost(): { tab: HTMLElement; list: HTMLElement; rows: HTMLElement[] } {
  const tab = el('div')
  tab.setAttribute('data-spindle-drawer-tab', 'connections')

  const stack = el('div', 'connections-stack')

  const outer = el('div', 'wrapper_nonsense')
  const list = el('div', 'list_9f8e7d')
  list.style.display = 'flex'
  list.style.flexDirection = 'column'

  const rows = [row(), row(), row()]
  for (const r of rows) list.appendChild(r)

  // The editing wrapper: a SECOND [data-component="ConnectionItem"] nested
  // inside the first row (ConnectionItem.tsx line 294).
  const nested = el('div')
  nested.setAttribute('data-component', 'ConnectionItem')
  rows[0].appendChild(nested)

  outer.appendChild(list)
  stack.appendChild(outer)

  // A sibling manager below, also a flex column, with rows of its own kind.
  const otherList = el('div', 'list_other99')
  otherList.style.display = 'flex'
  otherList.style.flexDirection = 'column'
  const otherRow = el('div', 'embeddingItem_1a2b3c')
  otherList.appendChild(otherRow)
  stack.appendChild(otherList)

  tab.appendChild(stack)
  doc().body.appendChild(tab)
  return { tab, list, rows }
}

describe('locateRows', () => {
  it('returns only DIRECT children, excluding the nested editing wrapper', () => {
    const { list, rows } = buildHost()
    const found = locateRows(list)
    expect(found.length).toBe(3)
    expect(found).toEqual(rows)
    expect(found[0].querySelectorAll('[data-component="ConnectionItem"]').length).toBe(1)
  })

  it('returns an empty array for a list with no rows', () => {
    const list = el('div')
    list.style.display = 'flex'
    list.style.flexDirection = 'column'
    doc().body.appendChild(list)
    expect(locateRows(list)).toEqual([])
  })

  it('preserves DOM order', () => {
    const list = el('div')
    list.style.display = 'flex'
    list.style.flexDirection = 'column'
    const a = row()
    const b = row()
    list.append(b)
    list.append(a)
    doc().body.appendChild(list)
    expect(locateRows(list)).toEqual([b, a])
  })
})

describe('locateList', () => {
  it('finds the list structurally without any hashed class name', () => {
    const { list } = buildHost()
    const found = locateList(doc().body)
    expect(found).toBe(list)
    expect(found?.className).toBe('list_9f8e7d')
  })

  it('does not pick the embeddings manager below it', () => {
    const { list } = buildHost()
    const found = locateList()
    expect(found?.querySelector('.embeddingItem_1a2b3c')).toBeNull()
    expect(locateRows(found as HTMLElement).length).toBe(3)
  })

  it('returns null when there are no connection rows and no connection tab', () => {
    doc().body.appendChild(el('div'))
    expect(locateList(doc().body)).toBeNull()
  })

  it('finds the list structurally when there are zero connection rows (fresh install)', () => {
    const tab = el('div')
    tab.setAttribute('data-spindle-drawer-tab', 'connections')

    const stack = el('div', 'connections-stack')
    const manager = el('div', 'manager_123')
    manager.style.display = 'flex'
    manager.style.flexDirection = 'column'

    const createActions = el('div', 'createActions_123')
    const createBtn = el('button')
    createActions.appendChild(createBtn)
    manager.appendChild(createActions)

    const list = el('div', 'list_empty_123')
    list.style.display = 'flex'
    list.style.flexDirection = 'column'
    const emptyNotice = el('div', 'empty_123')
    emptyNotice.textContent = 'No connections yet'
    list.appendChild(emptyNotice)
    manager.appendChild(list)

    stack.appendChild(manager)
    tab.appendChild(stack)
    doc().body.appendChild(tab)

    const found = locateList(tab)
    expect(found).toBe(list)
    expect(locateRows(list).length).toBe(0)
    expect(describeUnsupported(tab)).toBeNull()
  })

  it('returns null when the candidate is not a flex column', () => {
    const tab = el('div')
    tab.setAttribute('data-spindle-drawer-tab', 'connections')
    const list = el('div', 'list_block')
    list.appendChild(row())
    tab.appendChild(list)
    doc().body.appendChild(tab)
    expect(locateList(tab)).toBeNull()
  })
})

describe('locateTabRoot', () => {
  it('finds the tab root via the host attribute', () => {
    const { tab } = buildHost()
    expect(locateTabRoot(doc().body)).toBe(tab)
  })

  it('falls back to a structural search when the attribute is absent', () => {
    const { tab } = buildHost()
    tab.removeAttribute('data-spindle-drawer-tab')
    const found = locateTabRoot(doc().body)
    expect(found).not.toBeNull()
    expect(found?.contains(tab)).toBe(true)
  })

  it('returns null when the tab is absent', () => {
    expect(locateTabRoot(doc().body)).toBeNull()
  })
})

describe('isFlexColumn', () => {
  it('is true for a flex column', () => {
    const list = el('div')
    list.style.display = 'flex'
    list.style.flexDirection = 'column'
    doc().body.appendChild(list)
    expect(isFlexColumn(list)).toBe(true)
  })

  it('is false for a flex ROW', () => {
    const node = el('div')
    node.style.display = 'flex'
    node.style.flexDirection = 'row'
    doc().body.appendChild(node)
    expect(isFlexColumn(node)).toBe(false)
  })

  it('is false for a grid container', () => {
    const node = el('div')
    node.style.display = 'grid'
    doc().body.appendChild(node)
    expect(isFlexColumn(node)).toBe(false)
  })

  it('is false for a block container', () => {
    const node = el('div')
    node.style.display = 'block'
    doc().body.appendChild(node)
    expect(isFlexColumn(node)).toBe(false)
  })
})

describe('locateHost / describeUnsupported', () => {
  it('returns all three references for a supported host', () => {
    const { tab, list, rows } = buildHost()
    const host = locateHost()
    expect(host?.tabRoot).toBe(tab)
    expect(host?.list).toBe(list)
    expect(host?.rows).toEqual(rows)
  })

  it('returns null and explains why when the layout is unsupported', () => {
    const tab = el('div')
    tab.setAttribute('data-spindle-drawer-tab', 'connections')
    const list = el('div')
    list.style.display = 'grid'
    list.appendChild(row())
    tab.appendChild(list)
    doc().body.appendChild(tab)

    expect(locateHost()).toBeNull()
    expect(describeUnsupported()).toContain('flex column')
  })

  it('reports a missing tab', () => {
    expect(describeUnsupported()).toContain('not mounted')
  })
})

describe('assignOrder', () => {
  it('interleaves headers and rows with sequential order values', () => {
    const { rows } = buildHost()
    const h1 = el('div')
    const h2 = el('div')

    assignOrder([
      { el: h1, collapsed: false },
      { el: rows[0], collapsed: false },
      { el: rows[1], collapsed: false },
      { el: h2, collapsed: false },
      { el: rows[2], collapsed: false },
    ])

    expect(h1.style.order).toBe('0')
    expect(rows[0].style.order).toBe('1')
    expect(rows[1].style.order).toBe('2')
    expect(h2.style.order).toBe('3')
    expect(rows[2].style.order).toBe('4')
  })

  it('hides collapsed rows and clears display when expanded again', () => {
    const { rows } = buildHost()
    assignOrder([
      { el: rows[0], collapsed: true },
      { el: rows[1], collapsed: false },
    ])
    expect(rows[0].style.display).toBe('none')
    expect(rows[1].style.display).toBe('')

    assignOrder([
      { el: rows[0], collapsed: false },
      { el: rows[1], collapsed: false },
    ])
    expect(rows[0].style.display).toBe('')
    expect(rows[1].style.display).toBe('')
  })

  it('never clobbers the row transform/transition that dnd-kit owns', () => {
    const { rows } = buildHost()
    assignOrder([{ el: rows[0], collapsed: true }])
    expect(rows[0].style.transform).toBe('translate3d(0px, 0px, 0)')
    expect(rows[0].style.transition).toBe('transform 200ms')
  })

  it('restores a pre-existing inline display on a collapsed row', () => {
    const { rows } = buildHost()
    rows[0].style.display = 'contents'
    assignOrder([{ el: rows[0], collapsed: true }])
    expect(rows[0].style.display).toBe('none')
    assignOrder([{ el: rows[0], collapsed: false }])
    expect(rows[0].style.display).toBe('contents')
  })

  it('resets elements it no longer manages', () => {
    const { rows } = buildHost()
    assignOrder([
      { el: rows[0], collapsed: true },
      { el: rows[1], collapsed: false },
    ])
    assignOrder([{ el: rows[1], collapsed: false }])
    expect(rows[0].style.order).toBe('')
    expect(rows[0].style.display).toBe('')
    expect(rows[1].style.order).toBe('0')
  })

  it('does not re-write style.order or style.display when values already match', () => {
    let orderWrites = 0
    let _order = '0'
    let displayWrites = 0
    let _display = ''

    const fakeEl = {
      style: {
        get order() {
          return _order
        },
        set order(val: string) {
          orderWrites += 1
          _order = val
        },
        get display() {
          return _display
        },
        set display(val: string) {
          displayWrites += 1
          _display = val
        },
      },
    } as unknown as HTMLElement

    assignOrder([{ el: fakeEl, collapsed: false }])
    expect(orderWrites).toBe(0)
    expect(displayWrites).toBe(0)

    assignOrder([{ el: fakeEl, collapsed: false }])
    expect(orderWrites).toBe(0)
    expect(displayWrites).toBe(0)
  })
})

describe('FolderController', () => {
  it('stamps host.list with cf-list-anchor, not cf-root, and cleans up on dispose', () => {
    const { list } = buildHost()
    const controller = new FolderController({
      profiles: [],
      folderNames: [],
      onRenameFolder: () => {},
      onDeleteFolder: () => {},
      render: () => [],
    })
    expect(controller.mount()).toBe(true)
    expect(list.classList.contains(CF_LIST_ANCHOR_CLASS)).toBe(true)
    expect(list.classList.contains('cf-root')).toBe(false)
    controller.dispose()
    expect(list.classList.contains(CF_LIST_ANCHOR_CLASS)).toBe(false)
  })
})

describe('resetOrder', () => {
  it('fully clears prior overrides', () => {
    const { rows } = buildHost()
    assignOrder([
      { el: rows[0], collapsed: true },
      { el: rows[1], collapsed: false },
      { el: rows[2], collapsed: false },
    ])
    resetOrder(rows)
    for (const r of rows) {
      expect(r.style.order).toBe('')
      expect(r.style.display).toBe('')
    }
  })

  it('is idempotent and safe on untouched rows', () => {
    const { rows } = buildHost()
    resetOrder(rows)
    resetOrder(rows)
    expect(rows[0].style.order).toBe('')
  })
})

describe('createFolderHeader', () => {
  const options = () => ({
    folder: 'Alpha',
    label: 'Alpha',
    count: 2,
    collapsed: false,
    onToggle: () => {},
  })

  it('emits the expected cf- classes', () => {
    const header = createFolderHeader(options())
    expect(header.className).toContain('cf-folder-header-row')
    expect(header.getAttribute(FOLDER_ATTR)).toBe('Alpha')

    const toggle = header.querySelector('.cf-folder-header')
    expect(toggle).not.toBeNull()
    expect(header.querySelector('.cf-folder-name')?.textContent).toBe('Alpha')
    expect(header.querySelector('.cf-folder-count')?.textContent).toBe('2')
    expect(header.querySelector('.cf-folder-chevron')).not.toBeNull()
    expect(header.querySelector('.cf-folder-chevron-open')).not.toBeNull()
  })

  it('omits the open chevron class when collapsed', () => {
    const header = createFolderHeader({ ...options(), collapsed: true })
    expect(header.querySelector('.cf-folder-chevron-open')).toBeNull()
  })

  it('uses a real button[type=button] with aria-expanded', () => {
    const header = createFolderHeader(options())
    const toggle = header.querySelector('button') as HTMLButtonElement
    expect(toggle.type).toBe('button')
    expect(toggle.getAttribute('aria-expanded')).toBe('true')

    const collapsed = createFolderHeader({ ...options(), collapsed: true })
    const collapsedToggle = collapsed.querySelector('button') as HTMLButtonElement
    expect(collapsedToggle.getAttribute('aria-expanded')).toBe('false')
  })

  it('toggles on click', () => {
    let toggled = 0
    const header = createFolderHeader({ ...options(), onToggle: () => { toggled += 1 } })
    const toggle = header.querySelector('button') as HTMLButtonElement
    toggle.dispatchEvent(new (win['MouseEvent'] as typeof MouseEvent)('click', { bubbles: true }))
    expect(toggled).toBe(1)
  })

  it('places action buttons OUTSIDE the toggle button and stops propagation', () => {
    let toggled = 0
    let renamed = 0
    let deleted = 0
    const header = createFolderHeader({
      ...options(),
      onToggle: () => { toggled += 1 },
      onRename: () => { renamed += 1 },
      onDelete: () => { deleted += 1 },
    })

    const actions = Array.from(header.querySelectorAll('.cf-folder-action')) as HTMLButtonElement[]
    expect(actions.length).toBe(2)
    const toggle = header.querySelector('.cf-folder-header') as HTMLButtonElement
    for (const action of actions) {
      expect(toggle.contains(action)).toBe(false)
      expect(action.type).toBe('button')
    }
    expect(header.querySelector('.cf-folder-delete')).not.toBeNull()

    const MouseEvt = win['MouseEvent'] as typeof MouseEvent
    actions[0].dispatchEvent(new MouseEvt('click', { bubbles: true }))
    actions[1].dispatchEvent(new MouseEvt('click', { bubbles: true }))
    expect(renamed).toBe(1)
    expect(deleted).toBe(1)
    expect(toggled).toBe(0)
  })

  it('omits action buttons when no callbacks are supplied', () => {
    const header = createFolderHeader(options())
    expect(header.querySelectorAll('.cf-folder-action').length).toBe(0)
  })

  it('applies the drop-target class when asked', () => {
    const header = createFolderHeader({ ...options(), dropTarget: true })
    expect(header.className).toContain('cf-folder-drop-target')
  })

  it('escapes the folder label because it uses textContent', () => {
    const header = createFolderHeader({ ...options(), label: '<img src=x onerror=alert(1)>' })
    expect(header.querySelector('.cf-folder-name')?.textContent).toBe('<img src=x onerror=alert(1)>')
    expect(header.querySelector('img')).toBeNull()
  })
})

describe('updateFolderHeader', () => {
  it('toggles the chevron class and updates the count and label', () => {
    const header = createFolderHeader({
      folder: 'Alpha',
      label: 'Alpha',
      count: 1,
      collapsed: false,
      onToggle: () => {},
    })

    updateFolderHeader(header, { collapsed: true, count: 5, label: 'Alpha (5)' })
    expect(header.querySelector('.cf-folder-chevron-open')).toBeNull()
    expect(header.querySelector('.cf-folder-count')?.textContent).toBe('5')
    expect(header.querySelector('.cf-folder-name')?.textContent).toBe('Alpha (5)')
    expect(header.querySelector('.cf-folder-header')?.getAttribute('aria-expanded')).toBe('false')

    updateFolderHeader(header, { collapsed: false, count: 6, label: 'Alpha (6)' })
    expect(header.querySelector('.cf-folder-chevron-open')).not.toBeNull()
    expect(header.querySelector('.cf-folder-header')?.getAttribute('aria-expanded')).toBe('true')
  })

  it('reuses the same node so focus is not lost', () => {
    const header = createFolderHeader({
      folder: 'Beta',
      label: 'Beta',
      count: 1,
      collapsed: false,
      onToggle: () => {},
    })
    const toggle = header.querySelector('.cf-folder-header') as HTMLButtonElement
    const before = header
    updateFolderHeader(header, { collapsed: true, count: 0, label: 'Beta' })
    expect(header).toBe(before)
    expect(header.querySelector('.cf-folder-header')).toBe(toggle)
  })
})
