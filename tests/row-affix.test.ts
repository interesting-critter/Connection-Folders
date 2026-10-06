/**
 * Row-affix tests: the per-row "assign folder" button injection.
 *
 * happy-dom globals are installed per-file (same harness pattern as
 * `tests/dom.test.ts`) so nothing here touches a real browser. The fixture
 * mirrors ConnectionItem.tsx lines 292-380 closely enough to prove the two
 * structural claims that matter: the select button is a SIBLING of the action
 * container (so our button cannot land inside it), and an editing row nests a
 * second `[data-component="ConnectionItem"]` inside the root.
 */
import { describe, it, expect, beforeEach } from 'bun:test'
import { Window as HappyDomWindow } from 'happy-dom'

import { ASSIGN_ATTR, RowAffixManager, findAssignButton } from '../src/ui/row-affix'
import type { ConnectionProfile } from '../src/types'

const NewWindow = HappyDomWindow as unknown as new () => unknown

const DOM_GLOBALS = [
  'document',
  'HTMLElement',
  'HTMLButtonElement',
  'Element',
  'Node',
  'Event',
  'MouseEvent',
  'CustomEvent',
  'getComputedStyle',
] as const

let win: Record<string, unknown>

beforeEach(() => {
  win = new NewWindow() as Record<string, unknown>
  const target = globalThis as unknown as Record<string, unknown>
  for (const key of DOM_GLOBALS) target[key] = win[key]
})

function el(tag: string, className?: string): HTMLElement {
  const node = document.createElement(tag)
  if (className) node.className = className
  return node
}

function profile(id: string, name: string): ConnectionProfile {
  return { id, name, provider: 'openai', model: 'gpt-4o-mini' }
}

interface FakeRow {
  root: HTMLElement
  select: HTMLButtonElement
  actions: HTMLElement
}

/**
 * One row root carrying `.itemRow` → [drag handle, `.itemBtn` select,
 * `.itemActions`], exactly like the non-editing branch of ConnectionItem.tsx.
 */
function makeRow(): FakeRow {
  const root = el('div', 'item_9a8b7c')
  root.setAttribute('data-component', 'ConnectionItem')

  const itemRow = el('div', 'itemRow_4d5e6f')

  const drag = document.createElement('button')
  drag.type = 'button'
  drag.className = 'dragHandle_1a2b3c'
  itemRow.appendChild(drag)

  const select = document.createElement('button')
  select.type = 'button'
  select.className = 'itemBtn_7c8d9e'
  select.textContent = 'profile'
  itemRow.appendChild(select)

  const actions = el('div', 'itemActions_0f1e2d')
  itemRow.appendChild(actions)

  root.appendChild(itemRow)
  return { root, select, actions }
}

function buildList(count: number): { list: HTMLElement; rows: FakeRow[] } {
  const list = el('div', 'list_9f8e7d')
  list.style.display = 'flex'
  list.style.flexDirection = 'column'

  const rows: FakeRow[] = []
  for (let i = 0; i < count; i += 1) {
    const row = makeRow()
    rows.push(row)
    list.appendChild(row.root)
  }
  document.body.appendChild(list)
  return { list, rows }
}

interface Harness {
  manager: RowAffixManager
  assigned: string[]
}

/**
 * Build a manager over `rows` whose profiles are supplied by `pool`. Removing a
 * profile from the pool simulates a deletion / shrink of the host list.
 */
function harness(
  list: HTMLElement,
  rowRoots: HTMLElement[],
  pool: ConnectionProfile[],
  folderOf: (profile: ConnectionProfile) => string = () => '',
): Harness {
  const assigned: string[] = []
  const manager = new RowAffixManager({
    list,
    rows: () => rowRoots,
    profileForIndex: (index) => pool[index],
    currentFolder: folderOf,
    onAssign: (p) => assigned.push(p.id),
    labelFor: (p, folder) => `Move "${p.name}" to a folder${folder ? ` (now: ${folder})` : ''}`,
  })
  return { manager, assigned }
}

