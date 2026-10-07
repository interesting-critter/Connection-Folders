/**
 * Collapsible folders inside the chat composer's native `connections` popover.
 *
 * This is the SECOND surface the extension groups. The drawer tab
 * (`src/dom/controller.ts`) walks a host-owned list that stays mounted; this
 * popover is transient — React mounts it on click and unmounts it 250ms after
 * close — so nothing can be "mounted once and kept". The controller therefore
 * works opportunistically:
 *
 *   1. ONE delegated `click` listener on `document` detects the opener
 *      (`[data-composer-action="connections"]`). We cannot use `ctx.dom.query`
 *      here: that is scoped to extension-owned roots, and the whole point is
 *      that the popover lives in host DOM.
 *   2. The click is followed by a bounded `requestAnimationFrame` poll, because
 *      React attaches the popover on the very next commit.
 *   3. Once found, headers are appended and flex `order` interleaves them with
 *      the untouched native rows.
 *
 * HARD RULE (identical to the drawer): native nodes are NEVER moved, removed or
 * reparented, and `className` is never touched. Only `order` / `display` are
 * written on rows, and headers are appended.
 *
 * ## Why `applyOrder` is local and not `dom/order.ts`'s `assignOrder`
 *
 * `dom/order.ts` keeps its `managed` Set and `previousDisplay` Map at MODULE
 * level, and it resets "anything we used to manage that is absent from `items`".
 * Sharing that bookkeeping between the drawer controller and this popover
 * controller means one surface's pass would reset the OTHER surface's elements
 * (they are never in each other's `items`), permanently dropping `order` and
 * collapsing rows that the other surface still needs. Since `assignOrder`'s
 * `reset everything unknown` semantics are exactly what corrupts the shared
 * state, the cleaner fix is instance-scoped state: a local `applyOrder` that
 * tracks only the elements THIS controller ever touched. `src/dom/order.ts`
 * itself is left alone, so the drawer's behaviour is unchanged.
 */

import {
  UNCATEGORIZED_KEY,
  groupProfilesByFolder,
  includeEmptyFolders,
  type FolderGroup,
} from '../folders/model'
import {
  createFolderHeader,
  updateFolderHeader,
  FOLDER_ATTR,
  CF_NAME_CLASS,
  CF_COUNT_CLASS,
  CF_CHEVRON_CLASS,
  CF_CHEVRON_OPEN_CLASS,
  CF_HEADER_CLASS,
} from '../dom/headers'
import type { ConnectionProfile } from '../types'

/** Host markup hooks, all matched by SUBSTRING: CSS-module names are hashed. */
const OPENER_SELECTOR = '[data-composer-action="connections"]'
const INPUT_AREA_SELECTOR = '[data-component="InputArea"]'
/** `_popover_` is distinct from `_popoverSlot_` / `_popoverClosing_`. */
const POPOVER_CLASS = 'popover'
const POPOVER_EXCLUSIONS = ['popoverSlot', 'popoverClosing', 'popoverSlotInner']
const ROW_CLASS = 'popRowBtn'
const LINK_CLASS = 'popLink'
const NAME_GROUP_CLASS = 'personaNameGroup'

/** Frames the opener poll runs before giving up on a popover. */
const POLL_FRAMES = 30

/** Label for the synthetic "no folder" bucket (matches the drawer tab). */
const UNCATEGORIZED_LABEL = 'Uncategorized'

export interface InputFolderControllerOptions {
  /** Read the current store-ordered profiles (credentials already stripped). */
  listProfiles: () => ConnectionProfile[]
  /** Persisted folder names to merge with names discovered on profiles. */
  folderNames: () => string[]
  /** Current explicit collapse set (identity = folder name or UNCATEGORIZED_KEY). */
  collapsed: () => Set<string>
  /** Called when the user toggles a folder, so the caller can persist it. */
  onToggle: (key: string) => void
}



