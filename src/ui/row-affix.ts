/**
 * Per-row "assign folder" button injection.
 *
 * Lumiverse owns the Connections list: it renders `<ConnectionItem>` rows from
 * `orderedProfiles` and we may not reorder or wrap them. All we can do is push
 * one small control INTO each row, so the row-to-profile mapping problem has to
 * be solved structurally:
 *
 *  - The row root carries no profile id (see `dom/locate.ts`), so mapping is
 *    POSITIONAL. `rows()` returns direct children in DOM order, which is 1:1
 *    with the host's ordered profile list — `profileForIndex(index)` resolves it.
 *  - A row being edited contains a SECOND `[data-component="ConnectionItem"]`
 *    wrapper. We never re-query the list ourselves: we only ever search INSIDE
 *    a row root we were handed, so that nested wrapper can never be mistaken
 *    for a row and no duplicate button is injected.
 *
 * Placement matters for correctness, not just looks. The row's `<button
 * class="…itemBtn">` (ConnectionItem.tsx line 316) is the profile SELECTOR:
 * `onSelect` lives on it, so a button nested inside it would both fail the
 * accessible-name contract and select the profile on every folder click. The
 * safe host is the sibling `.itemActions` container (line 348) which already
 * hosts the edit / overflow controls. Since Lumiverse compiles CSS modules we
 * match the hashed class by SUBSTRING (`[class*="itemActions"]`), which also
 * matches the plain `.itemActions` used in our own fixtures.
 *
 * Idempotence is required: `sync()` runs on every mutation burst, so a naive
 * `appendChild` would stack buttons. Instead every button is stamped with
 * `data-cf-assign="<profileId>"` and re-used; a stamp that no longer matches
 * the row's profile means the rows were reordered, so the stale button is
 * dropped and rebuilt (its click closure captured the old profile).
 *
 * Every DOM write is guarded: rows can be torn out of the document by React
 * between the moment `rows()` resolves and the moment we write.
 */

import { createRowFolderButton } from './actions'
import type { ConnectionProfile } from '../types'

/** Attribute marking our injected button AND carrying its profile id. */
export const ASSIGN_ATTR = 'data-cf-assign'

/** Re-use probe: the FIRST assign button inside a given row. */
const ASSIGN_BUTTON_SELECTOR = `button[${ASSIGN_ATTR}]`

/** Sweep probe: any element carrying the stamp (whatever it turned out to be). */
const ASSIGN_ANY_SELECTOR = `[${ASSIGN_ATTR}]`

/**
 * The row's action container, matched by substring so it survives CSS-module
 * hashing (`itemActions_1a2b3c`) as well as our unhashed fixtures.
 */
const ACTIONS_SELECTOR = '[class*="itemActions"]'

/** Title suffix format, mirroring `createRowFolderButton`'s own state text. */
function stateText(folder: string): string {
  return folder ? `Folder: ${folder}` : 'No folder set'
}

/**
 * Every button we injected, across all managers in this module instance.
 *
 * Module-level on purpose: a manager may be disposed after React has already
 * replaced every row (so it can no longer enumerate what it owns), and a
 * leftover button in the host UI is a permanent artefact. `dispose()` drains
 * this set.
 */
const injected = new Set<HTMLButtonElement>()

/**
 * The assign button currently inside `row`, or null.
 *
 * Scoped to the single row root that was handed to us — never to the list — so
 * the nested editing wrapper can neither contribute a button nor hide one.
 */
export function findAssignButton(row: HTMLElement): HTMLButtonElement | null {
  if (!row || typeof row.querySelector !== 'function') return null
  try {
    const found = row.querySelector(ASSIGN_BUTTON_SELECTOR)
    if (found && found.tagName === 'BUTTON') return found as HTMLButtonElement
    return null
  } catch {
    return null
  }
}

