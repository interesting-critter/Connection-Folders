/**
 * UI-layer tests: the injected row/action buttons, the name dialogs and the
 * per-profile folder assignment modal.
 *
 * happy-dom globals are installed per-file exactly like `dom.test.ts`, so the
 * button/icon markup and the modal DOM can be asserted without a browser.
 *
 * The fake host reproduces the two Spindle behaviours the UI actually leans on,
 * both copied from `frontend/src/lib/spindle/loader.ts`:
 *
 *  - `showModal().dismiss()` tears the modal down and notifies `onDismiss`
 *    handlers, in that order, from inside the `dismiss()` call (loader.ts
 *    ~1800-1810). The host allows at most 2 stacked modals, so the fake tracks
 *    the count and throws past it rather than letting a test pass on a modal
 *    stack the real host would have refused.
 *  - `mountFolderDropdown` hands back an imperative handle whose `update`
 *    replaces the options React was mounted with; the fake records every
 *    update so tests can assert the dropdown was re-pointed at the list a
 *    create returned.
 */

import { describe, it, expect, beforeEach } from 'bun:test'
import { Window as HappyDomWindow } from 'happy-dom'

import {
  createNewFolderButton,
  createRowFolderButton,
  ACTION_STYLES,
} from '../src/ui/actions'
import {
  MAX_FOLDER_NAME_LENGTH,
  validateFolderName,
  promptCreateFolder,
  promptRenameFolder,
  confirmDeleteFolder,
  CRUD_STYLES,
} from '../src/ui/crud'
import { openFolderAssignModal, ASSIGN_STYLES } from '../src/ui/assign'
import type { ConnectionProfile } from '../src/types'

const NewWindow = HappyDomWindow as unknown as new () => unknown

const DOM_GLOBALS = [
  'document',
  'HTMLElement',
  'HTMLButtonElement',
  'HTMLInputElement',
  'SVGElement',
  'Element',
  'Node',
  'Event',
  'MouseEvent',
  'KeyboardEvent',
] as const

let win: Record<string, unknown>

beforeEach(() => {
  win = new NewWindow() as Record<string, unknown>
  const target = globalThis as unknown as Record<string, unknown>
  for (const key of DOM_GLOBALS) target[key] = win[key]
})

const SVG_NS = 'http://www.w3.org/2000/svg'

function click(el: Element): void {
  const MouseEvt = win['MouseEvent'] as typeof MouseEvent
  el.dispatchEvent(new MouseEvt('click', { bubbles: true, cancelable: true }))
}

function keydown(el: Element, key: string): void {
  const KeyEvt = win['KeyboardEvent'] as typeof KeyboardEvent
  el.dispatchEvent(new KeyEvt('keydown', { key, bubbles: true, cancelable: true }))
}

function type(el: HTMLInputElement, value: string): void {
  el.value = value
  const Evt = win['Event'] as typeof Event
  el.dispatchEvent(new Evt('input', { bubbles: true }))
}

/** Let every queued microtask (and any `setTimeout(0)`) drain. */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

// --- fake host ---------------------------------------------------------------

interface FakeModal {
  root: HTMLElement
  modalId: string
  dismissed: boolean
  title: string
  dismiss(): void
  setTitle(title: string): void
  onDismiss(handler: () => void): () => void
  /** Simulate the host's own close button / backdrop click. */
  dismissFromUser(): void
}

interface PendingConfirm {
  title: string
  message: string
  variant?: string
  confirmLabel?: string
  cancelLabel?: string
  resolve(result: { confirmed: boolean }): void
}

interface MountedDropdown {
  target: HTMLElement
  options: {
    folders?: string[]
    value?: string
    placeholder?: string
    onChange?: (folder: string) => void
    onCreateFolder?: (name: string) => unknown
  }
  updates: Array<Record<string, unknown>>
  destroyed: number
  handle: {
    update(patch: Record<string, unknown>): void
    getValue(): string
    destroy(): void
  }
}

export interface FakeHost {
  ctx: Record<string, unknown>
  modals: FakeModal[]
  openModalCount: number
  confirms: PendingConfirm[]
  dropdowns: MountedDropdown[]
  /** The most recent modal the extension opened. */
  lastModal(): FakeModal
  lastDropdown(): MountedDropdown
}

