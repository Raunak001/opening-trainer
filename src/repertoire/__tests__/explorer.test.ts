import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TrainerDB } from '../../db'
import {
  cacheKey,
  canonicalParams,
  createExplorerClient,
  dexieExplorerCache,
  ExplorerError,
  explorerUrl,
  RATE_LIMIT_BACKOFF_MS,
  type ExplorerCache,
  type ExplorerQuery,
  type ExplorerResponse,
  type FetchFn,
} from '../explorer'
import {
  AFTER_E4,
  AFTER_E4_RESPONSE,
  ITALIAN_VIA_BC4,
  ITALIAN_VIA_NF3,
  START,
  START_RESPONSE,
} from './fixtures'

const TOKEN = 'test-token'
const BASE = 'https://explorer.test/lichess'

function memoryCache(): ExplorerCache & { rows: Map<string, ExplorerResponse> } {
  const rows = new Map<string, ExplorerResponse>()
  return {
    rows,
    get: async (key) => rows.get(key),
    put: async (key, _pk, _params, response) => {
      rows.set(key, response)
    },
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

interface Deferred {
  url: string
  resolve: (res: Response) => void
}

/** A fetch whose responses the test releases one at a time. */
function controlledFetch() {
  const pending: Deferred[] = []
  const fn = vi.fn<FetchFn>(
    (url) => new Promise<Response>((resolve) => pending.push({ url, resolve })),
  )
  return { fn, pending }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

const fenOf = (url: string) => new URL(url).searchParams.get('fen')

afterEach(() => {
  vi.useRealTimers()
})

describe('query params', () => {
  it('canonicalises list order and duplicates', () => {
    const a: ExplorerQuery = { fen: START, speeds: ['rapid', 'blitz'], ratings: [1800, 1600] }
    const b: ExplorerQuery = {
      fen: START,
      speeds: ['blitz', 'rapid', 'blitz'],
      ratings: [1600, 1800],
    }
    expect(canonicalParams(a)).toBe('speeds=blitz%2Crapid&ratings=1600%2C1800')
    expect(cacheKey(a)).toBe(cacheKey(b))
  })

  it('keys by position, so transpositions share a cache entry', () => {
    const q = { speeds: ['blitz'] } as const
    expect(cacheKey({ fen: ITALIAN_VIA_NF3, ...q })).toBe(cacheKey({ fen: ITALIAN_VIA_BC4, ...q }))
  })

  it('separates different params', () => {
    expect(cacheKey({ fen: START, ratings: [1600] })).not.toBe(
      cacheKey({ fen: START, ratings: [1800] }),
    )
  })

  it('builds the request URL with the full FEN', () => {
    const url = new URL(explorerUrl(BASE, { fen: START, speeds: ['blitz'], moves: 12 }))
    expect(url.origin + url.pathname).toBe(BASE)
    expect(url.searchParams.get('variant')).toBe('standard')
    expect(url.searchParams.get('fen')).toBe(START)
    expect(url.searchParams.get('speeds')).toBe('blitz')
    expect(url.searchParams.get('moves')).toBe('12')
  })
})

describe('createExplorerClient', () => {
  it('sends the Bearer token and caches the response', async () => {
    const fetch = vi.fn<FetchFn>(async () => json(START_RESPONSE))
    const cache = memoryCache()
    const client = createExplorerClient({ token: TOKEN, cache, fetch, baseUrl: BASE })

    await expect(client.get({ fen: START })).resolves.toEqual(START_RESPONSE)

    expect(fetch).toHaveBeenCalledOnce()
    const init = fetch.mock.calls[0][1]
    expect(new Headers(init.headers).get('Authorization')).toBe(`Bearer ${TOKEN}`)
    expect(cache.rows.get(cacheKey({ fen: START }))).toEqual(START_RESPONSE)
  })

  it('serves a cache hit without touching the network', async () => {
    const fetch = vi.fn<FetchFn>(async () => json(START_RESPONSE))
    const cache = memoryCache()
    cache.rows.set(cacheKey({ fen: START }), START_RESPONSE)
    const client = createExplorerClient({ token: TOKEN, cache, fetch, baseUrl: BASE })

    await expect(client.get({ fen: START })).resolves.toEqual(START_RESPONSE)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('hits the cache for a transposed position on the second request', async () => {
    const fetch = vi.fn<FetchFn>(async () => json(AFTER_E4_RESPONSE))
    const client = createExplorerClient({ token: TOKEN, cache: memoryCache(), fetch })

    await client.get({ fen: ITALIAN_VIA_NF3 })
    await client.get({ fen: ITALIAN_VIA_BC4 })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('runs network requests strictly one at a time, in order', async () => {
    const { fn, pending } = controlledFetch()
    const client = createExplorerClient({ token: TOKEN, cache: memoryCache(), fetch: fn })

    const first = client.get({ fen: START })
    const second = client.get({ fen: AFTER_E4 })
    await flush()

    expect(fn).toHaveBeenCalledTimes(1)
    expect(fenOf(pending[0].url)).toBe(START)

    pending[0].resolve(json(START_RESPONSE))
    await expect(first).resolves.toEqual(START_RESPONSE)
    await flush()

    expect(fn).toHaveBeenCalledTimes(2)
    expect(fenOf(pending[1].url)).toBe(AFTER_E4)
    pending[1].resolve(json(AFTER_E4_RESPONSE))
    await expect(second).resolves.toEqual(AFTER_E4_RESPONSE)
  })

  it('keeps the queue moving after a failed request', async () => {
    const fetch = vi
      .fn<FetchFn>()
      .mockResolvedValueOnce(json({ error: 'boom' }, 500))
      .mockResolvedValueOnce(json(AFTER_E4_RESPONSE))
    const client = createExplorerClient({ token: TOKEN, cache: memoryCache(), fetch })

    const first = client.get({ fen: START })
    const second = client.get({ fen: AFTER_E4 })
    await expect(first).rejects.toMatchObject({ name: 'ExplorerError', status: 500 })
    await expect(second).resolves.toEqual(AFTER_E4_RESPONSE)
  })

  it('shares one request between identical concurrent misses', async () => {
    const { fn, pending } = controlledFetch()
    const client = createExplorerClient({ token: TOKEN, cache: memoryCache(), fetch: fn })

    const a = client.get({ fen: ITALIAN_VIA_NF3 })
    const b = client.get({ fen: ITALIAN_VIA_BC4 })
    await flush()
    pending[0].resolve(json(AFTER_E4_RESPONSE))

    await expect(Promise.all([a, b])).resolves.toEqual([AFTER_E4_RESPONSE, AFTER_E4_RESPONSE])
    expect(fn).toHaveBeenCalledOnce()
  })

  it('waits 60s after a 429 and retries, holding the queue', async () => {
    const fetch = vi
      .fn<FetchFn>()
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(json(START_RESPONSE))
      .mockResolvedValueOnce(json(AFTER_E4_RESPONSE))
    const sleeps: number[] = []
    let wake = () => {}
    const sleep = vi.fn((ms: number) => {
      sleeps.push(ms)
      return new Promise<void>((resolve) => (wake = resolve))
    })
    const client = createExplorerClient({ token: TOKEN, cache: memoryCache(), fetch, sleep })

    const first = client.get({ fen: START })
    const second = client.get({ fen: AFTER_E4 })
    await flush()

    expect(sleeps).toEqual([RATE_LIMIT_BACKOFF_MS])
    expect(RATE_LIMIT_BACKOFF_MS).toBe(60_000)
    // Backing off: the queued request must not jump ahead.
    expect(fetch).toHaveBeenCalledTimes(1)

    wake()
    await expect(first).resolves.toEqual(START_RESPONSE)
    await expect(second).resolves.toEqual(AFTER_E4_RESPONSE)
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(fenOf(fetch.mock.calls[1][0])).toBe(START)
  })

  it('backs off with real timers', async () => {
    vi.useFakeTimers()
    const fetch = vi
      .fn<FetchFn>()
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(json(START_RESPONSE))
    const client = createExplorerClient({ token: TOKEN, cache: memoryCache(), fetch })

    const result = client.get({ fen: START })
    await vi.advanceTimersByTimeAsync(RATE_LIMIT_BACKOFF_MS - 1)
    expect(fetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await expect(result).resolves.toEqual(START_RESPONSE)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('gives up after maxRetries rate-limit responses', async () => {
    const fetch = vi.fn<FetchFn>(async () => new Response(null, { status: 429 }))
    const sleep = vi.fn(async () => {})
    const client = createExplorerClient({
      token: TOKEN,
      cache: memoryCache(),
      fetch,
      sleep,
      maxRetries: 2,
    })

    await expect(client.get({ fen: START })).rejects.toMatchObject({ status: 429 })
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenCalledTimes(2)
  })

  it('fails clearly without a token and never calls the network', async () => {
    const fetch = vi.fn<FetchFn>()
    const client = createExplorerClient({ token: undefined, cache: memoryCache(), fetch })

    await expect(client.get({ fen: START })).rejects.toBeInstanceOf(ExplorerError)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('stops when aborted during backoff', async () => {
    const fetch = vi.fn<FetchFn>(async () => new Response(null, { status: 429 }))
    const controller = new AbortController()
    const client = createExplorerClient({ token: TOKEN, cache: memoryCache(), fetch })

    const result = client.get({ fen: START }, controller.signal)
    await flush()
    controller.abort()

    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetch).toHaveBeenCalledOnce()
  })
})

describe('dexieExplorerCache', () => {
  let db: TrainerDB | undefined

  afterEach(async () => {
    await db?.delete()
    db = undefined
  })

  it('persists responses so a new client makes zero network calls', async () => {
    db = new TrainerDB('explorer-cache-test')
    const query: ExplorerQuery = { fen: START, speeds: ['blitz', 'rapid'], ratings: [1600, 1800] }

    const fetch1 = vi.fn<FetchFn>(async () => json(START_RESPONSE))
    await createExplorerClient({ token: TOKEN, cache: dexieExplorerCache(db), fetch: fetch1 }).get(
      query,
    )
    expect(fetch1).toHaveBeenCalledOnce()

    const row = await db.explorerCache.get(cacheKey(query))
    expect(row).toMatchObject({
      positionKey: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -',
      params: 'speeds=blitz%2Crapid&ratings=1600%2C1800',
      response: START_RESPONSE,
    })

    const fetch2 = vi.fn<FetchFn>()
    const again = await createExplorerClient({
      token: TOKEN,
      cache: dexieExplorerCache(db),
      fetch: fetch2,
    }).get({ ...query, speeds: ['rapid', 'blitz'] })
    expect(again).toEqual(START_RESPONSE)
    expect(fetch2).not.toHaveBeenCalled()
  })
})
