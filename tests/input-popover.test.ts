/**
 * Input-area connections popover grouping.
 *
 * The fixture mirrors the real markup from
 * `frontend/src/components/chat/InputArea.tsx` (~3771-3800):
 *
 *   <div class="_popover_x_1 [_popoverClosing_x_1]">
 *     <div class="_popEmpty_…">…</div>                       (when empty)
 *     <button class="_popRowBtn_…">
 *       <span class="_personaMain_…"><span class="_personaNameGroup_…">
 *         <span>{p.name}</span><span class="_popMeta_…">…</span>
 *       </span></span>
 *     </button>
 *     …
 *     <button class="_popLink_…">Manage connections</button>
 *   </div>
 *
 * happy-dom globals are installed per-file, matching tests/dom.test.ts.
 */
import { describe, it, expect, beforeEach } from 'bun:test'
import { Window as HappyDomWindow } from 'happy-dom'

import {
  InputFolderController,
  HEADER_CLASSES,
  locatePopover,
  locatePopoverRows,
  verifyMapping,
} from '../src/input/popover-folders'
import { FOLDER_ATTR } from '../src/dom/headers'
import type { ConnectionProfile } from '../src/types'

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
  'requestAnimationFrame',
  'cancelAnimationFrame',
] as const

let win: Record<string, unknown>

beforeEach(() => {
  win = new NewWindow() as Record<string, unknown>
  const target = globalThis as unknown as Record<string, unknown>
  for (const key of DOM_GLOBALS) target[key] = win[key]
  document.body.innerHTML = ''
})

function profile(id: string, name: string, folder?: string): ConnectionProfile {
  return {
    id,
    name,
    provider: 'openai',
    model: 'gpt-5',
    metadata: folder ? { folder } : null,
  }
}

interface Fixture {
  inputArea: HTMLElement
  popover: HTMLElement
  rows: HTMLElement[]
  link: HTMLElement
}

/**
 * Build the popover fixture. `closing` adds the `popoverClosing` class, which
 * also contains the substring `popover` and must not be mistaken for the
 * container.
 */
function buildFixture(names: string[], options: { closing?: boolean } = {}): Fixture {
  const area = document.createElement('div')
  area.setAttribute('data-component', 'InputArea')

  // Decoys that also match a naive `*popover*` search.
  const slot = document.createElement('div')
  slot.className = '_popoverSlot_abc12_3'
  const slotInner = document.createElement('div')
  slotInner.className = '_popoverSlotInner_abc12_4'
  slot.appendChild(slotInner)

  const popover = document.createElement('div')
  popover.className = options.closing ? '_popover_abc12_1 _popoverClosing_abc12_2' : '_popover_abc12_1'
  popover.style.display = 'flex'
  popover.style.flexDirection = 'column'
  popover.style.gap = '4px'

  const empty = document.createElement('div')
  empty.className = '_popEmpty_abc12_5'
  empty.textContent = 'No connections'
  popover.appendChild(empty)

  const rows: HTMLElement[] = names.map((name) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = '_popRowBtn_abc12_6'
    const main = document.createElement('span')
    main.className = '_personaMain_abc12_7'
    const nameGroup = document.createElement('span')
    nameGroup.className = '_personaNameGroup_abc12_8'
    const label = document.createElement('span')
    label.textContent = name
    const meta = document.createElement('span')
    meta.className = '_popMeta_abc12_9'
    meta.textContent = 'openai / gpt-5'
    nameGroup.append(label, meta)
    main.appendChild(nameGroup)
    button.appendChild(main)
    popover.appendChild(button)
    return button
  })

  const link = document.createElement('button')
  link.type = 'button'
  link.className = '_popLink_abc12_10'
  link.textContent = 'Manage connections'
  popover.appendChild(link)

  area.append(slot, popover)
  document.body.appendChild(area)
  return { inputArea: area, popover, rows, link }
}

function makeController(
  profiles: ConnectionProfile[],
  folderNames: string[] = [],
  collapsed = new Set<string>(),
): { controller: InputFolderController; toggled: string[] } {
  const toggled: string[] = []
  const controller = new InputFolderController({
    listProfiles: () => profiles,
    folderNames: () => folderNames,
    collapsed: () => collapsed,
    onToggle: (key) => {
      toggled.push(key)
      if (collapsed.has(key)) collapsed.delete(key)
      else collapsed.add(key)
      controller.refresh()
    },
  })
  controller.start()
  return { controller, toggled }
}

