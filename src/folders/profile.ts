/**
 * Profile-order resolution and folder-assignment WRITES for connection
 * profiles.
 *
 * Two facts drive this file:
 *
 * 1. Connection profiles have no `folder` column. The assignment lives in
 *    `profile.metadata.folder`, and the backend REPLACES (rather than merges)
 *    the metadata object on `PUT /api/v1/connections/:id`. So a write must send
 *    the whole metadata object back — but never a TOP-LEVEL `folder` key, which
 *    the route's field whitelist would silently drop.
 * 2. Drawer order is NOT the order `ctx.state.get('connections.profiles')`
 *    returns. Lumiverse persists a per-kind drag order in the `connectionsOrder`
 *    setting and the native `ConnectionManager` re-orders against it before
 *    rendering. Without that same pass we cannot tell which profile a given DOM
 *    row belongs to, which is the whole basis for stamping per-row buttons.
 */

import type { ConnectionProfile } from '../types'
import { getProfileFolder, setProfileFolderMetadata } from './model'

/** Every route the extension talks to lives under this base. */
const API_BASE = '/api/v1'

/**
 * Shape of the `connectionsOrder` setting. Only `llm` is meaningful for the
 * Connections drawer tab; the other kinds are declared because the setting is
 * shared across tabs and a partial read must not look like a corrupt row.
 */
export interface ConnectionsOrder {
  llm?: string[]
  imageGen?: string[]
  stt?: string[]
  tts?: string[]
}

/**
 * Apply the persisted `llm` order to a profile list.
 *
 * FAITHFUL PORT of ConnectionManager.tsx lines 48-56. Emits the profiles named
 * in `order.llm` in that sequence (ids with no matching profile are skipped,
 * because a profile can be deleted while its id lingers in the setting), then
 * appends every profile the order never mentioned — a newly created profile is
 * not in the order until it is first dragged.
 *
 * Returns `profiles` UNCHANGED (same reference) when the order is absent or
 * empty, so the common no-order case allocates nothing and the caller can rely
 * on reference equality as a cheap "nothing was reordered" signal.
 */
export function resolveOrder(
  order: ConnectionsOrder | null | undefined,
  profiles: readonly ConnectionProfile[],
): ConnectionProfile[] {
  const llmOrder = order?.llm ?? []
  if (llmOrder.length === 0) return profiles as ConnectionProfile[]

  const byId = new Map<string, ConnectionProfile>()
  for (const profile of profiles) byId.set(profile.id, profile)

  const ordered: ConnectionProfile[] = []
  const seen = new Set<string>()
  for (const id of llmOrder) {
    if (typeof id !== 'string' || seen.has(id)) continue
    const profile = byId.get(id)
    // An id with no profile means the profile was deleted after the order was
    // persisted — skip it rather than emitting a hole in the sequence.
    if (!profile) continue
    seen.add(id)
    ordered.push(profile)
  }

  const missing = profiles.filter((profile) => !seen.has(profile.id))
  // New profiles created by the host appear at the top of the native list,
  // so missing profiles are prepended rather than appended — this keeps the
  // index-based row↔profile mapping in sync with the host's visual order.
  return [...missing, ...ordered]
}

/**
 * Settings rows come back as `{ key, value }`, but tolerate a bare object so a
 * host that inlines the value still works. Anything that is not a plain object
 * degrades to `{}` rather than poisoning the caller.
 */
function extractOrder(body: unknown): ConnectionsOrder {
  const source =
    typeof body === 'object' && body !== null && 'value' in (body as { value?: unknown })
      ? (body as { value?: unknown }).value
      : body

  if (typeof source !== 'object' || source === null) return {}

  const row = source as Record<string, unknown>
  const order: ConnectionsOrder = {}
  for (const key of ['llm', 'imageGen', 'stt', 'tts'] as const) {
    const value = row[key]
    if (!Array.isArray(value)) continue
    order[key] = value.filter((entry): entry is string => typeof entry === 'string')
  }
  return order
}

