/**
 * Folder-NAME management: create, rename, delete.
 *
 * Every flow opens a HOST dialog (`ctx.ui.showModal` / `ctx.ui.showConfirm`)
 * rather than building an overlay, so the dialogs inherit the user's theme,
 * focus trapping, Escape handling and backdrop behaviour for free. The only
 * chrome we own is a text input and two buttons inside the modal body.
 *
 * Validation mirrors Lumiverse's own rules. Two names are RESERVED because both
 * collide with the synthetic Uncategorized bucket that the grouped selectors
 * render: `uncategorized`, the bucket's visible label (FolderDropdown.tsx lines
 * 71-81 refuses it for exactly this reason), and `__uncategorized`, the
 * storable collapse-state sentinel (`folders/model.ts` exports it as
 * `UNCATEGORIZED_KEY`, and Lumiverse's own PersonaManager.tsx line 455 uses the
 * same string). Allowing either would make a user folder indistinguishable from
 * the bucket that means "no folder" — the second one would additionally make
 * the folder's collapse state collide with the bucket's, so the two would
 * appear to collapse and expand in lockstep.
 */

import type { SpindleFrontendContext } from 'lumiverse-spindle-types'

/**
 * Hard cap on a folder name. Matches the effective ceiling of Lumiverse's own
 * inline rename input and keeps a name inside a drawer row without truncating.
 */
export const MAX_FOLDER_NAME_LENGTH = 64

/**
 * Names no user folder may take. Compared trimmed and case-folded, so
 * `Uncategorized`, `  UNCATEGORIZED  ` and `__Uncategorized` are all refused.
 */
const RESERVED_NAMES: readonly string[] = ['uncategorized', '__uncategorized']

/**
 * Validate a candidate folder name against the existing list.
 *
 * @param raw            the raw input value (trimmed here)
 * @param existing       every folder name currently known
 * @param ignore         a name to exclude from the duplicate check — the folder
 *                       being renamed, so renaming to itself is not a duplicate
 * @returns an error message, or `null` when the name is acceptable
 */
export function validateFolderName(
  raw: string,
  existing: readonly string[],
  ignore: string | null = null,
): string | null {
  const name = raw.trim()

  if (!name) return 'Enter a folder name.'
  if (RESERVED_NAMES.includes(name.toLowerCase())) {
    return 'That name is reserved — profiles with no folder already live in “Uncategorized”.'
  }
  if (name.length > MAX_FOLDER_NAME_LENGTH) {
    return `Keep folder names under ${MAX_FOLDER_NAME_LENGTH} characters.`
  }

  const taken = ignore === null ? existing : existing.filter((folder) => folder !== ignore)
  if (taken.includes(name)) return `A folder named “${name}” already exists.`

  return null
}