/** Collapse identity for a grouping key; mirrors `frontend.ts`'s `collapseKey`. */
function collapseKey(folder: string): string {
  return folder || UNCATEGORIZED_KEY
}

/**
 * Locate the popover container inside the InputArea root.
 *
 * Substring matching on the hashed CSS-module class is the only available hook.
 * `popoverSlot` / `popoverClosing` also CONTAIN `popover`, so a node qualifies
 * only when it does not carry any of them.
 */
export function locatePopover(root: ParentNode | null): HTMLElement | null {
  if (!root) return null

  let fallback: HTMLElement | null = null
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('div'))) {
    const className = el.className
    if (typeof className !== 'string') continue
    if (className.includes(`_${POPOVER_CLASS}_`)) return el
    if (fallback) continue
    if (!className.includes(POPOVER_CLASS)) continue
    if (POPOVER_EXCLUSIONS.some((excluded) => className.includes(excluded))) continue
    fallback = el
  }
  return fallback
}

/**
 * Direct children of the popover that are profile rows: `<button>` elements
 * whose class matches `popRowBtn`, excluding the trailing `popLink` button.
 * Every other child (`popEmpty`, anything the host adds later) is ignored.
 */
export function locatePopoverRows(popover: HTMLElement): { rows: HTMLElement[]; link: HTMLElement | null } {
  const rows: HTMLElement[] = []
  let link: HTMLElement | null = null
  for (const child of Array.from(popover.children)) {
    const el = child as HTMLElement
    if (el.tagName !== 'BUTTON') continue
    const className = el.className
    if (typeof className !== 'string') continue
    if (className.includes(LINK_CLASS)) {
      link = el
      continue
    }
    if (className.includes(ROW_CLASS)) rows.push(el)
  }
  return { rows, link }
}

/** The profile name is the first span inside `[class*="personaNameGroup"]`. */
export function rowLabel(row: HTMLElement): string | null {
  const group = Array.from(row.querySelectorAll<HTMLElement>('span')).find((el) =>
    el.className.includes(NAME_GROUP_CLASS),
  )
  if (!group) return null
  const first = group.querySelector('span')
  return first ? (first.textContent ?? '') : null
}

export class InputFolderController {
  private readonly options: InputFolderControllerOptions
  private observer: MutationObserver | null = null
  private popover: HTMLElement | null = null
  private disposed = false
  private started = false

  /** Headers we injected into the current popover, keyed by folder name. */
  private headers = new Map<string, HTMLElement>()

  /**
   * Elements this controller ever set `order` on, with the inline `display`
   * they had beforehand. Instance-scoped on purpose — see the file header.
   */
  private touched = new Map<HTMLElement, string>()

  /** Last observed row→profile name verification result (diagnostics/tests). */
  private verifiedMapping = false

  /** True when the last pass confirmed row names match profile names. */
  get mappingVerified(): boolean {
    return this.verifiedMapping
  }

  /** Headers injected into the live popover, keyed by folder name. */
  get injectedHeaders(): ReadonlyMap<string, HTMLElement> {
    return this.headers
  }

  /** Grouping passes run so far (diagnostics: assert the observer settles). */
  get passes(): number {
    return this.passCount
  }

  /** Coalescing flag: a burst of triggers produces exactly one pass. */
  private passScheduled = false
  /** Total passes run; a runaway observer loop shows up as unbounded growth. */
  private passCount = 0
  private passRunning = false
  /** Set while our own writes are in flight so the observer stays quiet. */
  
  private clickBound = false

  constructor(options: InputFolderControllerOptions) {
    this.options = options
  }

  /** Begin watching for the popover. Safe to call once at setup. */
  start(): void {
    if (this.started || this.disposed) return
    this.started = true
    if (!this.clickBound && typeof document !== 'undefined') {
      document.addEventListener('click', this.onDocumentClick, true)
      this.clickBound = true
    }
  }

