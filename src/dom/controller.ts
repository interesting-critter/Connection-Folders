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
import { UNCATEGORIZED_KEY } from '../folders/model'

function collapseKey(folder: string): string {
  return folder || UNCATEGORIZED_KEY
}

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
    this.deps.profiles = this.profiles.current
    this.requestReconcile()
  }

  /** Replace the persisted folder names. */
  setFolderNames(names: string[]): void {
    this.folderNames.current = names ?? []
    this.requestReconcile()
  }

  isCollapsed(folder: string): boolean {
    return this.collapsedFolders.has(collapseKey(folder))
  }

  toggleCollapsed(folder: string): void {
    const key = collapseKey(folder)
    if (this.collapsedFolders.has(key)) this.collapsedFolders.delete(key)
    else this.collapsedFolders.add(key)
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

    // Derive folder for each native row by index alignment with the ordered
    // profile array. This avoids any divergence when a new profile is created
    // and the native list puts it at a different visual position than our
    // ordered array (e.g. native prepends new profiles, our order appends them).
    const rowFolders: string[] = []
    for (let i = 0; i < rows.length; i += 1) {
      const profile = i < this.profiles.current.length ? this.profiles.current[i] : null
      rowFolders[i] = profile ? getProfileFolder(profile) : ''
    }

    // Build groups directly from native rows, preserving the host's relative row
    // order: alphabetical folder sort, but each folder's members keep their
    // original native sequence (not the profile array sequence).
    const folderOrder: string[] = []
    const folderRows: Map<string, number[]> = new Map()
    const folderLabels: Map<string, string> = new Map()

    for (let i = 0; i < rows.length; i += 1) {
      const folder = rowFolders[i] || ''
      const key = collapseKey(folder)
      const label = folder || 'Uncategorized'
      if (!folderLabels.has(key)) {
        folderLabels.set(key, label)
        folderOrder.push(key)
      }
      if (!folderRows.has(key)) folderRows.set(key, [])
      folderRows.get(key)!.push(i)
    }

    // Sort folder keys alphabetically by label (matching native folder order),
    // with Uncategorized last.
    folderOrder.sort((a, b) => {
      const labelA = folderLabels.get(a) ?? ''
      const labelB = folderLabels.get(b) ?? ''
      const aUncat = a === UNCATEGORIZED_KEY
      const bUncat = b === UNCATEGORIZED_KEY
      if (aUncat && !bUncat) return 1
      if (!aUncat && bUncat) return -1
      return (labelA || '').localeCompare(labelB || '')
    })

    const groups: FolderGroup<ConnectionProfile>[] = []
    for (const key of folderOrder) {
      const label = folderLabels.get(key) ?? ''
      const folderName = key === UNCATEGORIZED_KEY ? '' : label
      const profileIdsInRowOrder: string[] = []
      for (const rowIndex of (folderRows.get(key) ?? [])) {
        const profile = rowIndex < this.profiles.current.length ? this.profiles.current[rowIndex] : null
        if (profile) profileIdsInRowOrder.push(profile.id)
      }
      // Resolve profiles for this group by matching ids back to the ordered array.
      const byId = new Map<string, ConnectionProfile>()
      for (const p of this.profiles.current) byId.set(p.id, p)
      const groupProfiles: ConnectionProfile[] = []
      for (const id of profileIdsInRowOrder) {
        const p = byId.get(id)
        if (p) groupProfiles.push(p)
      }
      groups.push({ folder: folderName, profiles: groupProfiles })
    }

    // Drop headers for folders that no longer exist.
    const wanted = new Set(groups.map((g) => collapseKey(g.folder)))
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

    // Build the flattened [header, row, ...] sequence using native row order.
    const flattened: OrderedItem[] = []
    for (const key of folderOrder) {
      const group = groups.find((g) => collapseKey(g.folder) === key)
      if (!group) continue
      const options = optionsByFolder.get(group.folder)
      if (options) {
        let header = existing.get(key)
        if (!header) {
          header = createFolderHeader(options)
        } else {
          updateFolderHeader(header, {
            collapsed: options.collapsed,
            count: options.count,
            label: options.label,
          })
        }
        header.setAttribute(FOLDER_ATTR, key === UNCATEGORIZED_KEY ? '' : group.folder)
        host.list.appendChild(header)
        flattened.push({ el: header, collapsed: false })
        existing.delete(key)
      }

      const collapsed = this.collapsedFolders.has(key)
      const rowIndices = folderRows.get(key) ?? []
      for (const rowIndex of rowIndices) {
        if (rowIndex < rows.length) {
          flattened.push({ el: rows[rowIndex], collapsed })
        }
      }
    }

    // Any leftover header not placed must not linger.
    for (const leftover of existing.values()) leftover.remove()

    // Any native row not covered by any folder group needs a slot.
    const coveredRowIndices = new Set<number>()
    for (const key of folderOrder) {
      const indices = folderRows.get(key) ?? []
      for (const idx of indices) coveredRowIndices.add(idx)
    }
    for (let i = 0; i < rows.length; i += 1) {
      if (!coveredRowIndices.has(i)) {
        flattened.push({ el: rows[i], collapsed: false })
      }
    }

    assignOrder(flattened)
  }
}