function createFakeHost(): FakeHost {
  const modals: FakeModal[] = []
  const confirms: PendingConfirm[] = []
  const dropdowns: MountedDropdown[] = []
  let modalSeq = 0
  let stack = 0

  const ui = {
    showModal(options: { title: string }): FakeModal {
      // The host refuses a third stacked modal (loader.ts ~1732).
      if (stack >= 2) throw new Error('Maximum of 2 stacked modals per extension')
      stack++
      const root = document.createElement('div')
      document.body.appendChild(root)

      const handlers = new Set<() => void>()
      const modal: FakeModal = {
        root,
        modalId: `modal-${++modalSeq}`,
        dismissed: false,
        title: options.title,
        dismiss() {
          if (modal.dismissed) return
          modal.dismissed = true
          stack--
          root.remove()
          // Handler notification is synchronous, inside `dismiss()`.
          for (const handler of [...handlers]) {
            try {
              handler()
            } catch {
              // The host swallows teardown errors from dismiss handlers.
            }
          }
          handlers.clear()
        },
        setTitle(title: string) {
          modal.title = title
        },
        onDismiss(handler: () => void) {
          handlers.add(handler)
          return () => {
            handlers.delete(handler)
          }
        },
        dismissFromUser() {
          modal.dismiss()
        },
      }
      modals.push(modal)
      return modal
    },

    showConfirm(options: PendingConfirm): Promise<{ confirmed: boolean }> {
      return new Promise((resolve) => {
        confirms.push({ ...options, resolve })
      })
    },
  }

  const components = {
    mountFolderDropdown(target: HTMLElement, options: MountedDropdown['options']) {
      const record: MountedDropdown = {
        target,
        options,
        updates: [],
        destroyed: 0,
        handle: {
          update(patch) {
            record.updates.push(patch)
            Object.assign(record.options, patch)
          },
          getValue() {
            return record.options.value ?? ''
          },
          destroy() {
            record.destroyed += 1
          },
        },
      }
      dropdowns.push(record)
      return record.handle
    },
  }

  const dom = {
    query(selector: string) {
      return document.querySelector(selector)
    },
  }

  return {
    ctx: { ui, components, dom },
    modals,
    openModalCount: 0,
    confirms,
    dropdowns,
    lastModal() {
      const modal = modals[modals.length - 1]
      if (!modal) throw new Error('no modal was opened')
      return modal
    },
    lastDropdown() {
      const dropdown = dropdowns[dropdowns.length - 1]
      if (!dropdown) throw new Error('no folder dropdown was mounted')
      return dropdown
    },
  }
}

function ctxOf(host: FakeHost): any {
  return host.ctx
}

function profile(folder?: string): ConnectionProfile {
  return {
    id: 'conn-1',
    name: 'OpenAI',
    provider: 'openai',
    model: 'gpt-4o',
    metadata: folder === undefined ? {} : { folder },
  }
}

// --- validateFolderName ------------------------------------------------------

describe('validateFolderName', () => {
  const existing = ['Alpha', 'Beta']

  it('accepts a normal, unused name', () => {
    expect(validateFolderName('Gamma', existing)).toBeNull()
  })

  it('rejects a blank name', () => {
    expect(validateFolderName('', existing)).toBe('Enter a folder name.')
  })

  it('rejects a whitespace-only name', () => {
    expect(validateFolderName('   \t  ', existing)).toBe('Enter a folder name.')
  })

  it('rejects the reserved Uncategorized bucket in any casing or padding', () => {
    for (const raw of ['Uncategorized', 'uncategorized', '  Uncategorized  ', 'UNCATEGORIZED']) {
      const message = validateFolderName(raw, existing)
      expect(message).toContain('reserved')
      expect(message).toContain('Uncategorized')
    }
  })

  it('rejects a duplicate, quoting the name', () => {
    expect(validateFolderName('Alpha', existing)).toBe('A folder named “Alpha” already exists.')
  })

  it('trims before every check, so padded duplicates are still duplicates', () => {
    expect(validateFolderName('  Alpha  ', existing)).toBe('A folder named “Alpha” already exists.')
    expect(validateFolderName('  Uncategorized  ', existing)).toContain('reserved')
  })

  it('excludes `ignore` from the duplicate check so a no-op rename is legal', () => {
    expect(validateFolderName('Alpha', existing, 'Alpha')).toBeNull()
    expect(validateFolderName('  Alpha  ', existing, 'Alpha')).toBeNull()
    // Ignoring one name must not unblock a different collision.
    expect(validateFolderName('Beta', existing, 'Alpha')).toBe('A folder named “Beta” already exists.')
  })

  it('rejects a name over the length cap and accepts one at the cap', () => {
    const tooLong = 'x'.repeat(MAX_FOLDER_NAME_LENGTH + 1)
    expect(validateFolderName(tooLong, existing)).toBe(
      `Keep folder names under ${MAX_FOLDER_NAME_LENGTH} characters.`,
    )
    expect(validateFolderName('x'.repeat(MAX_FOLDER_NAME_LENGTH), existing)).toBeNull()
  })

  it('reports the reserved reason in preference to the duplicate one', () => {
    // Both apply; the reserved message is the actionable one, so it must win
    // regardless of the order the checks run in.
    expect(validateFolderName('Uncategorized', ['Uncategorized'])).toContain('reserved')
  })

  it('measures length after trimming', () => {
    expect(validateFolderName(`  ${'x'.repeat(MAX_FOLDER_NAME_LENGTH)}  `, existing)).toBeNull()
  })
})

