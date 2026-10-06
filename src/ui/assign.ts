/**
 * Per-profile folder assignment.
 *
 * This module does NOT hand-roll a folder picker. It opens a host-themed modal
 * and mounts Lumiverse's REAL folder dropdown (`ctx.components
 * .mountFolderDropdown`) into the modal body, so the extension cannot drift from
 * the native picker in look, keyboard handling or accessibility — the same
 * reason `ctx.ui.showModal` is used instead of a bespoke overlay.
 *
 * The modal root counts as extension-owned DOM, which is what
 * `mountFolderDropdown` requires for its target.
 */

import type { SpindleFrontendContext, SpindleFolderDropdownHandle } from 'lumiverse-spindle-types'
import type { ConnectionProfile } from '../types'
import { getProfileFolder } from '../folders/model'

export interface FolderAssignParams {
  profile: ConnectionProfile
  folders: readonly string[]
  /** Register a new folder name; returns the resulting list. */
  onCreateFolder: (name: string) => Promise<string[]>
  /** Persist the assignment. `''` removes it. */
  onAssign: (folder: string) => Promise<void>
}

/** Matches FolderDropdown's own placeholder so the two never read differently. */
const NO_FOLDER_PLACEHOLDER = 'No folder'

/**
 * Styles for the assign modal only. Scoped under `.cf-root` like every other
 * block in `styles.ts`, so this sheet can never leak into Lumiverse's own UI
 * (the host renders the modal chrome itself and we only own the body).
 *
 * Colours are `var(--lumiverse-*)` tokens — never literals.
 */
export const ASSIGN_STYLES: string = `
.cf-root .cf-folder-assign-target {
  min-width: 0;
}

.cf-root .cf-assign-error {
  margin: 0;
  color: var(--lumiverse-danger, #ff5c7a);
}
`

/**
 * Open the folder picker for one profile. The modal dismisses itself once the
 * assignment has been persisted.
 *
 * Failure policy: a rejected `onAssign` or `onCreateFolder` shows an inline
 * error and LEAVES the modal open. Closing on failure would silently discard
 * the user's choice and leave them staring at a row whose folder did not
 * change.
 */
export async function openFolderAssignModal(
  ctx: SpindleFrontendContext,
  params: FolderAssignParams,
): Promise<void> {
  const { profile, folders, onCreateFolder, onAssign } = params

  const modal = ctx.ui.showModal({
    // Matches the native edit form's "Field — <name>" title idiom.
    title: `Folder — ${profile.name}`,
    width: 380,
    maxHeight: 1280,
  })

  const root = document.createElement('div')
  root.className = 'cf-root'
  root.style.display = 'flex'
  root.style.gap = '8px'

  // Symmetrical 420px-tall placeholder bars at each far edge of the modal body.
  const leftBar = document.createElement('div')
  leftBar.style.width = '12px'
  leftBar.style.height = '420px'
  leftBar.style.background = '#000'
  leftBar.style.flexShrink = '0'
  root.appendChild(leftBar)

  const content = document.createElement('div')
  content.style.flex = '1'
  root.appendChild(content)

  const rightBar = document.createElement('div')
  rightBar.style.width = '12px'
  rightBar.style.height = '420px'
  rightBar.style.background = '#000'
  rightBar.style.flexShrink = '0'
  root.appendChild(rightBar)

  modal.root.appendChild(root)

  const currentFolder = getProfileFolder(profile)

  const hint = document.createElement('p')
  hint.className = 'cf-unsupported-banner-body'
  hint.textContent = currentFolder
    ? `Currently in “${currentFolder}”. Pick another folder, or create a new one.`
    : 'This profile has no folder. Pick one, or create a new one.'
  content.appendChild(hint)

  const target = document.createElement('div')
  target.className = 'cf-folder-assign-target'
  content.appendChild(target)

  const error = document.createElement('p')
  error.className = 'cf-unsupported-banner-body cf-assign-error'
  error.setAttribute('role', 'status')
  error.hidden = true
  content.appendChild(error)

  function showError(cause: unknown): void {
    error.hidden = false
    error.textContent =
      cause instanceof Error && cause.message ? cause.message : 'That folder could not be saved.'
  }

  let destroyed = false
  function destroyDropdown(): void {
    if (destroyed) return
    destroyed = true
    try {
      dropdown.destroy()
    } catch {
      // The host may have unmounted the React tree already; never let teardown
      // block the modal from closing.
    }
  }

  let closed = false
  function close(): void {
    if (closed) return
    closed = true
    destroyDropdown()
    modal.dismiss()
  }

  /**
   * The native dropdown fires `onCreateFolder` and then immediately `onChange`
   * for the SAME name (FolderDropdown.tsx `handleConfirmCreate`). Stashing the
   * promise lets the assignment wait for the name to actually be registered,
   * instead of writing metadata for a folder that does not exist yet.
   */
  let pendingCreate: Promise<string[]> | null = null

  const dropdown: SpindleFolderDropdownHandle = ctx.components.mountFolderDropdown(target, {
    folders: [...folders],
    value: currentFolder,
    placeholder: NO_FOLDER_PLACEHOLDER,
    onChange: (folder) => {
      void handleSelect(folder)
    },
    onCreateFolder: (name) => {
      // The list update is a side effect of a SUCCESSFUL registration, so the
      // chain must resolve with the folder-name list, not the update's `void` —
      // that list is what `pendingCreate` promises to `handleSelect` below.
      // (Returning the update's `void` instead would narrow the promise to
      // `Promise<void>`, and `pendingCreate` is deliberately awaited for the
      // REGISTRATION, not for a re-render.)
      //
      // The chain is returned to the host so it can claim the rejection and
      // observe the failure; discarding it here would turn the rethrow below
      // into an unhandled rejection.
      return (pendingCreate = onCreateFolder(name))
        .then((next) => {
          dropdown.update({ folders: next })
          return next
        })
        .catch((cause: unknown) => {
          pendingCreate = null
          showError(cause)
          throw cause
        })
    },
  })

  async function handleSelect(folder: string): Promise<void> {
    const create = pendingCreate
    pendingCreate = null
    if (create) {
      try {
        await create
      } catch {
        return // `showError` already ran in the rejection handler above.
      }
    }

    try {
      await onAssign(folder)
      close()
    } catch (cause) {
      showError(cause)
    }
  }

  // A backdrop click or the host's close button must not leak the mounted React
  // tree. `close()` is idempotent, so this cannot double-teardown.
  modal.onDismiss(() => {
    closed = true
    destroyDropdown()
  })
}
