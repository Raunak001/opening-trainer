// chess.com Published-Data API client: strictly sequential, 429 → wait and retry.

/**
 * Called directly from the browser: the Published-Data API sends
 * `Access-Control-Allow-Origin: *` (checked from `npm run dev` in T5.1, 2026-11-09: a cross-origin read returned 200). If that
 * ever changes, add a `server.proxy` entry in vite.config.ts and point `baseUrl` at it.
 */
export const CHESSCOM_URL = 'https://api.chess.com/pub'
/** Same rule as the explorer (CLAUDE.md): on 429, wait 60s before retrying. */
export const CHESSCOM_BACKOFF_MS = 60_000
export const CHESSCOM_MAX_RETRIES = 5

export interface ChesscomPlayer {
  username: string
  rating?: number
  /** `win`, `checkmated`, `resigned`, `timeout`, `agreed`, `repetition`, … */
  result: string
}

/** One game as the monthly archive lists it (only the fields this app reads). */
export interface ChesscomGame {
  url: string
  pgn?: string
  /** `bullet` | `blitz` | `rapid` | `daily` */
  time_class: string
  /** `chess` for standard chess; `chess960`, `bughouse`, … for variants. */
  rules: string
  /** Seconds since epoch. */
  end_time: number
  initial_setup?: string
  white: ChesscomPlayer
  black: ChesscomPlayer
}

export class ChesscomError extends Error {
  readonly status: number | undefined

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'ChesscomError'
    this.status = status
  }
}

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>
export type SleepFn = (ms: number, signal?: AbortSignal) => Promise<void>

export interface ChesscomClientOptions {
  fetch?: FetchFn
  sleep?: SleepFn
  baseUrl?: string
  backoffMs?: number
  maxRetries?: number
}

export interface ChesscomClient {
  /** Months with games for the player, oldest first, as `YYYY/MM`. */
  archives(username: string, signal?: AbortSignal): Promise<string[]>
  /** Every game in one monthly archive. */
  month(username: string, month: string, signal?: AbortSignal): Promise<ChesscomGame[]>
}

const MONTH_IN_URL = /\/games\/(\d{4})\/(\d{2})\/?$/

/** `https://api.chess.com/pub/player/x/games/2026/03` → `2026/03`; undefined if not an archive URL. */
export function monthFromArchiveUrl(url: string): string | undefined {
  const m = MONTH_IN_URL.exec(url)
  return m ? `${m[1]}/${m[2]}` : undefined
}

function abortError(): DOMException {
  return new DOMException('The sync was cancelled.', 'AbortError')
}

export const defaultSleep: SleepFn = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError())
    const t = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        reject(abortError())
      },
      { once: true },
    )
  })

/**
 * CLAUDE.md: month URLs one at a time (parallel requests get 429s). Every
 * request goes through one queue, so callers cannot overlap them by accident.
 */
export function createChesscomClient(options: ChesscomClientOptions = {}): ChesscomClient {
  const fetchFn: FetchFn = options.fetch ?? ((url, init) => fetch(url, init))
  const sleep = options.sleep ?? defaultSleep
  const baseUrl = options.baseUrl ?? CHESSCOM_URL
  const backoffMs = options.backoffMs ?? CHESSCOM_BACKOFF_MS
  const maxRetries = options.maxRetries ?? CHESSCOM_MAX_RETRIES
  let tail: Promise<unknown> = Promise.resolve()

  async function getJson(path: string, signal?: AbortSignal): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      if (signal?.aborted) throw abortError()
      const res = await fetchFn(`${baseUrl}${path}`, {
        headers: { Accept: 'application/json' },
        signal,
      })
      if (res.status === 429) {
        if (attempt >= maxRetries)
          throw new ChesscomError(`chess.com rate limit: gave up after ${attempt + 1} tries`, 429)
        await sleep(backoffMs, signal)
        continue
      }
      if (res.status === 404) throw new ChesscomError('No such chess.com player.', 404)
      if (!res.ok)
        throw new ChesscomError(`chess.com request failed: HTTP ${res.status}`, res.status)
      return res.json()
    }
  }

  function queued<T>(path: string, signal?: AbortSignal): Promise<T> {
    const task = tail.then(() => getJson(path, signal)) as Promise<T>
    tail = task.catch(() => undefined)
    return task
  }

  const player = (username: string) => `/player/${encodeURIComponent(username.toLowerCase())}`

  return {
    async archives(username, signal) {
      const data = await queued<{ archives?: string[] }>(
        `${player(username)}/games/archives`,
        signal,
      )
      return (data.archives ?? [])
        .map(monthFromArchiveUrl)
        .filter((m): m is string => m !== undefined)
        .sort()
    },
    async month(username, month, signal) {
      const data = await queued<{ games?: ChesscomGame[] }>(
        `${player(username)}/games/${month}`,
        signal,
      )
      return data.games ?? []
    },
  }
}

let defaultClient: ChesscomClient | undefined

/** App-wide client (shares one request queue). */
export function getChesscomClient(): ChesscomClient {
  defaultClient ??= createChesscomClient()
  return defaultClient
}