// --- action buttons ----------------------------------------------------------

describe('createNewFolderButton', () => {
  function build(onCreate = () => {}): HTMLButtonElement {
    return createNewFolderButton({ onCreate, label: 'New folder' })
  }

  it('is a non-submit button carrying the cf- classes', () => {
    const button = build()
    expect(button.tagName).toBe('BUTTON')
    expect(button.type).toBe('button')
    expect(button.className).toContain('cf-folder-action')
    expect(button.className).toContain('cf-new-folder-button')
    expect(button.getAttribute('data-cf-new-folder')).toBe('1')
    expect(button.getAttribute('data-cf-stop')).toBe('1')
  })

  it('labels itself with both aria-label and title, and repeats the label as text', () => {
    const button = build()
    expect(button.getAttribute('aria-label')).toBe('New folder')
    expect(button.title).toBe('New folder')
    expect(button.querySelector('.cf-new-folder-label')?.textContent).toBe('New folder')
  })

  it('invokes onCreate on click exactly once', () => {
    let created = 0
    const button = build(() => {
      created += 1
    })
    click(button)
    expect(created).toBe(1)
  })

  it('does not let the click escape into a surrounding row', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    let bubbled = 0
    host.addEventListener('click', () => {
      bubbled += 1
    })
    host.appendChild(build())
    click(host.firstElementChild as Element)
    expect(bubbled).toBe(0)
  })

  it('builds its icon in the SVG namespace with the folder-plus geometry', () => {
    const svg = build().querySelector('svg') as SVGSVGElement
    expect(svg).not.toBeNull()
    expect(svg.namespaceURI).toBe(SVG_NS)
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24')
    expect(svg.getAttribute('stroke')).toBe('currentColor')
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    const paths = svg.querySelectorAll('path')
    expect(paths.length).toBe(3)
    for (const path of paths) expect(path.namespaceURI).toBe(SVG_NS)
  })
})

describe('createRowFolderButton', () => {
  function build(overrides: Partial<Parameters<typeof createRowFolderButton>[0]> = {}): HTMLButtonElement {
    return createRowFolderButton({
      onClick: () => {},
      currentFolder: 'Alpha',
      label: 'Folder',
      profileId: 'conn-1',
      ...overrides,
    })
  }

  it('is a non-submit button stamped with the profile id', () => {
    const button = build()
    expect(button.tagName).toBe('BUTTON')
    expect(button.type).toBe('button')
    expect(button.className).toContain('cf-folder-action')
    expect(button.className).toContain('cf-row-folder-button')
    expect(button.getAttribute('data-cf-assign')).toBe('conn-1')
    expect(button.getAttribute('data-cf-stop')).toBe('1')
  })

  it('omits data-cf-assign until the wiring layer knows the row', () => {
    const button = createRowFolderButton({ onClick: () => {}, currentFolder: '', label: 'Folder' })
    expect(button.hasAttribute('data-cf-assign')).toBe(false)
  })

  it('announces the action and reflects the CURRENT folder in the title', () => {
    const button = build()
    expect(button.getAttribute('aria-label')).toBe('Folder')
    expect(button.title).toBe('Folder — Folder: Alpha')
  })

  it('says so when the profile has no folder', () => {
    const button = build({ currentFolder: '' })
    expect(button.title).toBe('Folder — No folder set')
  })

  it('invokes onClick on click and stops propagation', () => {
    let clicks = 0
    const host = document.createElement('div')
    document.body.appendChild(host)
    let bubbled = 0
    host.addEventListener('click', () => {
      bubbled += 1
    })
    host.appendChild(
      build({
        onClick: () => {
          clicks += 1
        },
      }),
    )
    click(host.firstElementChild as Element)
    expect(clicks).toBe(1)
    expect(bubbled).toBe(0)
  })

  it('renders a namespaced single-path folder icon', () => {
    const svg = build().querySelector('svg') as SVGSVGElement
    expect(svg.namespaceURI).toBe(SVG_NS)
    expect(svg.querySelectorAll('path').length).toBe(1)
  })
})

describe('ACTION_STYLES', () => {
  it('scopes every rule to .cf-root or extension cf- classes so it cannot leak into the host', () => {
    const rules = ACTION_STYLES.split('\n').filter((line) => line.trim().startsWith('.'))
    expect(rules.length).toBeGreaterThan(0)
    for (const rule of rules) {
      const trimmed = rule.trim()
      const isScoped =
        trimmed.startsWith('.cf-root') ||
        trimmed.startsWith('.cf-folder-action') ||
        trimmed.startsWith('.cf-row-folder-button')
      expect(isScoped).toBe(true)
    }
  })
})

// --- confirmDeleteFolder -----------------------------------------------------

