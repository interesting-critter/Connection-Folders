/**
 * Structural location of Lumiverse's Connections list.
 *
 * NOTHING here may reference a hashed CSS-module class. The list container
 * (`ConnectionManager.module.css` `.list`) has no id and no `data-*` attribute,
 * so the only stable contract is the shape of the markup:
 *
 *   <div class="<hashed .list>">          display:flex; flex-direction:column
 *     <div data-component="ConnectionItem" style="transform:…"> … </div>
 *     <div data-component="ConnectionItem" …/>
 *     …
 *   </div>
 *
 * `data-component="ConnectionItem"` is emitted ONLY by
 * frontend/src/components/panels/connection-manager/ConnectionItem.tsx (line
 * 292 for the row root, line 294 for the nested editing wrapper), so it is the
 * one anchor we can rely on. Two consequences we must honour:
 *
 *  1. While a row is being edited there are TWO matching elements per row. Only
 *     DIRECT children of the list are rows — the nested one is inside the row's
 *     inline edit form and would double-count it.
 *  2. The row root carries no profile id. Row → profile mapping is positional:
 *     direct children in DOM order correspond 1:1 to the `orderedProfiles`
 *     array the host rendered (ConnectionManager.tsx ~line 48 / ~line 228). The
 *     caller supplies that array; we only produce the rows.
 *
 * `isFlexColumn` doubles as our capability probe. Injecting `order` into a
 * non-flex container would do nothing visible, and collapsing via `display:none`
 * would fight whatever else owns the layout — so an unsupported list has to be
 * detected, reported and left completely alone.
 */

/** Everything the DOM layer needs from the host, resolved once. */
export interface HostRefs {
  /** The drawer tab root (`data-spindle-drawer-tab="connections"`). */
  tabRoot: HTMLElement
  /** The flex-column list container that holds the rows. */
  list: HTMLElement
  /** Direct-child rows, in DOM order. Index-aligned with `orderedProfiles`. */
  rows: HTMLElement[]
}

/** Attribute marking the row root (and its nested edit wrapper). */
const ROW_SELECTOR = '[data-component="ConnectionItem"]'

/** Attribute Lumiverse's drawer-tab registry stamps on a mounted tab root. */
const TAB_SELECTOR = '[data-spindle-drawer-tab="connections"]'

function docOf(scope?: ParentNode): Document | null {
  if (scope && 'ownerDocument' in scope && scope.ownerDocument) return scope.ownerDocument as Document
  if (typeof document !== 'undefined') return document
  return null
}

/** The node to search: the caller's scope, else the ambient document. */
function rootOf(scope?: ParentNode): ParentNode | null {
  return scope ?? docOf(scope)
}

/**
 * Find the Connections drawer tab root.
 *
 * Prefers the attribute the host stamps on mounted tab roots
 * (frontend/src/lib/drawer-tab-registry.tsx ~line 536). When that is missing —
 * Lumiverse renders the panel through other paths too — fall back to a purely
 * structural guess: the topmost ancestor of a connection row that still lives
 * inside `scope`. Returns null when the tab is not mounted.
 */
export function locateTabRoot(scope?: ParentNode): HTMLElement | null {
  const doc = docOf(scope)
  const root = rootOf(scope)
  if (!root) return null

  if ((root as HTMLElement).matches?.(TAB_SELECTOR)) return root as HTMLElement
  const marked = root.querySelector<HTMLElement>(TAB_SELECTOR)
  if (marked) return marked

  const row = root.querySelector<HTMLElement>(ROW_SELECTOR)
  if (!row) return null

  // Climb to the highest ancestor still inside `root`, stopping at the
  // document body so a stray extension mounted in `<body>` cannot swallow the
  // whole page as "the tab root".
  const boundary = doc?.body ?? null
  let best: HTMLElement = row
  let node: HTMLElement | null = row.parentElement
  while (node && node !== boundary) {
    best = node
    node = node.parentElement
  }
  return best
}

/**
 * Locate the LLM connection list container.
 *
 * Walks up from the first connection row to the nearest ancestor whose direct
 * children include that row — i.e. the list — then keeps only candidates that
 * pass `isFlexColumn`. Iterating every ancestor (rather than stopping at the
 * first) means a wrapper div added by a future Lumiverse refactor does not
 * silently make the extension a no-op: we simply climb one level further.
 *
 * The embeddings / imageGen / STT / TTS managers cannot be matched because they
 * do not render `data-component="ConnectionItem"` (grep-confirmed: only
 * ConnectionItem.tsx emits it), and they render after the LLM manager in
 * drawer-tab-registry.tsx, so the first flex-column hit is the LLM list.
 */
export function locateList(scope?: ParentNode): HTMLElement | null {
  const root = rootOf(scope)
  if (!root) return null

  const tabRoot = locateTabRoot(root)
  const searchRoot: ParentNode = tabRoot ?? root
  const fromRow = listCandidates(searchRoot).find(isFlexColumn)
  if (fromRow) return fromRow

  return locateEmptyList(searchRoot)
}