/**
 * Where inside `row` a new button may safely be appended.
 *
 * Prefers the native `.itemActions` container (a sibling of the select button,
 * so dnd-kit and `onSelect` are untouched) and returns the row root itself as a
 * last resort — still outside `itemBtn`, which is all that is strictly
 * required. Returns null only when there is nowhere to write.
 */
function safeHost(row: HTMLElement): HTMLElement | null {
  try {
    if (typeof row.querySelector === 'function') {
      const actions = row.querySelector(ACTIONS_SELECTOR)
      if (actions) return actions as HTMLElement
    }
    if (typeof row.appendChild === 'function') return row
    return null
  } catch {
    return null
  }
}

export interface RowAffixOptions {
  /** The host list container to observe. */
  list: HTMLElement
  /** Current native row roots, in DOM order. Called fresh on every sync. */
  rows: () => HTMLElement[]
  /** Map a row's index to its profile. Return undefined when unmappable. */
  profileForIndex: (index: number) => ConnectionProfile | undefined
  /** Current folder name for a profile; `''` means uncategorized. */
  currentFolder: (profile: ConnectionProfile) => string
  /** Called when the user activates the button on a row. */
  onAssign: (profile: ConnectionProfile) => void
  /** Accessible label builder, e.g. `Move "My Profile" to a folder`. */
  labelFor: (profile: ConnectionProfile, folder: string) => string
}

/**
 * Keeps exactly one assign button per mappable row, in sync with the profile
 * list and the folder assignments.
 *
 * One manager owns one list. `sync()` is cheap and idempotent, so it can be
 * called from a reconcile scheduler without any diffing of its own.
 */
export class RowAffixManager {
  private readonly options: RowAffixOptions

  constructor(options: RowAffixOptions) {
    this.options = options
  }

  /**
   * Reconcile every row against the current profile list.
   *
   * Never throws: a row that vanished mid-walk, a `profileForIndex` that blows
   * up, a read-only host — all degrade to "leave this row alone".
   */
  sync(): void {
    const { rows, profileForIndex, currentFolder, onAssign, labelFor } = this.options

    let rowList: HTMLElement[]
    try {
      rowList = rows()
    } catch {
      return
    }
    if (!rowList || typeof rowList.length !== 'number') return

    /** Buttons that survived this pass; anything else is an orphan. */
    const kept = new Set<HTMLButtonElement>()

    for (let index = 0; index < rowList.length; index += 1) {
      const row = rowList[index]
      if (!row || typeof row.querySelector !== 'function') continue
      // React can unmount a row between the moment `rows()` resolved and the
      // moment we get here. Such a row is no longer a child of the list we
      // were told to decorate, so writing into it would only litter a detached
      // subtree — skip it, and let `sweepOrphans` forget its old button.
      if (!this.isLive(row)) continue

      let profile: ConnectionProfile | undefined
      try {
        profile = profileForIndex(index)
      } catch {
        continue
      }

      // Unmappable row (profile deleted / list shrank): leave nothing behind.
      if (!profile || typeof profile.id !== 'string') {
        this.clearRow(row)
        continue
      }

      const button = this.ensureButton(row, profile, () => {
        onAssign(profile as ConnectionProfile)
      })
      if (!button) continue

      kept.add(button)
      this.refreshLabel(button, profile, currentFolder, labelFor)
    }

    this.sweepOrphans(kept)
  }

  /**
   * Remove every button this module injected, across every manager, and reset
   * the tracking set. Safe to call twice.
   */
  dispose(): void {
    for (const button of [...injected]) {
      removeButton(button)
    }
    injected.clear()
  }

  /**
   * Is `row` still a child of the observed list?
   *
   * Containment — not `isConnected` — is the right test: a host list that is
   * itself detached (a portal, a fragment, a test fixture) still has perfectly
   * live rows, and those must still be decorated.
   */
  private isLive(row: HTMLElement): boolean {
    const { list } = this.options
    try {
      if (list && typeof list.contains === 'function') return list.contains(row)
    } catch {
      // Fall through to the weaker probe.
    }
    try {
      return row.isConnected !== false
    } catch {
      return true
    }
  }