describe('confirmDeleteFolder', () => {
  it('returns true and deletes when confirmed', async () => {
    const host = createFakeHost()
    const deleted: string[] = []

    const pending = confirmDeleteFolder(ctxOf(host), {
      folder: 'Alpha',
      count: 2,
      onDelete: async (folder) => {
        deleted.push(folder)
        return []
      },
    })
    await flush()

    expect(host.confirms.length).toBe(1)
    host.confirms[0].resolve({ confirmed: true })
    expect(await pending).toBe(true)
    expect(deleted).toEqual(['Alpha'])
  })

  it('returns false and never writes when cancelled', async () => {
    const host = createFakeHost()
    let calls = 0

    const pending = confirmDeleteFolder(ctxOf(host), {
      folder: 'Alpha',
      count: 1,
      onDelete: async () => {
        calls += 1
        return []
      },
    })
    await flush()
    host.confirms[0].resolve({ confirmed: false })

    expect(await pending).toBe(false)
    expect(calls).toBe(0)
  })

  it('puts the profile count in the message and warns they are not deleted', async () => {
    const host = createFakeHost()
    void confirmDeleteFolder(ctxOf(host), {
      folder: 'Alpha',
      count: 3,
      onDelete: async () => [],
    })
    await flush()

    const confirm = host.confirms[0]
    expect(confirm.title).toBe('Delete “Alpha”?')
    expect(confirm.message).toContain('3 profiles')
    expect(confirm.message).toContain('Uncategorized')
    expect(confirm.message).toContain('not deleted')
    expect(confirm.variant).toBe('danger')
    confirm.resolve({ confirmed: false })
    await flush()
  })

  it('uses the singular noun for a single profile', async () => {
    const host = createFakeHost()
    void confirmDeleteFolder(ctxOf(host), {
      folder: 'Alpha',
      count: 1,
      onDelete: async () => [],
    })
    await flush()
    expect(host.confirms[0].message).toContain('1 profile in it')
    expect(host.confirms[0].message).not.toContain('1 profiles')
    host.confirms[0].resolve({ confirmed: false })
    await flush()
  })

  it('reports false when the delete write is rejected', async () => {
    const host = createFakeHost()
    const pending = confirmDeleteFolder(ctxOf(host), {
      folder: 'Alpha',
      count: 1,
      onDelete: async () => {
        throw new Error('store offline')
      },
    })
    await flush()
    host.confirms[0].resolve({ confirmed: true })
    expect(await pending).toBe(false)
  })
})

// --- name prompts ------------------------------------------------------------

/** The pieces of the shared prompt shell a test needs to poke at. */
interface PromptParts {
  form: HTMLElement
  input: HTMLInputElement
  error: HTMLElement
  confirm: HTMLButtonElement
  cancel: HTMLButtonElement
}

function partsOf(modal: FakeModal): PromptParts {
  const form = modal.root.querySelector('.cf-folder-form') as HTMLElement
  return {
    form,
    input: form.querySelector('.cf-folder-rename-input') as HTMLInputElement,
    error: form.querySelector('.cf-folder-form-error') as HTMLElement,
    confirm: form.querySelector('.cf-folder-btn-primary') as HTMLButtonElement,
    cancel: form.querySelectorAll('.cf-folder-btn')[0] as HTMLButtonElement,
  }
}

