/**
 * Visual reordering of the Connections list WITHOUT touching DOM order.
 *
 * React owns these children and dnd-kit owns their transforms. Moving a node
 * would be reverted by the next reconciliation, so instead every managed element
 * — our injected headers and the untouched native rows — gets an inline
 * `order`, which flexbox honours regardless of DOM position. Nothing is
 * inserted before, after, or between a row and its sibling.
 *
 * Two invariants make this safe:
 *
 *  1. Rows carry `transform` / `transition` / `opacity` / `z-index` inline, set
 *     by `useScaledSortableStyle`. React re-writes `style` on drag but never
 *     sets `order`, so our value survives. We therefore touch ONLY `order` and
 *     `display`, and we snapshot any pre-existing inline `display` so clearing
 *     it restores what the host had.
 *  2. Elements we manage but no longer list (a row removed by React while a
 *     drag was in flight, a header whose folder was deleted) MUST be reset. A
 *     stale `order` on a native row would permanently displace it in the host
 *     layout, so bookkeeping is explicit and never a no-op.
 */

/** One element in the flattened `[header, row, header, row, …]` sequence. */
export interface OrderedItem {
  el: HTMLElement
  collapsed: boolean
}

/** Elements this module has ever set `order` on. */
const managed = new Set<HTMLElement>()

/**
 * Inline `display` we found on an element the first time we touched it. `''`
 * means the host had no inline display, so clearing restores exactly that.
 */
const previousDisplay = new Map<HTMLElement, string>()

function clearOne(el: HTMLElement): void {
  if (el.style.order !== '') {
    el.style.order = ''
  }
  if (previousDisplay.has(el)) {
    const orig = previousDisplay.get(el) ?? ''
    if (el.style.display !== orig) {
      el.style.display = orig
    }
    previousDisplay.delete(el)
  }
  managed.delete(el)
}

/**
 * Assign sequential `order` integers (0, 1, 2, …) across `items` in the given
 * order, and hide the collapsed ones with `display: none`.
 *
 * Writes to style.order and style.display are strictly guarded: only changed
 * values are written, preventing spurious MutationObserver attribute records
 * from triggering an infinite reconcile loop.
 *
 * Anything this module previously touched that is absent from `items` is reset
 * first, which is what makes a shrinking list safe.
 */
export function assignOrder(items: ReadonlyArray<OrderedItem>): void {
  const next = new Set<HTMLElement>()

  items.forEach((item, index) => {
    const el = item.el
    next.add(el)
    if (!managed.has(el) && !previousDisplay.has(el)) {
      previousDisplay.set(el, el.style.display)
    }
    managed.add(el)
    const targetOrder = String(index)
    if (el.style.order !== targetOrder) {
      el.style.order = targetOrder
    }
    const targetDisplay = item.collapsed ? 'none' : previousDisplay.get(el) ?? ''
    if (el.style.display !== targetDisplay) {
      el.style.display = targetDisplay
    }
  })

  // Reset elements we used to manage but no longer list.
  for (const el of Array.from(managed)) {
    if (!next.has(el)) clearOne(el)
  }
}

/**
 * Clear `order` and any `display` override we set on `rows`, and forget them.
 * Used on unmount and when the host list is replaced.
 */
export function resetOrder(rows: readonly HTMLElement[]): void {
  for (const el of rows) {
    if (managed.has(el) || previousDisplay.has(el)) {
      clearOne(el)
    } else {
      // Never touched by us, but the caller may be handing us a list we
      // previously corrupted in an earlier session — be defensive without
      // clobbering a host-set order.
      if (el.style.order !== '' && !managed.has(el)) el.style.order = ''
    }
  }
}

/** Test/diagnostic helper: true when we currently manage `el`. */
export function isManaged(el: HTMLElement): boolean {
  return managed.has(el)
}
