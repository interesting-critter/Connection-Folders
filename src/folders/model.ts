/**
 * Folder-name and profile-grouping logic for connection profiles.
 *
 * Connection profiles have no first-class `folder` column, so the assignment
 * lives in `profile.metadata.folder` while the folder NAMES live in a single
 * namespaced settings key. These helpers are pure so the UI can be reasoned
 * about — and unit tested — without a DOM or the Lumiverse runtime.
 */

/**
 * Synthetic group key for profiles that carry no folder. Matches the empty
 * string Lumiverse's folder sorters already treat as "last", so no sentinel
 * needs special-casing at the call sites.
 */
export const UNCATEGORIZED_KEY = '__uncategorized'

export interface NamedFolderGroup {
  folder: string
}

/**
 * Keep named folders in a predictable alphabetical order and place the
 * synthetic Uncategorized group after them.
 */
export function compareFolderNames(a: string, b: string): number {
  if (!a) return b ? 1 : 0
  if (!b) return -1
  return a.localeCompare(b)
}

/** Non-mutating sort so callers can safely keep a render-order snapshot. */
export function sortFolderGroups<T extends NamedFolderGroup>(groups: T[]): T[] {
  return [...groups].sort((a, b) => compareFolderNames(a.folder, b.folder))
}

export interface FolderProfile {
  id: string
  name: string
  metadata?: Record<string, unknown> | null
}

/**
 * Read a profile's folder assignment. Anything that is not a plain string —
 * missing metadata, `null`, a number left behind by a bad write — degrades to
 * the uncategorized bucket instead of poisoning the grouping.
 */
export function getProfileFolder(profile: FolderProfile): string {
  const folder = profile.metadata?.folder
  return typeof folder === 'string' ? folder : ''
}

/**
 * Return a NEW metadata object carrying `folder`. An empty (or whitespace-only)
 * name DELETES the key rather than storing `''`, so removing a profile from a
 * folder leaves no vestigial assignment behind. The input is never mutated
 * because profile objects are shared with the host's store.
 */
export function setProfileFolderMetadata<T extends Record<string, unknown>>(
  metadata: T | null | undefined,
  folder: string,
): T {
  const next: Record<string, unknown> = { ...(metadata ?? {}) }
  if (!folder || !folder.trim()) {
    delete next.folder
  } else {
    next.folder = folder
  }
  return next as T
}

export interface FolderGroup<T> {
  folder: string
  profiles: T[]
}

/**
 * Bucket profiles by their folder assignment, preserving input order within a
 * bucket and putting Uncategorized last.
 */
export function groupProfilesByFolder<T extends FolderProfile>(
  profiles: readonly T[],
): Array<FolderGroup<T>> {
  const groups: Array<FolderGroup<T>> = []
  const folderMap = new Map<string, T[]>()

  for (const profile of profiles) {
    const key = getProfileFolder(profile)
    if (!folderMap.has(key)) {
      const bucket: T[] = []
      folderMap.set(key, bucket)
      groups.push({ folder: key, profiles: bucket })
    }
    folderMap.get(key)!.push(profile)
  }

  return sortFolderGroups(groups)
}

/**
 * Include persisted folders that no profile anywhere uses, then apply the same
 * alphabetical ordering as populated folders. A folder assigned to a profile
 * that is merely absent from the current page must not be presented as empty,
 * or its profile would appear to vanish.
 */
export function includeEmptyFolders<T extends FolderProfile>(
  groups: readonly FolderGroup<T>[],
  storedFolders: readonly string[],
  allProfiles: readonly T[],
): Array<FolderGroup<T>> {
  const visibleFolders = new Set(groups.map((group) => group.folder))
  const populatedFolders = new Set(allProfiles.map((profile) => getProfileFolder(profile)))
  const emptyGroups = storedFolders
    .filter((folder) => folder && !visibleFolders.has(folder) && !populatedFolders.has(folder))
    .map((folder) => ({ folder, profiles: [] as T[] }))

  return sortFolderGroups(emptyGroups.length > 0 ? [...groups, ...emptyGroups] : [...groups])
}

/**
 * Union of stored names and names discovered on profiles, de-duplicated and
 * sorted. A profile assigned to a folder that was never registered still needs
 * to show up in the list, otherwise its bucket would be unreachable.
 */
export function mergeFolderNames(
  storedFolders: readonly string[],
  profiles: readonly FolderProfile[],
): string[] {
  const set = new Set<string>(storedFolders)
  for (const profile of profiles) {
    const folder = getProfileFolder(profile)
    if (folder) set.add(folder)
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b))
}