describe('RowAffixManager sync', () => {
  it('injects a button into each row when a profile resolves', () => {
    const { list, rows } = buildList(3)
    const pool = [profile('p1', 'One'), profile('p2', 'Two'), profile('p3', 'Three')]
    const { manager } = harness(list, rows.map((r) => r.root), pool)

    manager.sync()

    for (const row of rows) {
      expect(findAssignButton(row.root)).not.toBeNull()
      expect(row.actions.querySelectorAll(`[${ASSIGN_ATTR}]`).length).toBe(1)
    }

    manager.dispose()
  })

  it('is idempotent: a second sync does not add a second button', () => {
    const { list, rows } = buildList(2)
    const pool = [profile('p1', 'One'), profile('p2', 'Two')]
    const { manager } = harness(list, rows.map((r) => r.root), pool)

    manager.sync()
    const first = rows.map((r) => findAssignButton(r.root))
    manager.sync()
    manager.sync()
    const after = rows.map((r) => findAssignButton(r.root))

    for (let i = 0; i < rows.length; i += 1) {
      expect(after[i]).toBe(first[i])
      expect(rows[i].root.querySelectorAll(`[${ASSIGN_ATTR}]`).length).toBe(1)
    }

    manager.dispose()
  })

  it('stamps data-cf-assign with the profile id', () => {
    const { list, rows } = buildList(2)
    const pool = [profile('alpha', 'One'), profile('beta', 'Two')]
    const { manager } = harness(list, rows.map((r) => r.root), pool)

    manager.sync()

    expect(findAssignButton(rows[0].root)!.getAttribute(ASSIGN_ATTR)).toBe('alpha')
    expect(findAssignButton(rows[1].root)!.getAttribute(ASSIGN_ATTR)).toBe('beta')

    manager.dispose()
  })

  it('refreshes aria-label when the folder changes', () => {
    const { list, rows } = buildList(1)
    const pool = [profile('p1', 'My Profile')]
    let folder = ''
    const { manager } = harness(list, rows.map((r) => r.root), pool, () => folder)

    manager.sync()
    const button = findAssignButton(rows[0].root)!
    expect(button.getAttribute('aria-label')).toBe('Move "My Profile" to a folder')

    // Folder created in another panel, then the profile moved into it.
    folder = 'Work'
    manager.sync()

    expect(button.getAttribute('aria-label')).toBe('Move "My Profile" to a folder (now: Work)')
    expect(button.title).toContain('Folder: Work')
    // Reused, not rebuilt.
    expect(findAssignButton(rows[0].root)).toBe(button)

    manager.dispose()
  })

  it('removes the button from a row whose profile no longer resolves', () => {
    const { list, rows } = buildList(3)
    const pool = [profile('p1', 'One'), profile('p2', 'Two'), profile('p3', 'Three')]
    const { manager } = harness(list, rows.map((r) => r.root), pool)

    manager.sync()
    expect(findAssignButton(rows[2].root)).not.toBeNull()

    // Host deleted the last profile: the list is now shorter than the pool.
    const shrunk = pool.slice(0, 2)
    const { manager: manager2 } = harness(list, rows.map((r) => r.root), shrunk)
    manager.dispose()
    manager2.sync()

    expect(findAssignButton(rows[2].root)).toBeNull()
    expect(rows[2].root.querySelectorAll(`[${ASSIGN_ATTR}]`).length).toBe(0)
    expect(findAssignButton(rows[0].root)).not.toBeNull()

    manager2.dispose()
  })

  it('rebuilds the button when a row now maps to a different profile', () => {
    const { list, rows } = buildList(2)
    const pool = [profile('p1', 'One'), profile('p2', 'Two')]
    const { manager } = harness(list, rows.map((r) => r.root), pool)

    manager.sync()
    const before = findAssignButton(rows[0].root)

    // A drag reordered the rows underneath us.
    const reversed = [pool[1], pool[0]]
    const { manager: manager2 } = harness(list, rows.map((r) => r.root), reversed)
    manager.dispose()
    manager2.sync()

    const after = findAssignButton(rows[0].root)
    expect(after).not.toBe(before)
    expect(after!.getAttribute(ASSIGN_ATTR)).toBe('p2')
    expect(rows[0].root.querySelectorAll(`[${ASSIGN_ATTR}]`).length).toBe(1)

    manager2.dispose()
  })

  it('never puts the button inside the row select button', () => {
    const { list, rows } = buildList(2)
    const pool = [profile('p1', 'One'), profile('p2', 'Two')]
    const { manager } = harness(list, rows.map((r) => r.root), pool)

    manager.sync()

    for (const row of rows) {
      const button = findAssignButton(row.root)!
      expect(row.select.contains(button)).toBe(false)
      expect(row.select.querySelectorAll(`[${ASSIGN_ATTR}]`).length).toBe(0)
      expect(row.actions.contains(button)).toBe(true)
    }

    manager.dispose()
  })

  it('ignores the nested editing wrapper instead of double-injecting', () => {
    const { list, rows } = buildList(1)
    const nested = el('div')
    nested.setAttribute('data-component', 'ConnectionItem')
    rows[0].root.appendChild(nested)

    const { manager } = harness(list, rows.map((r) => r.root), [profile('p1', 'One')])
    manager.sync()

    expect(rows[0].root.querySelectorAll(`[${ASSIGN_ATTR}]`).length).toBe(1)
    expect(nested.querySelectorAll(`[${ASSIGN_ATTR}]`).length).toBe(0)

    manager.dispose()
  })

  it('falls back to the row root when a row is mid-edit (no action container)', () => {
    const { list, rows } = buildList(1)
    rows[0].actions.remove()
    const nested = el('div')
    nested.setAttribute('data-component', 'ConnectionItem')
    rows[0].root.appendChild(nested)

    const { manager } = harness(list, rows.map((r) => r.root), [profile('p1', 'One')])
    manager.sync()

    const button = findAssignButton(rows[0].root)
    expect(button).not.toBeNull()
    expect(rows[0].select.contains(button!)).toBe(false)
    expect(button!.parentElement).toBe(rows[0].root)

    manager.dispose()
  })

  it('skips a row that is no longer a child of the list, without throwing', () => {
    const { list, rows } = buildList(2)
    const pool = [profile('p1', 'One'), profile('p2', 'Two')]
    const roots = rows.map((r) => r.root)

    // Torn out of the document before we ever walk it.
    const detached = makeRow().root
    const { manager } = harness(list, [detached, roots[0]], pool)

    expect(() => manager.sync()).not.toThrow()
    expect(findAssignButton(detached)).toBeNull()
    expect(findAssignButton(roots[0])).not.toBeNull()

    // A row that React unmounted between syncs has its button forgotten, and a
    // later dispose() must not throw while reaching for it.
    roots[0].remove()
    expect(() => manager.sync()).not.toThrow()
    expect(() => manager.dispose()).not.toThrow()
  })

  it('decorates rows of a list that is itself detached', () => {
    const list = el('div')
    const rows = [makeRow(), makeRow()]
    for (const row of rows) list.appendChild(row.root)
    const pool = [profile('p1', 'One'), profile('p2', 'Two')]
    const { manager } = harness(list, rows.map((r) => r.root), pool)

    manager.sync()

    expect(findAssignButton(rows[0].root)).not.toBeNull()
    expect(findAssignButton(rows[1].root)).not.toBeNull()

    manager.dispose()
  })

  it('invokes onAssign with the profile behind the clicked row', () => {
    const { list, rows } = buildList(2)
    const pool = [profile('p1', 'One'), profile('p2', 'Two')]
    const { manager, assigned } = harness(list, rows.map((r) => r.root), pool)

    manager.sync()
    const ClickEvent = win.MouseEvent as new (type: string, init?: unknown) => Event
    findAssignButton(rows[1].root)!.dispatchEvent(new ClickEvent('click', { bubbles: true }))

    expect(assigned).toEqual(['p2'])

    manager.dispose()
  })
})

describe('RowAffixManager dispose', () => {
  it('removes every injected button and leaves the rows clean', () => {
    const { list, rows } = buildList(3)
    const pool = [profile('p1', 'One'), profile('p2', 'Two'), profile('p3', 'Three')]
    const { manager } = harness(list, rows.map((r) => r.root), pool)

    manager.sync()
    manager.dispose()

    for (const row of rows) {
      expect(row.root.querySelectorAll(`[${ASSIGN_ATTR}]`).length).toBe(0)
      expect(row.actions.children.length).toBe(0)
    }

    // Idempotent.
    expect(() => manager.dispose()).not.toThrow()
  })
})

describe('findAssignButton', () => {
  it('returns null for a row with no button, and for null-ish input', () => {
    const { row } = makeRow()
    expect(findAssignButton(row)).toBeNull()
    expect(findAssignButton(undefined as unknown as HTMLElement)).toBeNull()
  })
})