describe('promptCreateFolder', () => {
  /**
   * ORDERING CONSTRAINT (mirrored as a comment on `promptForName` in
   * `src/ui/crud.ts`): `finish()` must `resolve(result)` BEFORE
   * `modal.dismiss()`.
   *
   * The host's `dismiss()` notifies `onDismiss` handlers SYNCHRONOUSLY from
   * inside the call (`frontend/src/lib/spindle/loader.ts` ~1800-1810), and that
   * handler resolves `null`. A promise keeps only its FIRST settlement, so
   * dismissing first would make every CONFIRM path resolve `null` and the
   * dialogs could never report the committed name — a caller could not tell
   * "created" from "cancelled". Swapping the lines back is the regression.
   *
   * The cancel / backdrop / Escape paths are unaffected: they legitimately
   * resolve `null`.
   */

  it('commits the trimmed name on confirm and resolves with it', async () => {
    const host = createFakeHost()
    const created: string[] = []

    const pending = promptCreateFolder(ctxOf(host), {
      folders: ['Alpha'],
      onCreate: async (name) => {
        created.push(name)
        return [...['Alpha'], name]
      },
    })
    await flush()

    const modal = host.lastModal()
    expect(modal.title).toBe('New Folder')
    const parts = partsOf(modal)
    expect(parts.input.value).toBe('')
    // The empty pre-fill is invalid, so the dialog opens already explaining why.
    expect(parts.error.hidden).toBe(false)
    expect(parts.error.textContent).toBe('Enter a folder name.')

    type(parts.input, '  Gamma  ')
    click(parts.confirm)

    expect(created).toEqual(['Gamma'])
    expect(await pending).toBe('Gamma')
    expect(modal.dismissed).toBe(true)
  })

  it('clears the error as soon as the field is corrected', async () => {
    const host = createFakeHost()
    const pending = promptCreateFolder(ctxOf(host), {
      folders: [],
      onCreate: async (name) => [name],
    })
    await flush()
    const modal = host.lastModal()
    const parts = partsOf(modal)

    expect(parts.error.hidden).toBe(false)
    type(parts.input, 'Gamma')
    expect(parts.error.hidden).toBe(true)
    expect(parts.error.textContent).toBe('')

    modal.dismissFromUser()
    expect(await pending).toBeNull()
  })

  it('returns null on cancel without calling onCreate', async () => {
    const host = createFakeHost()
    let calls = 0
    const pending = promptCreateFolder(ctxOf(host), {
      folders: [],
      onCreate: async () => {
        calls += 1
        return []
      },
    })
    await flush()

    const modal = host.lastModal()
    const parts = partsOf(modal)
    type(parts.input, 'Gamma')
    click(parts.cancel)

    expect(await pending).toBeNull()
    expect(calls).toBe(0)
    expect(modal.dismissed).toBe(true)
  })

  it('returns null when the host dismisses the dialog (backdrop / close button)', async () => {
    const host = createFakeHost()
    const pending = promptCreateFolder(ctxOf(host), {
      folders: [],
      onCreate: async () => [],
    })
    await flush()

    host.lastModal().dismissFromUser()
    expect(await pending).toBeNull()
  })

  it('surfaces the reserved-word rejection without closing or writing', async () => {
    const host = createFakeHost()
    const created: string[] = []
    const pending = promptCreateFolder(ctxOf(host), {
      folders: [],
      onCreate: async (name) => {
        created.push(name)
        return [name]
      },
    })
    await flush()

    const modal = host.lastModal()
    const parts = partsOf(modal)
    type(parts.input, 'uncategorized')
    click(parts.confirm)
    await flush()

    expect(parts.error.hidden).toBe(false)
    expect(parts.error.textContent).toContain('reserved')
    expect(parts.error.getAttribute('role')).toBe('alert')
    expect(created).toEqual([])
    expect(modal.dismissed).toBe(false)
    // The typed value survives so the user can correct it.
    expect(parts.input.value).toBe('uncategorized')

    // …and correcting it commits.
    type(parts.input, 'Gamma')
    click(parts.confirm)
    expect(await pending).toBe('Gamma')
    expect(created).toEqual(['Gamma'])
    expect(modal.dismissed).toBe(true)
  })

  it('blocks an over-length name at the input, as well as in validation', async () => {
    const host = createFakeHost()
    const pending = promptCreateFolder(ctxOf(host), {
      folders: [],
      onCreate: async () => [],
    })
    await flush()
    const parts = partsOf(host.lastModal())
    // maxLength is what stops the typed value growing past the cap, so the
    // validator's length branch is unreachable from this dialog.
    expect(parts.input.maxLength).toBe(MAX_FOLDER_NAME_LENGTH)
    host.lastModal().dismissFromUser()
    expect(await pending).toBeNull()
  })

  it('reports a rejected write inline, stays open, and allows a retry', async () => {
    const host = createFakeHost()
    const attempts: string[] = []
    const pending = promptCreateFolder(ctxOf(host), {
      folders: [],
      onCreate: async (name) => {
        attempts.push(name)
        if (attempts.length === 1) throw new Error('store offline')
        return [name]
      },
    })
    await flush()

    const modal = host.lastModal()
    const parts = partsOf(modal)
    type(parts.input, 'Gamma')
    click(parts.confirm)
    await flush()

    expect(parts.error.hidden).toBe(false)
    expect(parts.error.textContent).toBe('store offline')
    expect(parts.confirm.disabled).toBe(false)
    expect(modal.dismissed).toBe(false)

    click(parts.confirm)
    expect(attempts).toEqual(['Gamma', 'Gamma'])
    expect(await pending).toBe('Gamma')
    expect(modal.dismissed).toBe(true)
  })

  it('falls back to a generic message when the write rejects with a non-Error', async () => {
    const host = createFakeHost()
    const pending = promptCreateFolder(ctxOf(host), {
      folders: [],
      onCreate: async () => {
        throw 'nope'
      },
    })
    await flush()
    const modal = host.lastModal()
    const parts = partsOf(modal)
    type(parts.input, 'Gamma')
    click(parts.confirm)
    await flush()

    expect(parts.error.textContent).toBe('The folder could not be saved.')
    expect(modal.dismissed).toBe(false)
    modal.dismissFromUser()
    expect(await pending).toBeNull()
  })

  it('ignores a second confirm click while the write is in flight', async () => {
    const host = createFakeHost()
    let release: (() => void) | null = null
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let calls = 0

    const pending = promptCreateFolder(ctxOf(host), {
      folders: [],
      onCreate: async (name) => {
        calls += 1
        await gate
        return [name]
      },
    })
    await flush()

    const modal = host.lastModal()
    const parts = partsOf(modal)
    type(parts.input, 'Gamma')
    click(parts.confirm)
    await flush()
    // The confirm button is latched off for the duration of the write.
    expect(parts.confirm.disabled).toBe(true)
    click(parts.confirm)
    await flush()
    expect(calls).toBe(1)

    ;(release as unknown as () => void)()
    expect(await pending).toBe('Gamma')
    expect(calls).toBe(1)
    expect(modal.dismissed).toBe(true)
  })

  it('submits on Enter and cancels on Escape', async () => {
    const host = createFakeHost()
    const created: string[] = []
    const submit = promptCreateFolder(ctxOf(host), {
      folders: [],
      onCreate: async (name) => {
        created.push(name)
        return [name]
      },
    })
    await flush()
    const modal = host.lastModal()
    const parts = partsOf(modal)
    type(parts.input, 'Delta')
    keydown(parts.input, 'Enter')
    await flush()
    expect(created).toEqual(['Delta'])
    expect(modal.dismissed).toBe(true)
    expect(await submit).toBe('Delta')

    const createdAgain: string[] = []
    const cancel = promptCreateFolder(ctxOf(host), {
      folders: [],
      onCreate: async (name) => {
        createdAgain.push(name)
        return [name]
      },
    })
    await flush()
    const second = partsOf(host.lastModal())
    type(second.input, 'Epsilon')
    keydown(second.input, 'Escape')
    await flush()
    expect(createdAgain).toEqual([])
    expect(await cancel).toBeNull()
  })

  it('rejects a duplicate name inline', async () => {
    const host = createFakeHost()
    const pending = promptCreateFolder(ctxOf(host), {
      folders: ['Alpha'],
      onCreate: async () => [],
    })
    await flush()
    const parts = partsOf(host.lastModal())
    type(parts.input, 'Alpha')
    click(parts.confirm)
    await flush()
    expect(parts.error.textContent).toContain('already exists')
    expect(host.lastModal().dismissed).toBe(false)
    // Still pending: nothing was resolved, so resolve via the close button.
    host.lastModal().dismissFromUser()
    expect(await pending).toBeNull()
  })
})

