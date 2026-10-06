import { describe, it, expect } from 'bun:test'
import {
  UNCATEGORIZED_KEY,
  compareFolderNames,
  sortFolderGroups,
  getProfileFolder,
  setProfileFolderMetadata,
  groupProfilesByFolder,
  includeEmptyFolders,
  mergeFolderNames,
  type FolderProfile,
} from '../src/folders/model'

function profile(id: string, name: string, folder?: unknown): FolderProfile {
  const metadata = folder === undefined ? {} : { folder }
  return { id, name, metadata }
}

describe('compareFolderNames', () => {
  it('sorts the empty folder last', () => {
    expect(compareFolderNames('', 'Alpha')).toBeGreaterThan(0)
    expect(compareFolderNames('Alpha', '')).toBeLessThan(0)
  })

  it('treats two empty folders as equal', () => {
    expect(compareFolderNames('', '')).toBe(0)
  })

  it('sorts alphabetically', () => {
    expect(compareFolderNames('Alpha', 'Beta')).toBeLessThan(0)
    expect(compareFolderNames('Beta', 'Alpha')).toBeGreaterThan(0)
  })

  it('is case-insensitive by locale default', () => {
    expect(compareFolderNames('alpha', 'Beta')).toBeLessThan(0)
  })
})

describe('sortFolderGroups', () => {
  it('sorts named folders with the empty folder last', () => {
    const groups = [
      { folder: '' },
      { folder: 'Beta' },
      { folder: 'Alpha' },
    ]
    expect(sortFolderGroups(groups).map((g) => g.folder)).toEqual(['Alpha', 'Beta', ''])
  })

  it('does not mutate the input', () => {
    const groups = [{ folder: 'Beta' }, { folder: 'Alpha' }]
    sortFolderGroups(groups)
    expect(groups.map((g) => g.folder)).toEqual(['Beta', 'Alpha'])
  })
})

describe('getProfileFolder', () => {
  it('returns empty string when metadata is missing', () => {
    expect(getProfileFolder({ id: 'a', name: 'A' })).toBe('')
  })

  it('returns empty string when metadata is null', () => {
    expect(getProfileFolder({ id: 'a', name: 'A', metadata: null })).toBe('')
  })

  it('returns empty string when folder is not a string', () => {
    expect(getProfileFolder(profile('a', 'A', 42))).toBe('')
    expect(getProfileFolder(profile('a', 'A', null))).toBe('')
  })

  it('returns the folder when present', () => {
    expect(getProfileFolder(profile('a', 'A', 'Work'))).toBe('Work')
  })
})

describe('setProfileFolderMetadata', () => {
  it('sets the folder on a new object without mutating the input', () => {
    const original: Record<string, unknown> = { other: 1 }
    const next = setProfileFolderMetadata(original, 'Work')
    expect(next).not.toBe(original)
    expect(next).toEqual({ other: 1, folder: 'Work' })
    expect(original).toEqual({ other: 1 })
  })

  it('overwrites an existing folder', () => {
    const next = setProfileFolderMetadata({ folder: 'Old' }, 'New')
    expect(next.folder).toBe('New')
  })

  it('deletes the key when the folder is empty', () => {
    const original = { folder: 'Work', other: 2 }
    const next = setProfileFolderMetadata(original, '')
    expect('folder' in next).toBe(false)
    expect(next).toEqual({ other: 2 })
    expect(original.folder).toBe('Work')
  })

  it('deletes the key when the folder is whitespace', () => {
    const next = setProfileFolderMetadata({ folder: 'Work' }, '   ')
    expect('folder' in next).toBe(false)
  })

  it('accepts null and undefined metadata', () => {
    expect(setProfileFolderMetadata(null, 'Work')).toEqual({ folder: 'Work' })
    expect(setProfileFolderMetadata(undefined, 'Work')).toEqual({ folder: 'Work' })
  })
})

describe('groupProfilesByFolder', () => {
  it('returns nothing for an empty list', () => {
    expect(groupProfilesByFolder([])).toEqual([])
  })

  it('buckets by folder and sorts with Uncategorized last', () => {
    const groups = groupProfilesByFolder([
      profile('1', 'One'),
      profile('2', 'Two', 'Work'),
      profile('3', 'Three', 'Art'),
      profile('4', 'Four', 'Work'),
    ])
    expect(groups.map((g) => g.folder)).toEqual(['Art', 'Work', ''])
    expect(groups[1].profiles.map((p) => p.id)).toEqual(['2', '4'])
  })

  it('uses UNCATEGORIZED_KEY as the uncategorized sentinel', () => {
    expect(UNCATEGORIZED_KEY).toBe('__uncategorized')
    expect(getProfileFolder({ id: 'a', name: 'A' })).toBe('')
  })
})

describe('includeEmptyFolders', () => {
  it('injects unused stored folders', () => {
    const groups = groupProfilesByFolder([profile('1', 'One', 'Art')])
    const next = includeEmptyFolders(groups, ['Art', 'Empty'], [profile('1', 'One', 'Art')])
    expect(next.map((g) => g.folder)).toEqual(['Art', 'Empty'])
    expect(next[1].profiles).toEqual([])
  })

  it('does not duplicate an already visible folder', () => {
    const groups = groupProfilesByFolder([profile('1', 'One', 'Art')])
    const next = includeEmptyFolders(groups, ['Art'], [profile('1', 'One', 'Art')])
    expect(next).toHaveLength(1)
  })

  it('does not inject a folder another profile already uses', () => {
    // `groups` is paginated: 'Work' is populated in the full set only.
    const groups = groupProfilesByFolder([profile('1', 'One', 'Art')])
    const allProfiles = [profile('1', 'One', 'Art'), profile('2', 'Two', 'Work')]
    const next = includeEmptyFolders(groups, ['Work'], allProfiles)
    expect(next.map((g) => g.folder)).toEqual(['Art'])
  })

  it('sorts injected folders in and keeps Uncategorized last', () => {
    const groups = groupProfilesByFolder([profile('1', 'One')])
    const next = includeEmptyFolders(groups, ['Zed', 'Mid'], [profile('1', 'One')])
    expect(next.map((g) => g.folder)).toEqual(['Mid', 'Zed', ''])
  })
})

describe('mergeFolderNames', () => {
  it('unions stored names and discovered names, deduped and sorted', () => {
    const names = mergeFolderNames(
      ['Zed', 'Mid'],
      [profile('1', 'One', 'Alpha'), profile('2', 'Two', 'Mid'), profile('3', 'Three')],
    )
    expect(names).toEqual(['Alpha', 'Mid', 'Zed'])
  })

  it('ignores uncategorized profiles', () => {
    expect(mergeFolderNames([], [{ id: 'a', name: 'A' }])).toEqual([])
  })
})