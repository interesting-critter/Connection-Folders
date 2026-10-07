import { describe, it, expect } from 'bun:test'
import {
  resolveOrder,
  ConnectionFolderApi,
  type ConnectionsOrder,
} from '../src/folders/profile'
import type { ConnectionProfile } from '../src/types'

function profile(id: string, metadata?: Record<string, unknown> | null): ConnectionProfile {
  return {
    id,
    name: `Profile ${id}`,
    provider: 'openai',
    model: 'gpt-test',
    metadata: metadata ?? {},
  }
}

interface FetchCall {
  url: string
  init: RequestInit
}

function stubFetch(
  handler: (call: FetchCall) => Response | Promise<Response>,
): { impl: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = []
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} }
    calls.push(call)
    return handler(call)
  }) as unknown as typeof fetch
  return { impl, calls }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('resolveOrder', () => {
  const profiles = [profile('a'), profile('b'), profile('c')]

  it('returns the input untouched when the order is absent', () => {
    expect(resolveOrder(null, profiles)).toBe(profiles)
  })

  it('returns the input untouched when the order is undefined', () => {
    expect(resolveOrder(undefined, profiles)).toBe(profiles)
  })

  it('returns the input untouched when the order has no llm ids', () => {
    const order: ConnectionsOrder = { llm: [] }
    expect(resolveOrder(order, profiles)).toBe(profiles)
  })

  it('returns the input untouched when llm is absent but other kinds are set', () => {
    const order: ConnectionsOrder = { imageGen: ['c', 'b'], stt: ['a'] }
    expect(resolveOrder(order, profiles)).toBe(profiles)
  })

  it('orders profiles by the llm id list', () => {
    const order: ConnectionsOrder = { llm: ['c', 'a', 'b'] }
    expect(resolveOrder(order, profiles).map((p) => p.id)).toEqual(['c', 'a', 'b'])
  })

  it('prepends profiles the order never mentions (new connections appear at top)', () => {
    const order: ConnectionsOrder = { llm: ['b'] }
    expect(resolveOrder(order, profiles).map((p) => p.id)).toEqual(['a', 'c', 'b'])
  })

  it('skips ids with no matching profile', () => {
    const order: ConnectionsOrder = { llm: ['ghost', 'c', 'missing'] }
    expect(resolveOrder(order, profiles).map((p) => p.id)).toEqual(['a', 'b', 'c'])
  })

  it('ignores a duplicated id rather than emitting the profile twice', () => {
    const order: ConnectionsOrder = { llm: ['a', 'a', 'b'] }
    expect(resolveOrder(order, profiles).map((p) => p.id)).toEqual(['c', 'a', 'b'])
  })

  it('preserves object identity, not just order', () => {
    const order: ConnectionsOrder = { llm: ['b'] }
    const result = resolveOrder(order, profiles)
    // With prepend behavior, missing profiles are prepended: ['a', 'c', 'b']
    // result[0] is the first profile in the input array ('a')
    expect(result[0]).toBe(profiles[0])
  })

  it('does not mutate the input array', () => {
    const before = profiles.map((p) => p.id)
    resolveOrder({ llm: ['c', 'b', 'a'] }, profiles)
    expect(profiles.map((p) => p.id)).toEqual(before)
  })

  it('handles an empty profile list', () => {
    expect(resolveOrder({ llm: ['a'] }, [])).toEqual([])
  })
})