/** Message shown when a create/rename/delete write is rejected by the host. */
function describeWriteFailure(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

/** Monotonic ids so two stacked dialogs never collide on `for` / `aria-describedby`. */
let dialogSeq = 0

interface PromptNameParams {
  title: string
  /** Visible label above the input. */
  label: string
  confirmLabel: string
  initialValue: string
  existing: readonly string[]
  /** Excluded from the duplicate check (rename source). */
  ignore: string | null
  /** Placeholder for the input. */
  placeholder: string
  /** Called only after validation passes. Resolve to commit, reject to report. */
  onSubmit: (name: string) => Promise<unknown>
}

/**
 * Shared shell for the create and rename dialogs: a labelled text input, live
 * validation, Enter to confirm, Escape to cancel.
 *
 * Resolves with the trimmed name, or `null` for ANY dismissal path — Cancel,
 * Escape, the host's close button, or a backdrop click — so a caller can treat
 * `null` as "nothing happened" without tracking which gesture ended it.
 */
function promptForName(ctx: SpindleFrontendContext, params: PromptNameParams): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    const modal = ctx.ui.showModal({ title: params.title, width: 360, maxHeight: 320 })
    const inputId = `cf-folder-input-${++dialogSeq}`
    const errorId = `cf-folder-error-${dialogSeq}`

    const form = document.createElement('div')
    form.className = 'cf-root cf-folder-form'
    modal.root.appendChild(form)

    const label = document.createElement('label')
    label.className = 'cf-folder-form-label'
    label.htmlFor = inputId
    label.textContent = params.label
    form.appendChild(label)

    const input = document.createElement('input')
    input.className = 'cf-folder-rename-input'
    input.id = inputId
    input.type = 'text'
    input.maxLength = MAX_FOLDER_NAME_LENGTH
    input.value = params.initialValue
    input.placeholder = params.placeholder
    input.autocomplete = 'off'
    input.spellcheck = false
    input.setAttribute('aria-describedby', errorId)
    form.appendChild(input)

    const error = document.createElement('p')
    error.className = 'cf-folder-form-error'
    error.id = errorId
    error.setAttribute('role', 'alert')
    error.hidden = true
    form.appendChild(error)

    const actions = document.createElement('div')
    actions.className = 'cf-folder-form-actions'
    form.appendChild(actions)

    const cancelButton = document.createElement('button')
    cancelButton.type = 'button'
    cancelButton.className = 'cf-folder-btn'
    cancelButton.textContent = 'Cancel'
    actions.appendChild(cancelButton)

    const confirmButton = document.createElement('button')
    confirmButton.type = 'button'
    confirmButton.className = 'cf-folder-btn cf-folder-btn-primary'
    confirmButton.textContent = params.confirmLabel
    actions.appendChild(confirmButton)

    function setError(message: string | null): void {
      if (message) {
        error.textContent = message
        error.hidden = false
      } else {
        error.textContent = ''
        error.hidden = true
      }
    }

    /** Re-render validation for the current input. Returns the message, if any. */
    function validate(): string | null {
      const message = validateFolderName(input.value, params.existing, params.ignore)
      setError(message)
      return message
    }

    let busy = false
    let settled = false

    function finish(result: string | null): void {
      if (settled) return
      settled = true
      input.removeEventListener('input', onInput)
      input.removeEventListener('keydown', onKeyDown)
      // ORDERING CONSTRAINT — resolve BEFORE dismiss. The host notifies
      // `onDismiss` handlers SYNCHRONOUSLY from inside `dismiss()`
      // (frontend/src/lib/spindle/loader.ts ~1800-1810), and the handler below
      // resolves `null`. A promise keeps only its FIRST settlement, so calling
      // `dismiss()` first would make every CONFIRM path resolve `null` and the
      // dialogs could never report the committed name. Do not "tidy" these two
      // lines into the other order.
      resolve(result)
      modal.dismiss()
    }

    async function submit(): Promise<void> {
      if (busy || settled) return
      const name = input.value.trim()
      if (validate()) return

      busy = true
      confirmButton.disabled = true
      setError(null)
      try {
        await params.onSubmit(name)
        finish(name)
      } catch (cause) {
        // Stay open with the typed value intact so the user can retry.
        busy = false
        confirmButton.disabled = false
        setError(describeWriteFailure(cause, 'The folder could not be saved.'))
      }
    }

    function onInput(): void {
      if (busy) return
      // A corrected field must not leave the confirm button latched off.
      validate()
      confirmButton.disabled = false
    }

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Enter') {
        event.preventDefault()
        void submit()
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        finish(null)
      }
    }

    input.addEventListener('input', onInput)
    input.addEventListener('keydown', onKeyDown)
    cancelButton.addEventListener('click', () => finish(null))
    confirmButton.addEventListener('click', () => void submit())

    // Backdrop click / host close button resolve `null` too. When this fires
    // RE-ENTRANTLY from inside `finish()`'s `modal.dismiss()`, `settled` is
    // already true and the promise already holds the committed name, so bailing
    // here keeps the confirmation from being overwritten by `null`.
    modal.onDismiss(() => {
      if (settled) return
      settled = true
      input.removeEventListener('input', onInput)
      input.removeEventListener('keydown', onKeyDown)
      resolve(null)
    })

    validate()
    input.focus()
    if (params.initialValue) input.select()
  })
}

/**
 * Ask for a new folder name. Returns the trimmed name, or `null` if cancelled.
 */
export async function promptCreateFolder(
  ctx: SpindleFrontendContext,
  params: {
    folders: readonly string[]
    onCreate: (name: string) => Promise<string[]>
  },
): Promise<string | null> {
  return promptForName(ctx, {
    title: 'New Folder',
    label: 'Folder name',
    confirmLabel: 'Create',
    initialValue: '',
    existing: params.folders,
    ignore: null,
    placeholder: 'Folder name',
    onSubmit: params.onCreate,
  })
}

