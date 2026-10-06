import { describe, it, expect } from 'bun:test'
import { FolderNameStore, type FolderNameStorage } from '../src/folders/store'

function makeStorage(initial?: unknown): FolderNameStorage & { calls: unknown[][] } {
  const calls: unknown[][] = []
  return {
    calls,
    get: async () => {
      if (initial instanceof Error) throw initial
      return initial
    },
    set: async (key, value) => {
      calls.push([key, value])
    },
  }
}

describe('FolderNameStore.load', () => {
  it('reads a settings row wrapping the array', async () => {
    const store = new FolderNameStore(makeStorage({ value: ['A', 'B'] }), 'connectionFolders')
    expect(await store.load()).toEqual(['A', 'B'])
    expect(store.getNames()).toEqual(['A', 'B'])
  })

  it('accepts a bare array', async () => {
    const store = new FolderNameStore(makeStorage(['A']), 'connectionFolders')
    expect(await store.load()).toEqual(['A'])
  })

  it('returns [] on rejection', async () => {
    const store = new FolderNameStore(makeStorage(new Error('nope')), 'connectionFolders')
    expect(await store.load()).toEqual([])
  })

  it('returns [] on a non-array value', async () => {
    const store = new FolderNameStore(makeStorage({ value: 'nope' }), 'connectionFolders')
    expect(await store.load()).toEqual([])
  })

  it('filters non-string entries', async () => {
    const store = new FolderNameStore(makeStorage({ value: ['A', 3, null, 'B'] }), 'k')
    expect(await store.load()).toEqual(['A', 'B'])
  })
})

describe('FolderNameStore mutations', () => {
  it('creates a folder and persists it', async () => {
    const storage = makeStorage()
    const store = new FolderNameStore(storage, 'connectionFolders')
    expect(await store.create('  Work  ')).toEqual(['Work'])
    expect(storage.calls).toEqual([['connectionFolders', ['Work']]])
  })

  it('create is idempotent', async () => {
    const storage = makeStorage({ value: ['Work'] })
    const store = new FolderNameStore(storage, 'connectionFolders')
    await store.load()
    expect(await store.create('Work')).toEqual(['Work'])
    expect(storage.calls).toHaveLength(0)
  })

  it('create rejects empty names', async () => {
    const storage = makeStorage({ value: ['Work'] })
    const store = new FolderNameStore(storage, 'connectionFolders')
    await store.load()
    expect(await store.create('   ')).toEqual(['Work'])
    expect(storage.calls).toHaveLength(0)
  })

  it('rename moves the name to the end', async () => {
    const storage = makeStorage({ value: ['A', 'B', 'C'] })
    const store = new FolderNameStore(storage, 'connectionFolders')
    await store.load()
    expect(await store.rename('A', 'Z')).toEqual(['B', 'C', 'Z'])
    expect(storage.calls).toHaveLength(1)
  })

  it('rename no-ops when equal or empty', async () => {
    const storage = makeStorage({ value: ['A', 'B'] })
    const store = new FolderNameStore(storage, 'connectionFolders')
    await store.load()
    expect(await store.rename('A', 'A')).toEqual(['A', 'B'])
    expect(await store.rename('A', '  ')).toEqual(['A', 'B'])
    expect(await store.rename('  ', 'C')).toEqual(['A', 'B'])
    expect(storage.calls).toHaveLength(0)
  })

  it('rename does not duplicate an existing target', async () => {
    const storage = makeStorage({ value: ['A', 'B'] })
    const store = new FolderNameStore(storage, 'connectionFolders')
    await store.load()
    expect(await store.rename('A', 'B')).toEqual(['B'])
  })

  it('remove filters the name out', async () => {
    const storage = makeStorage({ value: ['A', 'B'] })
    const store = new FolderNameStore(storage, 'connectionFolders')
    await store.load()
    expect(await store.remove(' A ')).toEqual(['B'])
    expect(storage.calls).toHaveLength(1)
  })

  it('remove is a no-op for an absent name', async () => {
    const storage = makeStorage({ value: ['A'] })
    const store = new FolderNameStore(storage, 'connectionFolders')
    await store.load()
    expect(await store.remove('Z')).toEqual(['A'])
    expect(storage.calls).toHaveLength(0)
  })

  it('save replaces the cache', async () => {
    const storage = makeStorage()
    const store = new FolderNameStore(storage, 'connectionFolders')
    await store.save(['X'])
    expect(store.getNames()).toEqual(['X'])
  })
})

describe('FolderNameStore subscriptions', () => {
  it('notifies subscribers on mutation and stops after unsubscribe', async () => {
    const storage = makeStorage({ value: ['A'] })
    const store = new FolderNameStore(storage, 'connectionFolders')
    await store.load()

    const seen: string[][] = []
    const unsubscribe = store.subscribe((names) => seen.push([...names]))
    await store.create('B')
    unsubscribe()
    await store.create('C')

    expect(seen).toEqual([['A', 'B']])
  })

  it('notify pushes the current cache without persisting', () => {
    const storage = makeStorage()
    const store = new FolderNameStore(storage, 'connectionFolders')
    let count = 0
    store.subscribe(() => { count += 1 })
    store.notify()
    expect(count).toBe(1)
    expect(storage.calls).toHaveLength(0)
  })

  it('persists before notifying', async () => {
    const storage = makeStorage()
    const store = new FolderNameStore(storage, 'connectionFolders')
    let persistedAtNotify = -1
    store.subscribe(() => {
      persistedAtNotify = storage.calls.length
    })
    await store.create('Work')
    expect(persistedAtNotify).toBe(1)
  })
})

describe('FolderNameStore error surfacing', () => {
  it('rejects when storage.set fails', async () => {
    const storage: FolderNameStorage = {
      get: async () => [],
      set: async () => { throw new Error('write failed') },
    }
    const store = new FolderNameStore(storage, 'connectionFolders')
    await expect(store.create('Work')).rejects.toThrow('write failed')
  })

  it('does not notify when persistence fails', async () => {
    const storage: FolderNameStorage = {
      get: async () => [],
      set: async () => { throw new Error('write failed') },
    }
    const store = new FolderNameStore(storage, 'connectionFolders')
    let notified = 0
    store.subscribe(() => { notified += 1 })
    await expect(store.create('Work')).rejects.toThrow()
    expect(notified).toBe(0)
  })
})