/** Headers currently in the popover, in DOM order, with their labels/counts. */
function readHeaders(popover: HTMLElement): Array<{ folder: string; label: string; count: string; collapsed: boolean }> {
  return Array.from(popover.querySelectorAll<HTMLElement>(`[${FOLDER_ATTR}]`)).map((el) => ({
    folder: el.getAttribute(FOLDER_ATTR) ?? '',
    label: el.querySelector(`.${HEADER_CLASSES.name}`)?.textContent ?? '',
    count: el.querySelector(`.${HEADER_CLASSES.count}`)?.textContent ?? '',
    collapsed: el.querySelector(`.${HEADER_CLASSES.row}`)?.getAttribute('aria-expanded') === 'false',
  }))
}

/** Ordered `[kind, identity]` pairs exactly as flexbox will lay them out. */
function visualOrder(fixture: Fixture): string[] {
  const children = Array.from(fixture.popover.children) as HTMLElement[]
  return [...children]
    .filter((el) => el.getAttribute(FOLDER_ATTR) !== null || el === fixture.link || fixture.rows.includes(el))
    .sort((a, b) => Number(a.style.order || 0) - Number(b.style.order || 0))
    .map((el) => {
      if (el.getAttribute(FOLDER_ATTR) !== null) return `header:${el.getAttribute(FOLDER_ATTR)}`
      if (el === fixture.link) return 'link'
      return `row:${fixture.rows.indexOf(el)}`
    })
}

describe('locatePopover / locatePopoverRows', () => {
  it('prefers _popover_ and ignores the popoverSlot decoys', () => {
    const fixture = buildFixture(['A'])
    const found = locatePopover(fixture.inputArea)
    expect(found).toBe(fixture.popover)
  })

  it('falls back to exclusion matching when the hash form is absent', () => {
    const fixture = buildFixture(['A'])
    fixture.popover.className = 'popover extra'
    expect(locatePopover(fixture.inputArea)).toBe(fixture.popover)
  })

  it('never returns a popoverClosing or popoverSlot element', () => {
    const fixture = buildFixture(['A'], { closing: true })
    // `_popoverClosing_` alone must not qualify.
    fixture.popover.className = 'popoverClosing'
    expect(locatePopover(fixture.inputArea)).toBeNull()
  })

  it('returns null for a missing InputArea root', () => {
    expect(locatePopover(null)).toBeNull()
    expect(locatePopover(document.createElement('div'))).toBeNull()
  })

  it('collects popRowBtn buttons only, separating the trailing popLink', () => {
    const fixture = buildFixture(['A', 'B'])
    const { rows, link } = locatePopoverRows(fixture.popover)
    expect(rows).toEqual(fixture.rows)
    expect(link).toBe(fixture.link)
  })
})

