import type { SpindleFrontendContext } from 'lumiverse-spindle-types'

/**
 * `ctx.dom.addStyle` takes an optional root-scoping argument at runtime that the
 * published typings still omit; declare the shape we rely on locally.
 */
export type ScopedDom = SpindleFrontendContext['dom'] & {
  addStyle(css: string, options?: { scope?: 'global' | 'root' }): () => void
}

/** The subset of a connection profile the folder UI reads. */
export interface ConnectionProfile {
  id: string
  name: string
  provider: string
  model: string
  metadata?: Record<string, unknown> | null
  is_default?: boolean
}

/**
 * Profile shape used by the grouping helpers. Profiles carry no `folder` field,
 * so the assignment is read from `metadata.folder`.
 */
export interface FolderProfile {
  id: string
  name: string
  metadata?: Record<string, unknown> | null
}

/**
 * Connection profile writes are not exposed through the Spindle frontend
 * context, so mutations go over REST with `fetch` against
 * `PUT /api/v1/connections/:id`, carrying the whole metadata object back
 * (the API replaces rather than merges).
 */