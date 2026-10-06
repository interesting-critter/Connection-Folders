/**
 * FolderController — owns the DOM lifecycle of folder headers inside
 * Lumiverse's Connections list.
 *
 * Responsibilities, in order:
 *   1. Probe the host and ABORT cleanly when the layout cannot support the
 *      technique (`mount()` returns false, never throws).
 *   2. Keep exactly one header element per group, keyed by `data-cf-folder`.
 *   3. Assign flex `order` across the flattened `[header, row, …]` sequence.
 *
 * Row → profile mapping is POSITIONAL: direct children of the list in DOM order
 * correspond 1:1 to the `orderedProfiles` array the host rendered, because the
 * native rows carry no profile id in the DOM. `setProfiles` is therefore called
 * with that exact ordered list.
 *
 * All presentation decisions — labels, which groups get action buttons, drop
 * target state — are delegated to the injected `render`, so this file never
 * imports from `src/ui/*`.
 */

import {
  groupProfilesByFolder,
  includeEmptyFolders,
  type FolderGroup,
} from '../folders/model'
import type { ConnectionProfile } from '../types'
import { describeUnsupported, isFlexColumn, locateHost, locateRows, type HostRefs } from './locate'
import { assignOrder, resetOrder, type OrderedItem } from './order'
import {
  CF_LIST_ANCHOR_CLASS,
  FOLDER_ATTR,
  createFolderHeader,
  folderOfHeader,
  updateFolderHeader,
  type FolderHeaderOptions,
} from './headers'
import { createReconciler, type ReconcileHandle } from './reconcile'

export interface ControllerDeps {
  /** Ordered exactly as the host rendered its rows (ConnectionManager.tsx). */
  profiles: ConnectionProfile[]
  /** Persisted folder names, merged with names found on profiles. */
  folderNames: string[]
  onRenameFolder: (folder: string) => void
  onDeleteFolder: (folder: string) => void
  /** Injected by the entry point; see `src/ui/*`. */
  render: (
    groups: FolderGroup<ConnectionProfile>[],
    collapsed: Set<string>,
  ) => FolderHeaderOptions[]
}

export class FolderController {
  private host: HostRefs | null = null
  private reconciler: ReconcileHandle | null = null
  private collapsedFolders = new Set<string>()
  private readonly profiles: { current: ConnectionProfile[] }
  private readonly folderNames: { current: string[] }
  private reconcileScheduled = false

  /** Reason `mount()` returned false, when there is one. */
  unsupportedReason: string | null = null

  constructor(private readonly deps: ControllerDeps) {
    this.profiles = { current: deps.profiles ?? [] }
    this.folderNames = { current: deps.folderNames ?? [] }
  }

  /**
   * Locate the host, probe it, and start reconciling.
   *
   * Returns false when the host is missing or its layout is unsupported, having
   * left the DOM untouched — a self-disable is always quieter than a corrupted
   * host layout.
   */
  mount(): boolean {
    if (this.host) return true

    const host = locateHost()
    if (!host) {
      // Reason is available to the entry point for its banner; not an error
      // here because Lumiverse may simply not have mounted the tab yet.
      this.unsupportedReason = describeUnsupported()
      return false
    }
    if (!isFlexColumn(host.list)) {
      this.unsupportedReason = describeUnsupported() ?? 'Unsupported connection list layout'
      return false
    }

    this.host = host
    // Marker class with zero styling declarations, ensuring host list layout
    // is never corrupted by .cf-root styles.
    host.list.classList.add(CF_LIST_ANCHOR_CLASS)

    this.reconcile()

    this.reconciler = createReconciler({
      list: host.list,
      schedule: () => this.requestReconcile(),
    })

    return true
  }

  /** Remove every header, clear our class and inline overrides, stop watching. */
  dispose(): void {
    this.reconciler?.dispose()
    this.reconciler = null
    const host = this.host
    if (host) {
      for (const child of Array.from(host.list.children)) {
        const el = child as HTMLElement
        if (el.getAttribute(FOLDER_ATTR) !== null) el.remove()
      }
      resetOrder(locateRows(host.list))
      host.list.classList.remove(CF_LIST_ANCHOR_CLASS)
    }
    this.host = null
  }