  /**
   * Remove every injected header and restore every row we touched. Mandatory:
   * a stale `order` on a host row permanently corrupts the popover layout.
   */
  dispose(): void {
    this.disposed = true
    if (this.clickBound) {
      document.removeEventListener('click', this.onDocumentClick, true)
      this.clickBound = false
    }
    this.teardown()
  }

  /* ── Detection ────────────────────────────────────────────────────────── */

  private onDocumentClick = (event: Event): void => {
    if (this.disposed) return
    const target = event.target as (Node & { closest?: (s: string) => Element | null }) | null
    const hit = target && typeof target.closest === 'function' ? target.closest(OPENER_SELECTOR) : null
    if (!hit) return
    // React has not committed the popover yet; poll for it across frames.
    this.pollForPopover(POLL_FRAMES)
  }

  /**
   * Bounded rAF poll. The popover appears on the next React commit, so a few
   * frames is generous; the bound stops a missed popover from pinning a
   * permanent loop on the animation frame queue.
   */
  private pollForPopover(framesRemaining: number): void {
    if (this.disposed || framesRemaining <= 0) return
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : null
    const step = (): void => {
      if (this.disposed) return
      const popover = this.findPopover()
      if (popover) {
        this.attach(popover)
        this.schedulePass()
        return
      }
      if (framesRemaining > 1) this.pollForPopover(framesRemaining - 1)
    }
    if (raf) raf(step)
    else void Promise.resolve().then(step)
  }

  /** The InputArea root, then the popover inside it. */
  private findPopover(): HTMLElement | null {
    if (typeof document === 'undefined') return null
    const area = document.querySelector<HTMLElement>(INPUT_AREA_SELECTOR)
    if (!area) return null
    return locatePopover(area)
  }

  /**
   * Bind the observer to the current popover. Re-group when the store changes
   * while the popover is open: `applyProfiles` in the entry point only updates
   * the drawer controller, so we poll the injected getter on our own schedule.
   */
  private attach(popover: HTMLElement): void {
    if (this.popover === popover) {
      this.schedulePass()
      return
    }
    this.teardown()
    this.popover = popover
    if (typeof MutationObserver === 'function') {
      this.observer = new MutationObserver(() => {
        if (this.disposed || this.passRunning) return
        // The popover unmounting takes its rows with it; drop our state so a
        // stale `order` can never be left behind on a detached row.
        if (!popover.isConnected) {
          this.teardown()
          return
        }
        this.schedulePass()
      })
      // childList/subtree only. Observing `style`/`class` would feed our own
      // writes straight back in: a pass that stamps `order` is itself a
      // mutation, and re-running forever is exactly the runaway the drawer
      // controller hit. Host row mutations that matter (a profile added or
      // removed) are structural, so childList is sufficient — and every style
      // write below is guarded to only fire on an actual change.
      this.observer.observe(popover, { childList: true, subtree: true })
    }
    this.schedulePass()
  }

  /**
   * Drop the observer, remove injected headers, restore `order`/`display` on
   * every element this instance touched.
   */
  private teardown(): void {
    this.observer?.disconnect()
    this.observer = null
    for (const header of Array.from(this.headers.values())) {
      try {
        header.remove()
      } catch {
        // Node already detached by React; nothing left to undo.
      }
    }
    this.headers.clear()
    for (const [el, display] of Array.from(this.touched.entries())) {
      try {
        el.style.order = ''
        el.style.display = display
      } catch {
        // Element torn down mid-teardown; ignore.
      }
    }
    this.touched.clear()
    this.popover = null
  }

  /** Coalesce to a microtask so a burst of triggers yields exactly one pass. */
  private schedulePass(): void {
    if (this.passScheduled || this.disposed) return
    this.passScheduled = true
    const run = (): void => {
      this.passScheduled = false
      this.pass()
    }
    if (typeof queueMicrotask === 'function') queueMicrotask(run)
    else void Promise.resolve().then(run)
  }

  /* ── One grouping pass ────────────────────────────────────────────────── */