describe('InputFolderController grouping', () => {
  it('emits one header per folder with labels and counts', () => {
    const profiles = [
      profile('1', 'Alpha', 'Work'),
      profile('2', 'Bravo', 'Work'),
      profile('3', 'Charlie'),
    ]
    const fixture = buildFixture(['Alpha', 'Bravo', 'Charlie'])
    const { controller } = makeController(profiles)
    controller.refresh()

    const headers = readHeaders(fixture.popover)
    expect(headers.map((h) => h.folder)).toEqual(['Work', ''])
    expect(headers.map((h) => h.label)).toEqual(['Work', 'Uncategorized'])
    expect(headers.map((h) => h.count)).toEqual(['2', '1'])
    controller.dispose()
  })

  it('places Uncategorized last and gives it the __uncategorized identity', () => {
    const profiles = [profile('1', 'Alpha'), profile('2', 'Bravo', 'Zeta'), profile('3', 'C', 'Alpha')]
    const fixture = buildFixture(['Alpha', 'Bravo', 'C'])
    const { controller, toggled } = makeController(profiles)
    controller.refresh()

    expect(readHeaders(fixture.popover).map((h) => h.folder)).toEqual(['Alpha', 'Zeta', ''])

    const uncategorized = fixture.popover.querySelector<HTMLElement>(`[${FOLDER_ATTR}=""]`)
    uncategorized?.querySelector<HTMLElement>(`.${HEADER_CLASSES.row}`)?.dispatchEvent(
      new Event('click', { bubbles: true }),
    )
    expect(toggled).toEqual(['__uncategorized'])
    controller.dispose()
  })

  it('includes persisted folders that no visible profile uses', () => {
    const profiles = [profile('1', 'Alpha', 'Work')]
    const fixture = buildFixture(['Alpha'])
    const { controller } = makeController(profiles, ['Work', 'Archived'])
    controller.refresh()
    // No uncategorized group: every profile is filed. `Archived` exists only in
    // the persisted names, so it renders as an empty folder.
    expect(readHeaders(fixture.popover).map((h) => h.folder)).toEqual(['Archived', 'Work'])
    expect(readHeaders(fixture.popover).map((h) => h.count)).toEqual(['0', '1'])
    controller.dispose()
  })

  it('interleaves headers and rows by order and leaves popLink last', () => {
    const profiles = [
      profile('1', 'Alpha', 'Work'),
      profile('2', 'Bravo'),
      profile('3', 'C', 'Work'),
    ]
    const fixture = buildFixture(['Alpha', 'Bravo', 'C'])
    const { controller } = makeController(profiles)
    controller.refresh()

    // Work: header + rows 0 and 2 (store order), then Uncategorized + row 1,
    // then the host's own "Manage connections" link.
    expect(visualOrder(fixture)).toEqual(['header:Work', 'row:0', 'row:2', 'header:', 'row:1', 'link'])
    // Every managed element carries a distinct sequential order.
    // Managed elements get 0…5; host chrome the controller ignores (the
    // `popEmpty` div) is left completely untouched.
    const managed = visualOrder(fixture).map((_, i) => String(i))
    const orders = Array.from(fixture.popover.children)
      .filter((el) => (el as HTMLElement).style.order !== '')
      .map((el) => (el as HTMLElement).style.order)
    expect(orders.sort()).toEqual(managed)
    expect(fixture.popover.querySelector<HTMLElement>('div')!.style.order).toBe('')
    expect(fixture.link.style.order).toBe('5')
    controller.dispose()
  })

  it('hides exactly the collapsed folder rows and restores display on expand', () => {
    const profiles = [
      profile('1', 'Alpha', 'Work'),
      profile('2', 'Bravo', 'Work'),
      profile('3', 'C'),
    ]
    const fixture = buildFixture(['Alpha', 'Bravo', 'C'])
    const collapsed = new Set(['Work'])
    const { controller } = makeController(profiles, [], collapsed)
    controller.refresh()

    expect(readHeaders(fixture.popover).find((h) => h.folder === 'Work')?.collapsed).toBe(true)
    expect(fixture.rows[0].style.display).toBe('none')
    expect(fixture.rows[1].style.display).toBe('none')
    expect(fixture.rows[2].style.display).toBe('')

    collapsed.delete('Work')
    controller.refresh()
    expect(fixture.rows[0].style.display).toBe('')
    expect(fixture.rows[1].style.display).toBe('')
    controller.dispose()
  })

  it('skips grouping entirely when row and profile counts differ', () => {
    const profiles = [profile('1', 'Alpha', 'Work'), profile('2', 'Bravo')]
    const fixture = buildFixture(['Alpha']) // one row short
    const { controller } = makeController(profiles)
    controller.refresh()

    expect(readHeaders(fixture.popover)).toEqual([])
    expect(fixture.rows[0].style.order).toBe('')
    controller.dispose()
  })

  it('falls back to index mapping when names do not match', () => {
    const profiles = [profile('1', 'Alpha', 'Work'), profile('2', 'Bravo')]
    const fixture = buildFixture(['Renamed by host', 'Bravo'])
    const { controller } = makeController(profiles)
    expect(verifyMapping(fixture.rows, profiles)).toBe(false)
    controller.refresh()
    expect(controller.mappingVerified).toBe(false)
    // Index mapping still applied: grouping is not skipped.
    expect(readHeaders(fixture.popover).map((h) => h.folder)).toEqual(['Work', ''])
    controller.dispose()
  })

  it('confirms the mapping when names line up', () => {
    const profiles = [profile('1', 'Alpha'), profile('2', 'Bravo')]
    const fixture = buildFixture(['Alpha', 'Bravo'])
    const { controller } = makeController(profiles)
    expect(verifyMapping(fixture.rows, profiles)).toBe(true)
    controller.refresh()
    expect(controller.mappingVerified).toBe(true)
    controller.dispose()
  })

  it('is idempotent across two consecutive passes', () => {
    const profiles = [
      profile('1', 'Alpha', 'Work'),
      profile('2', 'Bravo'),
      profile('3', 'C', 'Work'),
    ]
    const fixture = buildFixture(['Alpha', 'Bravo', 'C'])
    const { controller } = makeController(profiles)
    controller.refresh()
    const firstHeaders = readHeaders(fixture.popover)
    const firstOrder = visualOrder(fixture)
    const firstStyleOrder = Array.from(fixture.popover.children).map((el) => (el as HTMLElement).style.order)
    const firstPasses = controller.passes

    controller.refresh()
    expect(readHeaders(fixture.popover)).toEqual(firstHeaders)
    expect(visualOrder(fixture)).toEqual(firstOrder)
    expect(Array.from(fixture.popover.children).map((el) => (el as HTMLElement).style.order)).toEqual(firstStyleOrder)
    // No duplicated headers, and host children count unchanged.
    expect(fixture.popover.querySelectorAll(`[${FOLDER_ATTR}]`).length).toBe(firstHeaders.length)
    expect(fixture.popover.children.length).toBe(3 + firstHeaders.length + 1 + 1)
    // Exactly one extra pass: the observer never self-fed.
    expect(controller.passes).toBe(firstPasses + 1)
    controller.dispose()
  })

  it('restores every touched row and removes headers on dispose', () => {
    const profiles = [profile('1', 'Alpha', 'Work'), profile('2', 'Bravo'), profile('3', 'C', 'Work')]
    const fixture = buildFixture(['Alpha', 'Bravo', 'C'])
    const collapsed = new Set(['Work'])
    const before = fixture.rows.map((row) => ({ order: row.style.order, display: row.style.display }))
    const beforeLink = { order: fixture.link.style.order, display: fixture.link.style.display }

    const { controller } = makeController(profiles, [], collapsed)
    controller.refresh()
    expect(fixture.rows[0].style.display).toBe('none')

    controller.dispose()

    expect(fixture.popover.querySelectorAll(`[${FOLDER_ATTR}]`).length).toBe(0)
    fixture.rows.forEach((row, index) => {
      expect(row.style.order).toBe(before[index]!.order)
      expect(row.style.display).toBe(before[index]!.display)
    })
    expect(fixture.link.style.order).toBe(beforeLink.order)
    expect(fixture.link.style.display).toBe(beforeLink.display)
  })

  it('restores a pre-existing inline display on the row it was hiding', () => {
    const profiles = [profile('1', 'Alpha', 'Work')]
    const fixture = buildFixture(['Alpha'])
    fixture.rows[0]!.style.display = 'flex'
    const { controller } = makeController(profiles, [], new Set(['Work']))
    controller.refresh()
    expect(fixture.rows[0]!.style.display).toBe('none')
    controller.dispose()
    expect(fixture.rows[0]!.style.display).toBe('flex')
  })

  it('tears down when the popover unmounts, leaving no stale order', () => {
    const profiles = [profile('1', 'Alpha', 'Work'), profile('2', 'Bravo')]
    const fixture = buildFixture(['Alpha', 'Bravo'])
    const { controller } = makeController(profiles)
    controller.refresh()
    const row = fixture.rows[0]!
    expect(row.style.order).toBe('1')

    fixture.popover.remove()
    controller.refresh()

    expect(controller.injectedHeaders.size).toBe(0)
    expect(row.style.order).toBe('')
    controller.dispose()
  })

  it('groups through the delegated opener click and the bounded rAF poll', async () => {
    const profiles = [profile('1', 'Alpha', 'Work'), profile('2', 'Bravo')]
    const fixture = buildFixture(['Alpha', 'Bravo'])
    const { controller } = makeController(profiles)
    expect(readHeaders(fixture.popover)).toEqual([])

    const opener = document.createElement('span')
    opener.setAttribute('data-composer-action', 'connections')
    document.body.appendChild(opener)
    opener.dispatchEvent(new Event('click', { bubbles: true }))

    await new Promise((resolve) => setTimeout(resolve, 60))

    expect(readHeaders(fixture.popover).map((h) => h.folder)).toEqual(['Work', ''])
    expect(visualOrder(fixture)).toEqual(['header:Work', 'row:0', 'header:', 'row:1', 'link'])
    controller.dispose()
  })

  it('does not loop its observer for a single mutation burst', async () => {
    const profiles = [profile('1', 'Alpha', 'Work'), profile('2', 'Bravo')]
    const fixture = buildFixture(['Alpha', 'Bravo'])
    const { controller } = makeController(profiles)
    controller.refresh()

    // Count passes by spying on a write path: every pass stamps `order` on a
    // freshly added row, so a runaway loop is visible as unbounded order churn.
    const extra = document.createElement('button')
    extra.className = '_popRowBtn_abc12_6'
    extra.innerHTML = '<span class="_personaNameGroup_abc12_8"><span>Gamma</span></span>'
    fixture.popover.appendChild(extra)

    await new Promise((resolve) => setTimeout(resolve, 60))

    // Profiles still have 2 entries while the popover now renders 3 rows, so
    // the pass declines to group and resets — bounded, and no runaway growth.
    expect(fixture.popover.querySelectorAll(`[${FOLDER_ATTR}]`).length).toBe(0)
    expect(fixture.rows.every((row) => row.style.order === '')).toBe(true)
    // The observer settled: a handful of passes, not a spinning loop.
    expect(controller.passes).toBeGreaterThan(1)
    expect(controller.passes).toBeLessThanOrEqual(6)
    controller.dispose()
  })
})