/**
 * Ask for a replacement name for an existing folder. Returns the new name, or
 * `null` if cancelled.
 *
 * The source name is excluded from the duplicate check, so a no-op rename is
 * accepted as "no change" rather than reported as a conflict.
 */
export async function promptRenameFolder(
  ctx: SpindleFrontendContext,
  params: {
    folder: string
    folders: readonly string[]
    onRename: (oldName: string, newName: string) => Promise<string[]>
  },
): Promise<string | null> {
  return promptForName(ctx, {
    title: `Rename Folder — ${params.folder}`,
    label: 'Folder name',
    confirmLabel: 'Rename',
    initialValue: params.folder,
    existing: params.folders,
    ignore: params.folder,
    placeholder: 'Folder name',
    onSubmit: (name) => params.onRename(params.folder, name),
  })
}

/**
 * Confirm deletion of a folder name.
 *
 * The profiles inside are NOT deleted — their assignment is simply dropped, so
 * they fall back into the synthetic Uncategorized bucket. The message says so
 * with the real count, because a folder that silently swallows its profiles
 * reads as data loss.
 *
 * Returns `false` both for "user cancelled" and for "the write was rejected";
 * the caller re-reads its store either way, so the two are indistinguishable
 * from the UI's point of view and neither should leave the row optimistically
 * removed.
 */
export async function confirmDeleteFolder(
  ctx: SpindleFrontendContext,
  params: {
    folder: string
    /** How many profiles currently reference the folder. */
    count: number
    onDelete: (folder: string) => Promise<string[]>
  },
): Promise<boolean> {
  const { folder, count } = params
  const noun = count === 1 ? 'profile' : 'profiles'

  const { confirmed } = await ctx.ui.showConfirm({
    title: `Delete “${folder}”?`,
    message:
      `The folder “${folder}” will be removed. ` +
      `${count} ${noun} in it will move to Uncategorized — the connections themselves are not deleted.`,
    variant: 'danger',
    confirmLabel: 'Delete',
    cancelLabel: 'Cancel',
  })

  if (!confirmed) return false

  try {
    await params.onDelete(folder)
    return true
  } catch {
    return false
  }
}

/**
 * Styles for the name dialogs. Scoped under `.cf-root` like every other block
 * in `styles.ts`; colours are `var(--lumiverse-*)` tokens, never literals.
 *
 * Buttons get an explicit `:focus-visible` ring because the source modules
 * these classes are ported from never styled a focus state and the dialogs are
 * keyboard-first (Enter submits, Escape cancels).
 */
export const CRUD_STYLES: string = `
.cf-root .cf-folder-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.cf-root .cf-folder-form-label {
  font-size: calc(11px * var(--lumiverse-font-scale, 1));
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: var(--lumiverse-text-muted);
}

.cf-root .cf-folder-form-error {
  margin: 0;
  color: var(--lumiverse-danger, #ff5c7a);
  font-size: calc(11px * var(--lumiverse-font-scale, 1));
  line-height: 1.5;
}

.cf-root .cf-folder-form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}

.cf-root .cf-folder-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 28px;
  padding: 0 12px;
  border: 1px solid var(--lumiverse-border, rgba(255, 255, 255, 0.08));
  border-radius: 8px;
  background: transparent;
  color: var(--lumiverse-text-muted);
  font: inherit;
  font-size: calc(12px * var(--lumiverse-font-scale, 1));
  cursor: pointer;
  transition: background var(--lumiverse-transition-fast), color var(--lumiverse-transition-fast);
}

.cf-root .cf-folder-btn:hover:not(:disabled) {
  background: var(--lumiverse-fill-subtle, rgba(255, 255, 255, 0.04));
  color: var(--lumiverse-text);
}

.cf-root .cf-folder-btn:focus-visible {
  outline: 2px solid var(--lumiverse-primary);
  outline-offset: 2px;
}

.cf-root .cf-folder-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.cf-root .cf-folder-btn-primary {
  background: var(--lumiverse-primary);
  border-color: var(--lumiverse-primary);
  color: var(--lumiverse-bg, #0b0b0f);
  font-weight: 600;
}

.cf-root .cf-folder-btn-primary:hover:not(:disabled) {
  background: var(--lumiverse-primary-hover, var(--lumiverse-primary));
  color: var(--lumiverse-bg, #0b0b0f);
}
`