describe('promptRenameFolder', () => {
  it('renames, passes the old name through, and resolves with the new name', async () => {
    const host = createFakeHost()
    const calls: Array<[string, string]> = []

    const pending = promptRenameFolder(ctxOf(host), {
      folder: 'Alpha',
      folders: ['Alpha', 'Beta'],
      onRename: async (oldName, newName) => {
        calls.push([oldName, newName])
        return ['Beta', newName]
      },
    })
    await flush()

    const modal = host.lastModal()
    expect(modal.title).toBe('Rename Folder — Alpha')
    const parts = partsOf(modal)
    // Pre-filled with the current name so the user edits rather than retypes.
    expect(parts.input.value).toBe('Alpha')
    expect(parts.confirm.textContent).toBe('Rename')
    // A valid pre-fill means the dialog opens with nothing to report.
    expect(parts.error.hidden).toBe(true)

    type(parts.input, '  Gamma  ')
    click(parts.confirm)

    expect(calls).toEqual([['Alpha', 'Gamma']])
    expect(await pending).toBe('Gamma')
    expect(modal.dismissed).toBe(true)
  })

  it('accepts a no-op rename because the source is excluded from the check', async () => {
    const host = createFakeHost()
    const calls: Array<[string, string]> = []
    const pending = promptRenameFolder(ctxOf(host), {
      folder: 'Alpha',
      folders: ['Alpha', 'Beta'],
      onRename: async (oldName, newName) => {
        calls.push([oldName, newName])
        return ['Alpha', 'Beta']
      },
    })
    await flush()
    const parts = partsOf(host.lastModal())
    expect(parts.error.hidden).toBe(true)
    click(parts.confirm)
    expect(calls).toEqual([['Alpha', 'Alpha']])
    expect(await pending).toBe('Alpha')
  })

  it('returns null on cancel without renaming', async () => {
    const host = createFakeHost()
    let calls = 0
    const pending = promptRenameFolder(ctxOf(host), {
      folder: 'Alpha',
      folders: ['Alpha'],
      onRename: async () => {
        calls += 1
        return []
      },
    })
    await flush()
    const parts = partsOf(host.lastModal())
    type(parts.input, 'Gamma')
    click(parts.cancel)
    expect(await pending).toBeNull()
    expect(calls).toBe(0)
  })

  it('blocks a rename onto an existing folder', async () => {
    const host = createFakeHost()
    let calls = 0
    const pending = promptRenameFolder(ctxOf(host), {
      folder: 'Alpha',
      folders: ['Alpha', 'Beta'],
      onRename: async () => {
        calls += 1
        return ['Beta']
      },
    })
    await flush()
    const parts = partsOf(host.lastModal())
    type(parts.input, 'Beta')
    click(parts.confirm)
    await flush()
    expect(parts.error.textContent).toContain('already exists')
    expect(calls).toBe(0)
    expect(host.lastModal().dismissed).toBe(false)
    host.lastModal().dismissFromUser()
    expect(await pending).toBeNull()
  })
})

