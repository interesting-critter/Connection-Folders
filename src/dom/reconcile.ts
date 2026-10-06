/**
 * Mutation-driven reconcile scheduler.
 *
 * The host list changes for reasons we cannot observe: a profile is added, a
 * drag reorders rows, a row enters/leaves edit mode (which adds and removes the
 * second `[data-component="ConnectionItem"]` wrapper). Rather than diffing on a
 * timer, we watch the list and coalesce.
 *
 * Loop safety is the whole design problem here, because our own writes are
 * mutations:
 *
 *  - Every burst collapses into ONE reconcile via a single pending frame. A
 *    `schedule()` while a frame is already queued is a no-op, so a reconcile
 *    that itself triggers mutations cannot queue an unbounded chain.
 *  - Mutations whose target sits inside one of our `[data-cf-folder]` headers
 *    are ignored outright. Attribute writes to `aria-expanded` and class
 *    changes on the chevron would otherwise re-trigger the observer forever.
 *  - Adding a child list (`childList`) whose added node is a header is ignored
 *    too — inserting an element that was just built is not new information.
 *
 * The document-level `lumiverse:folders-updated` CustomEvent (dispatched on
 * `window` by Lumiverse's own `useFolders` hook,
 * frontend/src/hooks/useFolders.ts ~lines 6-50) also schedules a reconcile, so
 * a folder created in another panel — the Character Browser, Persona or Regex
 * tabs all share that hook — is picked up even though the connection list itself
 * did not change.
 */

export interface ReconcileHandle {
  dispose(): void
}

export interface ReconcilerDeps {
  /** The list container to watch. */
  list: HTMLElement
  /** Caller-provided callback; must be cheap and idempotent. */
  schedule: () => void
}

/** Selectors identifying extension-owned elements. */
const OWN_ELEMENT_SELECTOR = '[data-cf-folder], [data-cf-assign], [data-cf-new-folder], .cf-root'

/** Event Lumiverse's `useFolders` hook dispatches on `window`. */
const FOLDERS_UPDATED_EVENT = 'lumiverse:folders-updated'

/** True when the mutation happened inside an element we injected. */
function isOwnMutation(target: Node | null): boolean {
  if (!target || !(target as Element).closest) return false
  const el = target as Element
  return Boolean(el.closest(OWN_ELEMENT_SELECTOR))
}

/** True when every added/removed node in the record is extension-owned. */
function isOwnChildList(record: MutationRecord): boolean {
  const nodes = [...record.addedNodes, ...record.removedNodes]
  if (nodes.length === 0) return false
  return nodes.every(
    (node) =>
      node.nodeType === 1 &&
      ((node as Element).matches?.(OWN_ELEMENT_SELECTOR) ||
        Boolean((node as Element).closest?.(OWN_ELEMENT_SELECTOR))),
  )
}

export function createReconciler(deps: ReconcilerDeps): ReconcileHandle {
  let frame: number | null = null
  let disposed = false

  const flush = (): void => {
    frame = null
    if (disposed) return
    deps.schedule()
  }

  const schedule = (): void => {
    if (disposed || frame !== null) return
    if (typeof requestAnimationFrame === 'function') {
      frame = requestAnimationFrame(flush)
    } else {
      // No rAF (headless/SSR-ish): a resolved-promise microtask still coalesces
      // a synchronous burst, which is the case we actually need to handle.
      frame = 1
      void Promise.resolve().then(flush)
    }
  }

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (isOwnMutation(record.target)) continue
      if (record.type === 'childList' && isOwnChildList(record)) continue
      schedule()
      return
    }
  })

  observer.observe(deps.list, {
    subtree: true,
    childList: true,
    attributes: true,
  })

  const onFoldersUpdated = (): void => schedule()
  if (typeof window !== 'undefined') {
    window.addEventListener(FOLDERS_UPDATED_EVENT, onFoldersUpdated)
  }

  return {
    dispose(): void {
      if (disposed) return
      disposed = true
      observer.disconnect()
      if (typeof window !== 'undefined') {
        window.removeEventListener(FOLDERS_UPDATED_EVENT, onFoldersUpdated)
      }
      if (frame !== null) {
        if (typeof cancelAnimationFrame === 'function' && frame !== 1) cancelAnimationFrame(frame)
        frame = null
      }
    },
  }
}
