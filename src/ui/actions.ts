/**
 * Small action buttons injected into Lumiverse's own Connections rows.
 *
 * Both builders construct their icons with `document.createElementNS` — never
 * `innerHTML` — so nothing here depends on a parser and no extension-authored
 * markup can be interpreted as host markup.
 *
 * SVG geometry is copied from lucide-react v0.468.0 (`FolderPlus`, `Folder`) so
 * the icons are indistinguishable from the ones the native UI renders.
 */

const SVG_NS = 'http://www.w3.org/2000/svg'

/** lucide `Folder`: a single path, 24×24 viewBox. */
const FOLDER_PATH = 'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z'

/** lucide `FolderPlus`: the folder path plus the two plus strokes. */
const FOLDER_PLUS_PATHS = ['M12 10v6', 'M9 13h6', FOLDER_PATH]

/**
 * Build a 12×12 stroked lucide icon.
 *
 * `stroke-width` 1.75 matches the 24px lucide default scaled to 12px by the
 * drawable geometry Lumiverse uses, so these read at the same weight as the
 * chevrons and folder glyphs already in the drawer.
 */
function createIcon(paths: readonly string[]): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('xmlns', SVG_NS)
  svg.setAttribute('width', '12')
  svg.setAttribute('height', '12')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '1.75')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  // The button carries the accessible name; the icon is decoration.
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')

  for (const d of paths) {
    const path = document.createElementNS(SVG_NS, 'path')
    path.setAttribute('d', d)
    svg.appendChild(path)
  }

  return svg
}

/** Shared button plumbing: never a submit control, never steals the row's ring. */
function baseButton(className: string, accessibleName: string): HTMLButtonElement {
  const button = document.createElement('button')
  // Explicit: these buttons are injected next to Lumiverse's native create /
  // row controls and must never submit a surrounding form.
  button.type = 'button'
  button.className = className
  button.setAttribute('aria-label', accessibleName)
  return button
}

/**
 * The "New folder" affordance shown beside the native create-actions area.
 *
 * Icon + text rather than icon-only: it sits outside a row, so it has no
 * existing accessible name to borrow and an unlabelled icon button next to the
 * native "+" would be ambiguous.
 */
export function createNewFolderButton(params: { onCreate: () => void; label: string }): HTMLButtonElement {
  const button = baseButton('cf-folder-action cf-new-folder-button', params.label)
  button.dataset.cfNewFolder = '1'
  // Stops a click from bubbling into whatever action row we were appended to.
  button.dataset.cfStop = '1'
  button.title = params.label

  button.appendChild(createIcon(FOLDER_PLUS_PATHS))

  const text = document.createElement('span')
  text.className = 'cf-new-folder-label'
  text.textContent = params.label
  button.appendChild(text)

  button.addEventListener('click', (event) => {
    event.stopPropagation()
    params.onCreate()
  })

  return button
}

/**
 * The compact per-row folder affordance.
 *
 * Icon-only with `aria-label` + `title` naming the CURRENT assignment, so the
 * state is discoverable without opening the picker. `currentFolder` is `''` for
 * an unfiled profile.
 *
 * `profileId` is optional only so the button can be built before the wiring
 * layer knows which row it landed on; when present it is stamped as
 * `data-cf-assign` so the row↔profile mapping survives a re-render.
 *
 * `data-cf-stop="1"` is a MARKER only — no code in this extension reads it.
 * The click that must not reach Lumiverse's own row `onSelect` is stopped by
 * the `event.stopPropagation()` in the handler below; the attribute is kept
 * purely as a CSS and test hook, so a stylesheet or a test can identify our
 * buttons inside host-owned markup without relying on class names.
 */
export function createRowFolderButton(params: {
  onClick: () => void
  currentFolder: string
  label: string
  profileId?: string
}): HTMLButtonElement {
  const state = params.currentFolder
    ? `Folder: ${params.currentFolder}`
    : 'No folder set'

  const button = baseButton('cf-folder-action cf-row-folder-button', params.label)
  if (params.profileId) button.dataset.cfAssign = params.profileId
  button.dataset.cfStop = '1'
  // `title` carries the state; `aria-label` carries the action, so a screen
  // reader announces the verb rather than the value.
  button.title = `${params.label} — ${state}`

  button.appendChild(createIcon([FOLDER_PATH]))

  button.addEventListener('click', (event) => {
    event.stopPropagation()
    params.onClick()
  })

  return button
}

/**
 * Styles for the injected buttons.
 *
 * `.cf-root` is used only where the button really does sit inside a
 * `.cf-root` element this extension mounted (the "New folder" inline slot).
 * The per-row assign button is pushed into the HOST's own
 * `[data-component="ConnectionItem"] .itemActions` by `row-affix.ts`, so it has
 * no extension-owned ancestor and must be styled from its own classes. Both
 * approaches are equally safe against leakage: every selector here is
 * namespaced with the extension's own `cf-` class names, which the host can
 * never produce.
 *
 * The upstream modules these classes were ported from style hover and disabled
 * but never a focus state — this sheet adds the `:focus-visible` ring.
 * `outline-offset: -2px` keeps the ring INSIDE the button box so focusing a
 * row button never repaints the row around it.
 */
export const ACTION_STYLES: string = `
/* The label is what makes the non-row button legible; the icon alone is not. */
.cf-root .cf-new-folder-button {
  width: auto;
  height: 24px;
  gap: 5px;
  padding: 0 8px;
  opacity: 1;
}

.cf-root .cf-new-folder-label {
  font-size: calc(11px * var(--lumiverse-font-scale, 1));
  line-height: 1;
}

/* Always visible, ALWAYS. This button also carries \`.cf-folder-action\`, whose
   header-scoped hover-reveal rule (the \`opacity: 0\` declaration in the
   \`Header actions only\` block of styles.ts) would otherwise hide it — the
   button is injected into a native connection row, so neither \`:hover\` nor
   \`:focus-within\` on a folder header row can ever match it and
   \`(any-hover: none)\` is false on desktop. That rule is (0,2,0) and requires
   a \`.cf-folder-header-row\` ancestor this button can never have, so the two
   rules are mutually exclusive at the SELECTOR level rather than by source
   order — this sheet is concatenated after styles.ts regardless. Doubling the
   class here keeps the override at (0,2,0) so it also outranks the plain
   (0,1,0) shared \`.cf-folder-action\` box rule. */
.cf-folder-action.cf-row-folder-button {
  flex-shrink: 0;
  opacity: 1;
}

.cf-folder-action:focus-visible {
  outline: 2px solid var(--lumiverse-primary);
  outline-offset: -2px;
  opacity: 1;
}
`
