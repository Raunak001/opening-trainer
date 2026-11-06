import { getDb, type TrainerDB } from '../db'
import { positionKey, type PositionKey } from './positionKey'

export const EXPLORER_URL = 'https://explorer.lichess.ovh/lichess'
/** CLAUDE.md: on 429, wait 60s before retrying. */
export const RATE_LIMIT_BACKOFF_MS = 60_000
export const DEFAULT_MAX_RETRIES = 5

export type Speed = 'ultraBullet' | 'bullet' | 'blitz' | 'rapid' | 'classical' | 'correspondence'

/** Rating bucket lower bounds accepted by the Lichess explorer. */
export type RatingBucket = 400 | 1000 | 1200 | 1400 | 1600 | 1800 | 2000 | 2200 | 2500

export interface ExplorerQuery {
  fen: string
  speeds?: readonly Speed[]
  ratings?: readonly RatingBucket[]
  /** YYYY-MM */
  since?: string
  /** YYYY-MM */
  until?: string
  /** Max moves returned. */
  moves?: number
  topGames?: number
  recentGames?: number
}

export interface ExplorerOpening {
  eco: string
  name: string
}

export interface ExplorerMove {
  uci: string
  san: string
  white: number
  draws: number
  black: number
  averageRating: number
  opening: ExplorerOpening | null
}

export interface ExplorerResponse {
  white: number
  draws: number
  black: number
  moves: ExplorerMove[]
  opening: ExplorerOpening | null
}

/** Storage for explorer responses, keyed by position key + canonical params. */
export interface ExplorerCache {
  get(key: string): Promise<ExplorerResponse | undefined>
  put(key: string, pk: PositionKey, params: string, response: ExplorerResponse): Promise<void>
}

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>
export type SleepFn = (ms: number, signal?: AbortSignal) => Promise<void>

export interface ExplorerClientOptions {
  token: string | undefined
  cache: ExplorerCache
  fetch?: FetchFn
  sleep?: SleepFn
  baseUrl?: string
  backoffMs?: number
  /** Number of 429 retries before giving up. */
  maxRetries?: number
}

export interface ExplorerClient {
  /** Cached response if present, else a queued network fetch. */
  get(query: ExplorerQuery, signal?: AbortSignal): Promise<ExplorerResponse>
}

export class ExplorerError extends Error {
  readonly status: number | undefined

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'ExplorerError'
    this.status = status
  }
}

/**
 * Query params other than the FEN, in a stable order with sorted lists, so
 * equivalent queries share a cache entry.
 */
export function canonicalParams(query: ExplorerQuery): string {
  const p = new URLSearchParams()
  if (query.speeds?.length) p.set('speeds', [...new Set(query.speeds)].sort().join(','))
  if (query.ratings?.length)
    p.set('ratings', [...new Set(query.ratings)].sort((a, b) => a - b).join(','))
  if (query.since !== undefined) p.set('since', query.since)
  if (query.until !== undefined) p.set('until', query.until)
  if (query.moves !== undefined) p.set('moves', String(query.moves))
  if (query.topGames !== undefined) p.set('topGames', String(query.topGames))
  if (query.recentGames !== undefined) p.set('recentGames', String(query.recentGames))
  return p.toString()
}

export function cacheKey(query: ExplorerQuery): string {
  return `${positionKey(query.fen)}|${canonicalParams(query)}`
}

export function explorerUrl(baseUrl: string, query: ExplorerQuery): string {
  const params = canonicalParams(query)
  const fen = new URLSearchParams({ variant: 'standard', fen: query.fen }).toString()
  return `${baseUrl}?${fen}${params ? `&${params}` : ''}`
}

function abortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError')
}

export const defaultSleep: SleepFn = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError())
    const onAbort = () => {
      clearTimeout(timer)
      reject(abortError())
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })

export function createExplorerClient(options: ExplorerClientOptions): ExplorerClient {
  const {
    token,
    cache,
    fetch = globalThis.fetch.bind(globalThis),
    sleep = defaultSleep,
    baseUrl = EXPLORER_URL,
    backoffMs = RATE_LIMIT_BACKOFF_MS,
    maxRetries = DEFAULT_MAX_RETRIES,
  } = options

  // Tail of the request chain: each network fetch starts only after the previous settles.
  let tail: Promise<unknown> = Promise.resolve()
  // Identical concurrent misses share one network request.
  const inFlight = new Map<string, Promise<ExplorerResponse>>()

  async function fetchWithBackoff(query: ExplorerQuery, signal?: AbortSignal) {
    if (!token) throw new ExplorerError('VITE_LICHESS_TOKEN is not set (see .env.example)')
    const url = explorerUrl(baseUrl, query)
    for (let attempt = 0; ; attempt++) {
      if (signal?.aborted) throw abortError()
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal,
      })
      if (res.status === 429) {
        if (attempt >= maxRetries)
          throw new ExplorerError(`Explorer rate limit: gave up after ${attempt + 1} tries`, 429)
        await sleep(backoffMs, signal)
        continue
      }
      if (!res.ok)
        throw new ExplorerError(`Explorer request failed: HTTP ${res.status}`, res.status)
      return (await res.json()) as ExplorerResponse
    }
  }

  function enqueue(key: string, query: ExplorerQuery, signal?: AbortSignal) {
    const task = tail.then(async () => {
      // Another request may have filled the cache while this one waited.
      const cached = await cache.get(key)
      if (cached) return cached
      const response = await fetchWithBackoff(query, signal)
      await cache.put(key, positionKey(query.fen), canonicalParams(query), response)
      return response
    })
    tail = task.catch(() => undefined)
    return task
  }

  return {
    async get(query, signal) {
      const key = cacheKey(query)
      const cached = await cache.get(key)
      if (cached) return cached
      const pending = inFlight.get(key)
      if (pending) return pending
      const task = enqueue(key, query, signal).finally(() => inFlight.delete(key))
      inFlight.set(key, task)
      return task
    },
  }
}

/** Explorer cache backed by the Dexie `explorerCache` table. */
export function dexieExplorerCache(db: TrainerDB): ExplorerCache {
  return {
    async get(key) {
      const row = await db.explorerCache.get(key)
      return row?.response as ExplorerResponse | undefined
    },
    async put(key, pk, params, response) {
      await db.explorerCache.put({ key, positionKey: pk, params, response, fetchedAt: Date.now() })
    },
  }
}

let defaultClient: ExplorerClient | undefined

/** App-wide client: token from `.env.local`, cache in IndexedDB. */
export function getExplorerClient(): ExplorerClient {
  defaultClient ??= createExplorerClient({
    token: import.meta.env.VITE_LICHESS_TOKEN,
    cache: dexieExplorerCache(getDb()),
  })
  return defaultClient
}