export class ConnectionFolderApi {
  private readonly fetchImpl: typeof fetch

  constructor(fetchImpl: typeof fetch = globalThis.fetch) {
    this.fetchImpl = (...args) => fetchImpl.call(globalThis, ...args)
  }

  /**
   * Read the persisted drawer order.
   *
   * NEVER THROWS. The order is an optimisation for row↔profile matching, so a
   * missing setting (404 on a fresh install), an offline drawer or a rejected
   * request must all degrade to "no order" — the caller then falls back to the
   * order the state selector returned, which is what the native UI does too.
   */
  async readOrder(): Promise<ConnectionsOrder> {
    let response: Response
    try {
      response = await this.fetchImpl(`${API_BASE}/settings/connectionsOrder`, {
        method: 'GET',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      })
    } catch {
      return {}
    }

    if (!response.ok) return {}

    try {
      return extractOrder(await response.json())
    } catch {
      // A 200 with a non-JSON body means a proxy or an error page answered.
      return {}
    }
  }

  /**
   * Assign `profile` to `folder` (pass `''` to remove the assignment).
   *
   * Sends the FULL next metadata object because the API replaces metadata
   * wholesale. That is safe against Lumiverse's own edit form, which spreads
   * `{...profile?.metadata}` back into its payload, so our key survives a
   * rename performed in the native UI.
   *
   * Rejects with a status-bearing `Error` so the caller can surface something
   * better than "Something went wrong".
   */
  async setFolder(profile: ConnectionProfile, folder: string): Promise<void> {
    const metadata = profile.metadata ?? {}
    const next = setProfileFolderMetadata(metadata, folder)

    const response = await this.fetchImpl(
      `${API_BASE}/connections/${encodeURIComponent(profile.id)}`,
      {
        method: 'PUT',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ metadata: next }),
      },
    )

    if (!response.ok) {
      const detail = await this.readErrorDetail(response)
      throw new Error(
        `Could not ${folder ? 'assign' : 'remove'} a folder for "${profile.name || profile.id}" (HTTP ${response.status})${detail ? `: ${detail}` : ''}`,
      )
    }
  }

  /** Convenience wrapper: drops the assignment instead of storing `''`. */
  async clearFolder(profile: ConnectionProfile): Promise<void> {
    await this.setFolder(profile, '')
  }

  /**
   * Pull the server's error text when there is one. The API answers JSON
   * (`{ error }`) but a proxy or gateway may answer HTML, so parsing is
   * best-effort and never allowed to replace the real error.
   */
  private async readErrorDetail(response: Response): Promise<string> {
    try {
      const body = await response.text()
      if (!body) return ''
      try {
        const parsed = JSON.parse(body) as { error?: unknown }
        if (typeof parsed?.error === 'string') return parsed.error
      } catch {
        // Not JSON — fall through and use the raw (truncated) text.
      }
      return body.slice(0, 200)
    } catch {
      return ''
    }
  }
}

/**
 * Migrate all profiles currently assigned to `oldFolder` to `newFolder`.
 * Calls `api.setFolder` for each matching profile and updates `metadata` in place.
 */
export async function migrateProfilesFolder(
  api: ConnectionFolderApi,
  profiles: ConnectionProfile[],
  oldFolder: string,
  newFolder: string,
): Promise<ConnectionProfile[]> {
  const targets = profiles.filter((p) => getProfileFolder(p) === oldFolder)
  await Promise.all(
    targets.map(async (p) => {
      await api.setFolder(p, newFolder)
      p.metadata = setProfileFolderMetadata(p.metadata, newFolder)
    }),
  )
  return targets
}

/**
 * Clear folder assignment from all profiles currently assigned to `folder`.
 * Calls `api.clearFolder` for each matching profile and removes `metadata.folder` in place.
 */
export async function clearProfilesFolder(
  api: ConnectionFolderApi,
  profiles: ConnectionProfile[],
  folder: string,
): Promise<ConnectionProfile[]> {
  return migrateProfilesFolder(api, profiles, folder, '')
}