/**
 * Locate the LLM connection list when no connection rows currently exist
 * (e.g. fresh install or empty profile list).
 */
function locateEmptyList(scope: ParentNode): HTMLElement | null {
  // 1. If inside .connections-stack, the LLM ConnectionManager is always child 0.
  const stack = (scope as HTMLElement).matches?.('.connections-stack')
    ? (scope as HTMLElement)
    : scope.querySelector<HTMLElement>('.connections-stack')
  if (stack && stack.firstElementChild) {
    const manager = stack.firstElementChild as HTMLElement
    for (const child of Array.from(manager.children)) {
      const candidate = child as HTMLElement
      if (candidate !== manager && isFlexColumn(candidate)) return candidate
    }
    const descendants = manager.querySelectorAll<HTMLElement>('*')
    for (const d of Array.from(descendants)) {
      if (isFlexColumn(d)) return d
    }
  }

  // 2. Structurally locate via createActions / button sibling in the tab.
  const buttons = scope.querySelectorAll<HTMLElement>('button')
  for (const btn of Array.from(buttons)) {
    const parent = btn.parentElement
    if (!parent || !parent.parentElement) continue
    for (const sibling of Array.from(parent.parentElement.children)) {
      const candidate = sibling as HTMLElement
      if (candidate !== parent && isFlexColumn(candidate)) return candidate
    }
  }

  // 3. Any flex column with class containing "list"
  const listNodes = scope.querySelectorAll<HTMLElement>('[class*="list"]')
  for (const node of Array.from(listNodes)) {
    if (isFlexColumn(node)) return node
  }

  return null
}

/**
 * Every ancestor of the first connection row that directly contains a row,
 * innermost first. `locateList` picks the first flex column among them;
 * `describeUnsupported` inspects the innermost so it can report WHY the layout
 * is unusable instead of just saying the list is missing.
 */
function listCandidates(scope: ParentNode): HTMLElement[] {
  const row = scope.querySelector<HTMLElement>(ROW_SELECTOR)
  if (!row) return []

  const candidates: HTMLElement[] = []
  let node: HTMLElement | null = row.parentElement
  while (node) {
    if (hasDirectRow(node)) candidates.push(node)
    node = node.parentElement
  }
  return candidates
}

/** True when at least one DIRECT child of `el` is a connection row. */
function hasDirectRow(el: HTMLElement): boolean {
  const children = el.children
  for (let i = 0; i < children.length; i += 1) {
    const child = children[i] as HTMLElement
    if (child.matches?.(ROW_SELECTOR)) return true
  }
  return false
}

/**
 * Direct children of `list` matching the row selector, in DOM order.
 *
 * Index-aligned with the host's `orderedProfiles`, so `rows[i]` is the row for
 * `orderedProfiles[i]`. Nested wrappers (the editing variant) are excluded.
 */
export function locateRows(list: HTMLElement): HTMLElement[] {
  const rows: HTMLElement[] = []
  const children = list.children
  for (let i = 0; i < children.length; i += 1) {
    const child = children[i] as HTMLElement
    if (child.matches?.(ROW_SELECTOR)) rows.push(child)
  }
  return rows
}

/**
 * Capability probe. The whole technique — injecting headers as flex items and
 * reordering them with `order` — only works when the list is a flex column.
 * Anything else (grid, block, `display: none`, a Lumiverse layout change) means
 * the extension must self-disable rather than corrupt the host's layout.
 */
export function isFlexColumn(el: HTMLElement): boolean {
  if (typeof getComputedStyle !== 'function') return false
  const styles = getComputedStyle(el)
  return styles.display === 'flex' && styles.flexDirection === 'column'
}

/**
 * Resolve all three host references, or null when the host is unusable.
 * Returns null (never throws) so a mounting extension can degrade quietly.
 */
export function locateHost(scope?: ParentNode): HostRefs | null {
  const tabRoot = locateTabRoot(scope)
  if (!tabRoot) return null
  const list = locateList(tabRoot)
  if (!list) return null
  if (!isFlexColumn(list)) return null
  return { tabRoot, list, rows: locateRows(list) }
}

/**
 * Short human-readable reason for the self-disable banner. Returns null when
 * the host looks supported, so callers can simply branch on it.
 */
export function describeUnsupported(scope?: ParentNode): string | null {
  const root = rootOf(scope)
  if (!root) return 'Lumiverse document is not available'

  const tabRoot = locateTabRoot(root)
  if (!tabRoot) return 'Connections tab is not mounted'

  const list = locateList(tabRoot) ?? listCandidates(tabRoot)[0]
  if (!list) return 'Connection list container could not be identified'

  if (!isFlexColumn(list)) {
    const styles = typeof getComputedStyle === 'function' ? getComputedStyle(list) : null
    const display = styles?.display ?? 'unknown'
    const direction = styles?.flexDirection ?? 'unknown'
    return `Connection list is not a flex column (display: ${display}; flex-direction: ${direction})`
  }

  return null
}