  /**
   * Guarantee exactly one button for `profile` on `row`, rebuilding it if the
   * existing stamp belongs to a different profile (its click handler closes
   * over that older profile).
   */
  private ensureButton(
    row: HTMLElement,
    profile: ConnectionProfile,
    onClick: () => void,
  ): HTMLButtonElement | null {
    const existing = findAssignButton(row)
    if (existing) {
      if (existing.getAttribute(ASSIGN_ATTR) === profile.id) return existing
      // Row was reordered under us: the stale button's handler targets the
      // wrong profile and cannot be re-pointed (the factory closes over it).
      removeButton(existing)
    }

    const host = safeHost(row)
    if (!host) return null

    let button: HTMLButtonElement
    try {
      const folder = safeFolder(this.options.currentFolder, profile)
      button = createRowFolderButton({
        onClick,
        currentFolder: folder,
        label: safeLabel(this.options.labelFor, profile, folder),
        profileId: profile.id,
      })
      if (host === row) {
        // No native action container (a row mid-edit): append last so it sits
        // after the row body rather than before it.
        host.appendChild(button)
      } else {
        // First slot in the native action group: our control reads as part of
        // the row's own affordances rather than as trailing chrome.
        host.insertBefore(button, host.firstChild)
      }
    } catch {
      return null
    }

    injected.add(button)
    return button
  }

  /**
   * Refresh `data-cf-assign` plus `aria-label`/`title` from the CURRENT
   * assignment, every sync — so a rename or a move can never leave a stale
   * accessible name behind.
   */
  private refreshLabel(
    button: HTMLButtonElement,
    profile: ConnectionProfile,
    currentFolder: (profile: ConnectionProfile) => string,
    labelFor: (profile: ConnectionProfile, folder: string) => string,
  ): void {
    const folder = safeFolder(currentFolder, profile)
    const label = safeLabel(labelFor, profile, folder)
    try {
      button.setAttribute(ASSIGN_ATTR, profile.id)
      button.setAttribute('aria-label', label)
      button.title = `${label} — ${stateText(folder)}`
    } catch {
      // Detached or torn-down row: nothing to keep in sync.
    }
  }

  /** Drop our button from a row we can no longer map to a profile. */
  private clearRow(row: HTMLElement): void {
    let nodes: NodeListOf<Element>
    try {
      nodes = row.querySelectorAll(ASSIGN_ANY_SELECTOR)
    } catch {
      return
    }
    for (const node of [...nodes]) {
      const button = node as HTMLButtonElement
      injected.delete(button)
      try {
        node.parentElement?.removeChild(node)
      } catch {
        // Already gone.
      }
    }
  }

  /**
   * Forget buttons that were not claimed by this pass: rows React has since
   * unmounted, or rows the positional mapping shifted away from.
   */
  private sweepOrphans(kept: Set<HTMLButtonElement>): void {
    for (const button of [...injected]) {
      if (kept.has(button)) continue
      injected.delete(button)
      // Detached rows need no DOM write — their nodes go with them.
      if (button.isConnected) removeButton(button)
    }
  }
}

/** Unlink a button and forget it. Never throws. */
function removeButton(button: HTMLButtonElement): void {
  try {
    button.parentElement?.removeChild(button)
  } catch {
    // Already detached.
  }
}

/** `currentFolder` may throw or return junk; normalise to `''`. */
function safeFolder(
  currentFolder: (profile: ConnectionProfile) => string,
  profile: ConnectionProfile,
): string {
  try {
    const value = currentFolder(profile)
    return typeof value === 'string' ? value : ''
  } catch {
    return ''
  }
}

/** `labelFor` may throw or return junk; an empty label is still better than none. */
function safeLabel(
  labelFor: (profile: ConnectionProfile, folder: string) => string,
  profile: ConnectionProfile,
  folder: string,
): string {
  try {
    const value = labelFor(profile, folder)
    return typeof value === 'string' ? value : ''
  } catch {
    return ''
  }
}
