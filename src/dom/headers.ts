/**
 * Folder header construction and in-place updates.
 *
 * Built with `document.createElement` only — never `innerHTML`. Our `folder`
 * value comes from profile metadata, which is user data: string-concatenating it
 * into markup would be an injection sink for no benefit.
 *
 * The markup mirrors Lumiverse's own folder header
 * (frontend/src/components/panels/PersonaManager.tsx ~lines 490-528) with the
 * class names from `src/styles.ts`:
 *
 *   <div class="cf-folder-header-row">
 *     <button type="button" class="cf-folder-header" aria-expanded="true">
 *       <span class="cf-folder-chevron cf-folder-chevron-open">›</span>
 *       <span class="cf-folder-name">Folder</span>
 *       <span class="cf-folder-count">3</span>
 *     </button>
 *     <button type="button" class="cf-folder-action">✎</button>
 *     <button type="button" class="cf-folder-action cf-folder-delete">🗑</button>
 *   </div>
 *
 * A real `<button type="button">` is used for the toggle so keyboard activation
 * (Enter/Space) and focus come for free. The action buttons live OUTSIDE that
 * button — nesting interactive controls is invalid HTML and would make a click
 * on "rename" also toggle collapse — and they call `stopPropagation()` as a
 * belt-and-braces guard, exactly like PersonaManager does.
 */

/** Everything needed to render one folder header row. */
export interface FolderHeaderOptions {
  /** Grouping key (`''` for the uncategorized bucket). Used for `data-cf-folder`. */
  folder: string
  /** Display text; the caller resolves the uncategorized label. */
  label: string
  /** Number of rows in the group. */
  count: number
  collapsed: boolean
  onToggle: () => void
  onRename?: () => void
  onDelete?: () => void
  /** Render the drop-target highlight (set while a row is dragged over it). */
  dropTarget?: boolean
}

export const CF_LIST_ANCHOR_CLASS = 'cf-list-anchor'
export const CF_ROOT_CLASS = CF_LIST_ANCHOR_CLASS
export const CF_HEADER_ROW_CLASS = 'cf-folder-header-row'
export const CF_HEADER_CLASS = 'cf-folder-header'
export const CF_CHEVRON_CLASS = 'cf-folder-chevron'
export const CF_CHEVRON_OPEN_CLASS = 'cf-folder-chevron-open'
export const CF_NAME_CLASS = 'cf-folder-name'
export const CF_COUNT_CLASS = 'cf-folder-count'
export const CF_ACTION_CLASS = 'cf-folder-action'
export const CF_DELETE_CLASS = 'cf-folder-delete'
export const CF_DROP_TARGET_CLASS = 'cf-folder-drop-target'
export const FOLDER_ATTR = 'data-cf-folder'

const CHEVRON_GLYPH = '›'
const RENAME_GLYPH = '✎'
const DELETE_GLYPH = '🗑'

function actionButton(doc: Document, glyph: string, label: string, extra: string, onClick: () => void): HTMLButtonElement {
  const button = doc.createElement('button')
  button.type = 'button'
  button.className = `${CF_ACTION_CLASS} ${extra}`.trim()
  button.textContent = glyph
  button.title = label
  button.setAttribute('aria-label', label)
  button.addEventListener('click', (event) => {
    // Outside the toggle button already, but a drag/pointer gesture can still
    // bubble in from the row wrapper on some browsers.
    event.stopPropagation()
    onClick()
  })
  return button
}

/**
 * Build a header row. The caller owns insertion; `reconcile` keys the returned
 * element by its `data-cf-folder` attribute so a header survives across
 * reconciles instead of being rebuilt (rebuilding would drop focus).
 */
export function createFolderHeader(options: FolderHeaderOptions): HTMLElement {
  const doc = document
  const row = doc.createElement('div')
  row.className = CF_HEADER_ROW_CLASS
  row.setAttribute(FOLDER_ATTR, options.folder)
  if (options.dropTarget) row.classList.add(CF_DROP_TARGET_CLASS)

  const toggle = doc.createElement('button')
  toggle.type = 'button'
  toggle.className = CF_HEADER_CLASS
  toggle.setAttribute('aria-expanded', options.collapsed ? 'false' : 'true')

  const chevron = doc.createElement('span')
  chevron.className = CF_CHEVRON_CLASS
  if (!options.collapsed) chevron.classList.add(CF_CHEVRON_OPEN_CLASS)
  chevron.setAttribute('aria-hidden', 'true')
  chevron.textContent = CHEVRON_GLYPH

  const name = doc.createElement('span')
  name.className = CF_NAME_CLASS
  name.textContent = options.label

  const count = doc.createElement('span')
  count.className = CF_COUNT_CLASS
  count.textContent = String(options.count)

  toggle.append(chevron, name, count)
  toggle.addEventListener('click', (event) => {
    event.stopPropagation()
    options.onToggle()
  })

  row.appendChild(toggle)

  if (options.onRename) {
    row.appendChild(actionButton(doc, RENAME_GLYPH, `Rename ${options.label}`, '', options.onRename))
  }
  if (options.onDelete) {
    row.appendChild(actionButton(doc, DELETE_GLYPH, `Delete ${options.label}`, CF_DELETE_CLASS, options.onDelete))
  }

  return row
}

/** Fields `updateFolderHeader` can change without a rebuild. */
export interface FolderHeaderState {
  collapsed: boolean
  count: number
  label: string
}

/**
 * Update an existing header in place. Rebuilding would blur the focused
 * toggle, so only the text and the chevron rotation class change.
 */
export function updateFolderHeader(el: HTMLElement, state: FolderHeaderState): void {
  const chevron = el.querySelector<HTMLElement>(`.${CF_CHEVRON_CLASS}`)
  if (chevron) {
    chevron.classList.toggle(CF_CHEVRON_OPEN_CLASS, !state.collapsed)
  }

  const toggle = el.querySelector<HTMLElement>(`.${CF_HEADER_CLASS}`)
  toggle?.setAttribute('aria-expanded', state.collapsed ? 'false' : 'true')

  const count = el.querySelector<HTMLElement>(`.${CF_COUNT_CLASS}`)
  if (count) count.textContent = String(state.count)

  const name = el.querySelector<HTMLElement>(`.${CF_NAME_CLASS}`)
  if (name) name.textContent = state.label
}

/** Read the grouping key off a header row. */
export function folderOfHeader(el: HTMLElement): string | null {
  return el.getAttribute(FOLDER_ATTR)
}