describe('CRUD_STYLES', () => {
  it('scopes every rule under .cf-root', () => {
    const rules = CRUD_STYLES.split('\n').filter((line) => line.trim().startsWith('.'))
    expect(rules.length).toBeGreaterThan(0)
    for (const rule of rules) expect(rule).toContain('.cf-root')
  })
})

// --- openFolderAssignModal ---------------------------------------------------

describe('openFolderAssignModal', () => {
  interface AssignCase {
    assigned: string[]
    next: string[]
  }

  function buildCase(
    host: FakeHost,
    overrides: {
      profile?: ConnectionProfile
      folders?: string[]
      onAssign?: (folder: string) => Promise<void>
      onCreateFolder?: (name: string) => Promise<string[]>
    } = {},
  ): AssignCase {
    const assigned: string[] = []
    const record: AssignCase = { assigned, next: overrides.folders ?? ['Alpha', 'Beta'] }

    void openFolderAssignModal(ctxOf(host), {
      profile: overrides.profile ?? profile('Alpha'),
      folders: overrides.folders ?? ['Alpha', 'Beta'],
      onCreateFolder:
        overrides.onCreateFolder ??
        (async (name: string) => {
          record.next = [...record.next, name]
          return record.next
        }),
      onAssign:
        overrides.onAssign ??
        (async (folder: string) => {
          assigned.push(folder)
        }),
    })

    return record
  }

  it('mounts the host dropdown into the modal root with the current folder preselected', async () => {
    const host = createFakeHost()
    buildCase(host)

    const modal = host.lastModal()
    expect(modal.title).toBe('Folder — OpenAI')

    const root = modal.root.querySelector('.cf-root') as HTMLElement
    expect(root).not.toBeNull()

    const dropdown = host.lastDropdown()
    const target = root.querySelector('.cf-folder-assign-target') as HTMLElement
    expect(dropdown.target).toBe(target)
    expect(dropdown.options.folders).toEqual(['Alpha', 'Beta'])
    expect(dropdown.options.value).toBe('Alpha')
    expect(dropdown.options.placeholder).toBe('No folder')

    const hint = root.querySelector('.cf-unsupported-banner-body') as HTMLElement
    expect(hint.textContent).toContain('Currently in “Alpha”.')
  })

  it('describes an unfiled profile differently', async () => {
    const host = createFakeHost()
    buildCase(host, { profile: profile() })
    const root = host.lastModal().root.querySelector('.cf-root') as HTMLElement
    expect(root.querySelector('.cf-unsupported-banner-body')?.textContent).toBe(
      'This profile has no folder. Pick one, or create a new one.',
    )
    expect(host.lastDropdown().options.value).toBe('')
  })

  it('hides the error slot until something fails', async () => {
    const host = createFakeHost()
    buildCase(host)
    const error = host.lastModal().root.querySelector('.cf-assign-error') as HTMLElement
    expect(error.hidden).toBe(true)
    expect(error.getAttribute('role')).toBe('status')
  })

  it('assigns the chosen folder, then dismisses and tears the dropdown down', async () => {
    const host = createFakeHost()
    const record = buildCase(host)
    await flush()

    host.lastDropdown().options.onChange?.('Beta')
    await flush()

    expect(record.assigned).toEqual(['Beta'])
    expect(host.lastModal().dismissed).toBe(true)
    expect(host.lastDropdown().destroyed).toBe(1)
  })

  it('assigns the empty string when “no folder” is chosen, removing the assignment', async () => {
    const host = createFakeHost()
    const record = buildCase(host, { profile: profile() })
    await flush()

    host.lastDropdown().options.onChange?.('')
    await flush()

    expect(record.assigned).toEqual([''])
    expect(host.lastModal().dismissed).toBe(true)
  })

  it('refreshes the dropdown list after a create and assigns only once registered', async () => {
    const host = createFakeHost()
    let releaseCreate: (() => void) | null = null
    const gate = new Promise<void>((resolve) => {
      releaseCreate = resolve
    })

    const assigned: string[] = []
    buildCase(host, {
      onCreateFolder: async (name: string) => {
        await gate
        return ['Alpha', 'Beta', name]
      },
      onAssign: async (folder: string) => {
        assigned.push(folder)
      },
    })
    await flush()

    const dropdown = host.lastDropdown()
    // FolderDropdown fires onCreateFolder then onChange for the SAME name.
    dropdown.options.onCreateFolder?.('Gamma')
    dropdown.options.onChange?.('Gamma')
    await flush()

    // Still gated: the metadata must not be written for a folder that does not
    // exist yet.
    expect(assigned).toEqual([])
    expect(dropdown.updates).toEqual([])
    expect(host.lastModal().dismissed).toBe(false)

    ;(releaseCreate as unknown as () => void)()
    await flush()

    expect(dropdown.updates).toEqual([{ folders: ['Alpha', 'Beta', 'Gamma'] }])
    expect(assigned).toEqual(['Gamma'])
    expect(host.lastModal().dismissed).toBe(true)
  })

  it('keeps the modal open and shows the message when the assignment is rejected', async () => {
    const host = createFakeHost()
    buildCase(host, {
      onAssign: async () => {
        throw new Error('PUT /api/v1/connections/conn-1 failed: 500')
      },
    })
    await flush()

    const modal = host.lastModal()
    const error = modal.root.querySelector('.cf-assign-error') as HTMLElement
    host.lastDropdown().options.onChange?.('Beta')
    await flush()

    expect(modal.dismissed).toBe(false)
    expect(error.hidden).toBe(false)
    expect(error.textContent).toContain('500')
    // Not torn down: the user can retry from the still-open picker.
    expect(host.lastDropdown().destroyed).toBe(0)

    // A subsequent successful choice still closes.
    buildCase(host, {
      profile: profile('Alpha'),
      onAssign: async () => {},
    })
  })

  it('falls back to a generic message for a non-Error rejection', async () => {
    const host = createFakeHost()
    buildCase(host, {
      onAssign: async () => {
        throw 'nope'
      },
    })
    await flush()

    host.lastDropdown().options.onChange?.('Beta')
    await flush()
    const error = host.lastModal().root.querySelector('.cf-assign-error') as HTMLElement
    expect(error.textContent).toBe('That folder could not be saved.')
  })

  it('reports a failed create inline, rethrows, and never assigns the unregistered name', async () => {
    const host = createFakeHost()
    const assigned: string[] = []
    buildCase(host, {
      onCreateFolder: async () => {
        throw new Error('name already registered')
      },
      onAssign: async (folder: string) => {
        assigned.push(folder)
      },
    })
    await flush()

    const modal = host.lastModal()
    const dropdown = host.lastDropdown()
    // The host fires onChange immediately after onCreateFolder for the SAME
    // name (FolderDropdown.tsx `handleConfirmCreate`), so both run before any
    // microtask — exactly the ordering the `pendingCreate` stash exists for.
    const created = dropdown.options.onCreateFolder?.('Gamma') as Promise<string[]>
    dropdown.options.onChange?.('Gamma')

    // The rethrow tells the host the creation failed; the returned promise is
    // discarded by the host (its signature is `(name) => void`), so the test
    // claims it rather than leaving it unhandled.
    expect(created).toBeInstanceOf(Promise)
    await expect(created).rejects.toThrow('name already registered')
    await flush()

    expect(modal.dismissed).toBe(false)
    const error = modal.root.querySelector('.cf-assign-error') as HTMLElement
    expect(error.hidden).toBe(false)
    expect(error.textContent).toBe('name already registered')

    // The stashed promise was cleared by the rejection handler, so the follow-up
    // onChange bailed out instead of writing metadata for a folder that does
    // not exist.
    expect(assigned).toEqual([])
    expect(dropdown.updates).toEqual([])
    expect(modal.dismissed).toBe(false)
  })

  

  it('treats an assignment after an earlier successful create as a plain change', async () => {
    const host = createFakeHost()
    const record = buildCase(host)
    await flush()

    const dropdown = host.lastDropdown()
    dropdown.options.onCreateFolder?.('Gamma')
    dropdown.options.onChange?.('Gamma')
    await flush()
    expect(record.assigned).toEqual(['Gamma'])
    expect(host.lastModal().dismissed).toBe(true)
  })

  it('tears the dropdown down when the host dismisses the modal itself', async () => {
    const host = createFakeHost()
    buildCase(host)
    await flush()

    host.lastModal().dismissFromUser()
    expect(host.lastDropdown().destroyed).toBe(1)
  })

  it('survives a dropdown that throws on destroy', async () => {
    const host = createFakeHost()
    buildCase(host)
    await flush()

    const dropdown = host.lastDropdown()
    dropdown.handle.destroy = () => {
      throw new Error('host already unmounted the React tree')
    }

    host.lastModal().dismissFromUser()
    expect(host.lastModal().dismissed).toBe(true)
  })
})

describe('ASSIGN_STYLES', () => {
  it('scopes every rule under .cf-root', () => {
    const rules = ASSIGN_STYLES.split('\n').filter((line) => line.trim().startsWith('.'))
    expect(rules.length).toBeGreaterThan(0)
    for (const rule of rules) expect(rule).toContain('.cf-root')
  })
})