describe('ConnectionFolderApi.setFolder', () => {
  it('PUTs metadata.folder to /api/v1/connections/:id with same-origin credentials', async () => {
    const { impl, calls } = stubFetch(() => jsonResponse({ id: 'abc' }))
    const api = new ConnectionFolderApi(impl)

    await api.setFolder(profile('abc', { keep: 'me' }), 'Work')

    expect(calls).toHaveLength(1)
    const [call] = calls
    expect(call.url).toBe('/api/v1/connections/abc')
    expect(call.init.method).toBe('PUT')
    expect(call.init.credentials).toBe('same-origin')
    expect((call.init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    expect(JSON.parse(call.init.body as string)).toEqual({
      metadata: { keep: 'me', folder: 'Work' },
    })
  })

  it('percent-encodes the profile id in the path', async () => {
    const { impl, calls } = stubFetch(() => jsonResponse({}))
    await new ConnectionFolderApi(impl).setFolder(profile('a/b c'), 'Work')
    expect(calls[0].url).toBe('/api/v1/connections/a%2Fb%20c')
  })

  it('removes the folder key entirely when the folder is empty', async () => {
    const { impl, calls } = stubFetch(() => jsonResponse({}))
    const api = new ConnectionFolderApi(impl)

    await api.setFolder(profile('abc', { folder: 'Work', keep: 'me' }), '')

    const body = JSON.parse(calls[0].init.body as string)
    expect(body).toEqual({ metadata: { keep: 'me' } })
    expect('folder' in body.metadata).toBe(false)
    expect(JSON.stringify(body)).not.toContain('folder')
  })

  it('clearFolder removes the assignment', async () => {
    const { impl, calls } = stubFetch(() => jsonResponse({}))
    await new ConnectionFolderApi(impl).clearFolder(profile('abc', { folder: 'Work' }))
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ metadata: {} })
  })

  it('treats a whitespace-only folder as a removal', async () => {
    const { impl, calls } = stubFetch(() => jsonResponse({}))
    await new ConnectionFolderApi(impl).setFolder(profile('abc', { folder: 'Work' }), '   ')
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ metadata: {} })
  })

  it('creates metadata when the profile has none', async () => {
    const { impl, calls } = stubFetch(() => jsonResponse({}))
    await new ConnectionFolderApi(impl).setFolder(profile('abc', null), 'Work')
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ metadata: { folder: 'Work' } })
  })

  it('does not mutate the caller’s metadata object', async () => {
    const { impl } = stubFetch(() => jsonResponse({}))
    const metadata = { folder: 'Old' }
    const target = profile('abc', metadata)

    await new ConnectionFolderApi(impl).setFolder(target, 'Work')

    expect(metadata).toEqual({ folder: 'Old' })
    expect(target.metadata).toEqual({ folder: 'Old' })
  })

  it('throws with the status on a non-OK response', async () => {
    const { impl } = stubFetch(() => jsonResponse({ error: 'Not found' }, 404))
    const api = new ConnectionFolderApi(impl)

    await expect(api.setFolder(profile('abc'), 'Work')).rejects.toThrow(/404/)
  })

  it('includes the server error text in the thrown message', async () => {
    const { impl } = stubFetch(() => jsonResponse({ error: 'Not found' }, 404))
    await expect(new ConnectionFolderApi(impl).setFolder(profile('abc'), 'Work')).rejects.toThrow(
      /Not found/,
    )
  })

  it('names the profile in the thrown message', async () => {
    const { impl } = stubFetch(() => jsonResponse({}, 500))
    await expect(new ConnectionFolderApi(impl).setFolder(profile('abc'), 'Work')).rejects.toThrow(
      /Profile abc/,
    )
  })

  it('survives a non-JSON error body', async () => {
    const { impl } = stubFetch(
      () => new Response('<html>gateway</html>', { status: 502, headers: { 'Content-Type': 'text/html' } }),
    )
    await expect(new ConnectionFolderApi(impl).setFolder(profile('abc'), 'Work')).rejects.toThrow(/502/)
  })

  it('surfaces a network failure as a rejection', async () => {
    const impl = (async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch
    await expect(new ConnectionFolderApi(impl).setFolder(profile('abc'), 'Work')).rejects.toThrow(
      /Failed to fetch/,
    )
  })
})

describe('ConnectionFolderApi.readOrder', () => {
  it('unwraps a { value } settings row', async () => {
    const { impl, calls } = stubFetch(() => jsonResponse({ key: 'connectionsOrder', value: { llm: ['b', 'a'] } }))
    expect(await new ConnectionFolderApi(impl).readOrder()).toEqual({ llm: ['b', 'a'] })
    expect(calls[0].url).toBe('/api/v1/settings/connectionsOrder')
    expect(calls[0].init.credentials).toBe('same-origin')
  })

  it('accepts a bare object response', async () => {
    const { impl } = stubFetch(() => jsonResponse({ llm: ['c'] }))
    expect(await new ConnectionFolderApi(impl).readOrder()).toEqual({ llm: ['c'] })
  })

  it('keeps the other connection kinds', async () => {
    const { impl } = stubFetch(() => jsonResponse({ value: { llm: ['a'], imageGen: ['b'], stt: [], tts: ['c'] } }))
    expect(await new ConnectionFolderApi(impl).readOrder()).toEqual({
      llm: ['a'],
      imageGen: ['b'],
      stt: [],
      tts: ['c'],
    })
  })

  it('drops non-string entries and non-array kinds', async () => {
    const { impl } = stubFetch(() => jsonResponse({ llm: ['a', 7, null], imageGen: 'nope' }))
    expect(await new ConnectionFolderApi(impl).readOrder()).toEqual({ llm: ['a'] })
  })

  it('returns {} on a 404', async () => {
    const { impl } = stubFetch(() => jsonResponse({ error: 'Not found' }, 404))
    expect(await new ConnectionFolderApi(impl).readOrder()).toEqual({})
  })

  it('returns {} on a 500', async () => {
    const { impl } = stubFetch(() => jsonResponse({ error: 'boom' }, 500))
    expect(await new ConnectionFolderApi(impl).readOrder()).toEqual({})
  })

  it('tolerates a rejected fetch', async () => {
    const impl = (async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch
    expect(await new ConnectionFolderApi(impl).readOrder()).toEqual({})
  })

  it('tolerates a non-JSON 200 body', async () => {
    const { impl } = stubFetch(() => new Response('not json', { status: 200 }))
    expect(await new ConnectionFolderApi(impl).readOrder()).toEqual({})
  })

  it('tolerates a JSON body that is not an object', async () => {
    const { impl } = stubFetch(() => jsonResponse(['a']))
    expect(await new ConnectionFolderApi(impl).readOrder()).toEqual({})
  })

  it('returns {} for a null order value', async () => {
    const { impl } = stubFetch(() => jsonResponse({ key: 'connectionsOrder', value: null }))
    expect(await new ConnectionFolderApi(impl).readOrder()).toEqual({})
  })

  it('feeds resolveOrder directly', async () => {
    const { impl } = stubFetch(() => jsonResponse({ llm: ['b'] }))
    const order = await new ConnectionFolderApi(impl).readOrder()
    const profiles = [profile('a'), profile('b')]
    // With prepend behavior, missing profiles are prepended: ['a', 'b']
    expect(resolveOrder(order, profiles).map((p) => p.id)).toEqual(['a', 'b'])
  })
})