  /**
   * Idempotent: run with no intervening host mutation and the DOM is unchanged
   * (headers are updated in place, and only differing style values are written
   * so our own writes never feed the observer).
   */
  private pass(): void {
    this.passCount += 1
    if (this.disposed) return
    const popover = this.popover
    if (!popover || !popover.isConnected) {
      this.teardown()
      return
    }

    const profiles = this.options.listProfiles() ?? []
    const { rows, link } = locatePopoverRows(popover)

    // Counts must agree, or positional mapping is a guess — never guess.
    if (rows.length !== profiles.length) {
      this.restore()
      return
    }

    // Verify the positional mapping by name before trusting it. A failure does
    // NOT skip grouping: the popover renders `profiles` unsorted, so DOM order
    // is store order and index mapping stays correct. The flag is recorded so
    // diagnostics can tell the two cases apart.
    this.verifiedMapping = verifyMapping(rows, profiles)

    const groups = includeEmptyFolders(groupProfilesByFolder(profiles), this.options.folderNames() ?? [], profiles)

    // Drop headers for folders that no longer exist, keep the rest for reuse.
    const wanted = new Set(groups.map((group) => group.folder))
    for (const [folder, header] of Array.from(this.headers.entries())) {
      if (!wanted.has(folder)) {
        header.remove()
        this.headers.delete(folder)
      }
    }

    // Positional row ↔ profile map. Built once per pass; `rows` and
    // `profiles` already have equal length here.
    const rowIndexById = new Map<string, number>()
    profiles.forEach((profile, index) => {
      if (profile.id) rowIndexById.set(profile.id, index)
    })

    const collapsed = this.options.collapsed() ?? new Set<string>()
    const items: Array<{ el: HTMLElement; collapsed: boolean }> = []

    for (const group of groups) {
      const key = collapseKey(group.folder)
      const isCollapsed = collapsed.has(key)
      const header = this.ensureHeader(group, isCollapsed)
      items.push({ el: header, collapsed: false })

      for (const profile of group.profiles) {
        const index = rowIndexById.get(profile.id)
        const row = index === undefined ? null : rows[index]
        if (row) items.push({ el: row, collapsed: isCollapsed })
      }
    }

    // The trailing "Manage connections" link is host chrome, not a row: give it
    // the highest order so it stays visually last without moving the node.
    if (link) items.push({ el: link, collapsed: false })

    this.passRunning = true
    try {
      this.applyOrder(items)
    } finally {
      this.passRunning = false
    }
  }

  /**
   * Create or reuse the header for `group` and append it to the popover. Only
   * extension-created elements are ever inserted, so React reconciliation
   * never sees a host child move.
   */
  private ensureHeader(group: FolderGroup<ConnectionProfile>, isCollapsed: boolean): HTMLElement {
    const folder = group.folder
    const label = folder || UNCATEGORIZED_LABEL
    const existing = this.headers.get(folder)
    if (existing && existing.isConnected) {
      // Only write when something actually differs. `updateFolderHeader`
      // assigns `textContent`, which replaces a text node: an unconditional
      // call is a `childList` mutation, which our own observer sees, which
      // schedules another pass — an endless microtask loop that starves the
      // host. Comparing first is what makes a pass converge.
      if (!headerIsCurrent(existing, isCollapsed, group.profiles.length, label)) {
        updateFolderHeader(existing, {
          collapsed: isCollapsed,
          count: group.profiles.length,
          label,
        })
      }
      if (existing.getAttribute(FOLDER_ATTR) !== folder) existing.setAttribute(FOLDER_ATTR, folder)
      // Only append when it is not already a child: re-appending an attached
      // node emits a childList record, which would feed the observer and turn
      // every pass into another pass.
      if (existing.parentElement !== this.popover) this.popover?.appendChild(existing)
      return existing
    }
    const header = createFolderHeader({
      folder,
      label,
      count: group.profiles.length,
      collapsed: isCollapsed,
      onToggle: () => {
        this.options.onToggle(collapseKey(folder))
        this.schedulePass()
      },
      // Read-only grouping inside a transient popover: rename and delete live
      // in the drawer tab, where the list is durable.
    })
    header.setAttribute(FOLDER_ATTR, folder)
    this.popover?.appendChild(header)
    this.headers.set(folder, header)
    return header
  }