  /** Replace the ordered profile list (the host's `orderedProfiles`). */
  setProfiles(profiles: ConnectionProfile[]): void {
    this.profiles.current = profiles ?? []
    this.requestReconcile()
  }

  /** Replace the persisted folder names. */
  setFolderNames(names: string[]): void {
    this.folderNames.current = names ?? []
    this.requestReconcile()
  }

  isCollapsed(folder: string): boolean {
    return this.collapsedFolders.has(folder)
  }

  toggleCollapsed(folder: string): void {
    if (this.collapsedFolders.has(folder)) this.collapsedFolders.delete(folder)
    else this.collapsedFolders.add(folder)
    this.reconcile()
  }

  /**
   * Coalesce: `schedule` is a no-op while a reconcile is already pending, so a
   * reconcile triggered by our own DOM writes cannot loop.
   */
  private requestReconcile(): void {
    if (this.reconcileScheduled || !this.host) return
    this.reconcileScheduled = true
    const run = (): void => {
      this.reconcileScheduled = false
      if (this.host) this.reconcile()
    }
    if (typeof queueMicrotask === 'function') queueMicrotask(run)
    else void Promise.resolve().then(run)
  }

  /**
   * Re-read the DOM and re-apply ordering. Idempotent: running it twice with no
   * intervening host mutation must produce the same attributes.
   */
  private reconcile(): void {
    const host = this.host
    if (!host) return

    const rows = locateRows(host.list)
    const groups = includeEmptyFolders(
      groupProfilesByFolder(this.profiles.current),
      this.folderNames.current,
      this.profiles.current,
    )

    // Drop headers for folders that no longer exist.
    const wanted = new Set(groups.map((group) => group.folder))
    const existing = new Map<string, HTMLElement>()
    for (const child of Array.from(host.list.children)) {
      const el = child as HTMLElement
      if (el.getAttribute(FOLDER_ATTR) === null) continue
      const folder = folderOfHeader(el)
      if (folder === null || !wanted.has(folder) || existing.has(folder)) {
        el.remove()
        continue
      }
      existing.set(folder, el)
    }

    const optionsByFolder = new Map<string, FolderHeaderOptions>()
    for (const options of this.deps.render(groups, this.collapsedFolders)) {
      optionsByFolder.set(options.folder, options)
    }

    // Rows are consumed in group order: groups are sorted, and each group's
    // profiles keep the host's relative order, so a running cursor over `rows`
    // reproduces the host's own ordering exactly.
    const flattened: OrderedItem[] = []
    let cursor = 0

    for (const group of groups) {
      const options = optionsByFolder.get(group.folder)
      if (options) {
        let header = existing.get(group.folder)
        if (!header) {
          header = createFolderHeader(options)
        } else {
          updateFolderHeader(header, {
            collapsed: options.collapsed,
            count: options.count,
            label: options.label,
          })
        }
        header.setAttribute(FOLDER_ATTR, group.folder)
        // Insert as a direct child; DOM position is irrelevant because `order`
        // decides the visual sequence, but appending keeps React's own
        // reconciliation of the rows unobstructed.
        host.list.appendChild(header)
        flattened.push({ el: header, collapsed: false })
        existing.delete(group.folder)
      }

      const collapsed = this.collapsedFolders.has(group.folder)
      for (const _profile of group.profiles) {
        const row = rows[cursor]
        cursor += 1
        if (row) flattened.push({ el: row, collapsed })
      }
    }

    // Any header we created but did not place (a `render` that omits a group)
    // must not linger.
    for (const leftover of existing.values()) leftover.remove()

    // Rows with no group (React added one we have no profile for) still need a
    // slot so they are not left with a stale order from a previous pass.
    for (let i = cursor; i < rows.length; i += 1) {
      flattened.push({ el: rows[i], collapsed: false })
    }

    assignOrder(flattened)
  }
}
