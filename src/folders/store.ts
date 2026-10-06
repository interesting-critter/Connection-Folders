/**
 * Folder-NAME persistence.
 *
 * Storage is injected rather than imported from Lumiverse so the store can be
 * unit tested without the host runtime. Reads are forgiving: a missing or
 * corrupt settings value must not break the drawer.
 */

/**
 * Minimal settings surface the store needs. Satisfied by Lumiverse's
 * `settingsApi.get` / `settingsApi.put` pair.
 */
export interface FolderNameStorage {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
}

/**
 * Cached folder names with synchronous subscribers. Mutations persist BEFORE
 * notifying so a listener that reads the cache can never observe state the
 * host has not accepted yet.
 */
export class FolderNameStore {
  private names: string[] = []
  private readonly listeners = new Set<(names: string[]) => void>()

  constructor(
    private readonly storage: FolderNameStorage,
    private readonly settingsKey: string,
  ) {}

  /** Cached names, as of the last load or mutation. */
  getNames(): string[] {
    return this.names
  }

  /**
   * Hydrate the cache from storage. Never throws: a rejected read or a value of
   * the wrong shape degrades to an empty list rather than surfacing an error
   * the drawer cannot act on.
   */
  async load(): Promise<string[]> {
    try {
      const row = await this.storage.get(this.settingsKey)
      const value = extractNames(row)
      this.names = value
    } catch {
      // Setting doesn't exist yet — that's fine
      this.names = []
    }
    return this.names
  }

  /** Replace the cache wholesale (used by `load` and external refreshes). */
  async save(names: string[]): Promise<void> {
    this.names = [...names]
    await this.storage.set(this.settingsKey, this.names)
    this.notify()
  }

  /**
   * Write `next` only when it differs from the cache, and return the cache
   * either way. Skipping no-op writes keeps a settings row from being touched on
   * every render, and a failed write rolls the cache back so it never advertises
   * state the host rejected.
   */
  private async commit(next: string[]): Promise<string[]> {
    const changed = next.length !== this.names.length || next.some((n, i) => n !== this.names[i])
    if (!changed) return this.names

    const previous = this.names
    this.names = next
    try {
      await this.storage.set(this.settingsKey, this.names)
    } catch (error) {
      this.names = previous
      throw error
    }
    this.notify()
    return this.names
  }

  /**
   * Add a folder name. Returns the resulting list; a duplicate is a no-op so
   * repeated submits cannot produce double entries.
   */
  async create(name: string): Promise<string[]> {
    const folder = name.trim()
    if (!folder) return this.names
    if (this.names.includes(folder)) return this.names
    return this.commit([...this.names, folder])
  }

  /** Move a name to a new value, keeping its position when the target is new. */
  async rename(oldName: string, newName: string): Promise<string[]> {
    const source = oldName.trim()
    const target = newName.trim()
    if (!source || !target || source === target) return this.names

    const next = this.names.filter((f) => f !== source)
    if (!next.includes(target)) next.push(target)
    return this.commit(next)
  }

  /** Drop a name; a name that is not present is a no-op. */
  async remove(name: string): Promise<string[]> {
    const folder = name.trim()
    if (!folder) return this.names
    return this.commit(this.names.filter((f) => f !== folder))
  }

  /** Returns an unsubscribe function. */
  subscribe(listener: (names: string[]) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Push the cached list to every subscriber. Synchronous by design. */
  notify(): void {
    const snapshot = this.names
    for (const listener of this.listeners) listener(snapshot)
  }
}

/**
 * Settings rows arrive wrapped as `{ value }`, but tolerate a bare array too so
 * the store works against either storage shape.
 */
function extractNames(row: unknown): string[] {
  const value =
    Array.isArray(row) ? row : typeof row === 'object' && row !== null ? (row as { value?: unknown }).value : row
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string')
}