  /**
   * Public escape hatch: re-run a pass immediately (used when the profile list
   * changes while the popover is open, and by tests). `listProfiles()` is read
   * on every pass, so this is all a store change needs.
   */
  refresh(): void {
    if (this.disposed) return
    const popover = this.findPopover()
    if (popover) {
      this.attach(popover)
      this.pass()
      return
    }
    this.teardown()
  }

  /**
   * Assign sequential `order` across the flattened sequence; hide collapsed
   * rows. Only differing values are written, and the pre-existing inline
   * `display` is snapshotted on first touch so clearing restores it exactly.
   */
  private applyOrder(items: ReadonlyArray<{ el: HTMLElement; collapsed: boolean }>): void {
    const next = new Set<HTMLElement>()
    items.forEach((item, index) => {
      const el = item.el
      // React can unmount nodes mid-pass; a detached element has no style to
      // write and must be dropped rather than corrupting the bookkeeping.
      if (!el.isConnected && !el.parentElement) return
      next.add(el)
      if (!this.touched.has(el)) this.touched.set(el, el.style.display)
      const target = String(index)
      if (el.style.order !== target) el.style.order = target
      const display = item.collapsed ? 'none' : (this.touched.get(el) ?? '')
      if (el.style.display !== display) el.style.display = display
    })

    for (const [el, display] of Array.from(this.touched.entries())) {
      if (next.has(el)) continue
      try {
        el.style.order = ''
        el.style.display = display
      } catch {
        // Detached mid-pass; nothing to restore.
      }
      this.touched.delete(el)
    }
  }

  /** Reset bookkeeping when we decline to group (counts disagree). */
  private restore(): void {
    for (const header of Array.from(this.headers.values())) header.remove()
    this.headers.clear()
    for (const [el, display] of Array.from(this.touched.entries())) {
      try {
        el.style.order = ''
        el.style.display = display
      } catch {
        // ignore
      }
    }
    this.touched.clear()
  }
}

/**
 * True when an existing header already shows exactly this state, so the pass
 * can skip `updateFolderHeader` entirely and write nothing.
 */
function headerIsCurrent(el: HTMLElement, collapsed: boolean, count: number, label: string): boolean {
  const toggle = el.querySelector(`.${CF_HEADER_CLASS}`)
  if (!toggle) return false
  if (toggle.getAttribute('aria-expanded') !== (collapsed ? 'false' : 'true')) return false
  const chevron = el.querySelector(`.${CF_CHEVRON_CLASS}`)
  const wantsOpen = !collapsed
  const isOpen = !!chevron?.classList.contains(CF_CHEVRON_OPEN_CLASS)
  if (isOpen !== wantsOpen) return false
  const countEl = el.querySelector(`.${CF_COUNT_CLASS}`)
  if ((countEl?.textContent ?? '') !== String(count)) return false
  const nameEl = el.querySelector(`.${CF_NAME_CLASS}`)
  return (nameEl?.textContent ?? '') === label
}

/** True when the row labels line up with the profile names positionally. */
export function verifyMapping(rows: HTMLElement[], profiles: ConnectionProfile[]): boolean {
  if (rows.length !== profiles.length) return false
  return rows.every((row, index) => rowLabel(row) === profiles[index]?.name)
}



/* Exported for tests / diagnostics: header sub-elements used by assertions. */
export const HEADER_CLASSES = {
  row: CF_HEADER_CLASS,
  name: CF_NAME_CLASS,
  count: CF_COUNT_CLASS,
  chevron: CF_CHEVRON_CLASS,
  chevronOpen: CF_CHEVRON_OPEN_CLASS,
}