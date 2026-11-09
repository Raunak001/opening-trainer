// Promise API over a UCI engine. Transport-agnostic so tests can drive it with a fake.

import { parseBestMove, parseInfo, type InfoLine } from './uci'

/** Line-oriented channel to a UCI engine (a Web Worker in the app, a fake in tests). */
export interface UciTransport {
  send(command: string): void
  /** Subscribe to engine output, one call per line. Returns an unsubscribe function. */
  onLine(listener: (line: string) => void): () => void
  /** Subscribe to fatal transport errors (e.g. the worker failed to load). */
  onError(listener: (error: Error) => void): () => void
  terminate(): void
}

export interface SearchOptions {
  depth: number
  /** Number of principal variations; defaults to 1. */
  multiPv?: number
}

export interface SearchCallbacks {
  /** Called for every scored `info` line as the search deepens. */
  onInfo?: (info: InfoLine) => void
  signal?: AbortSignal
}

export interface SearchResult {
  fen: string
  /** UCI move, or null when the side to move has no legal move. */
  bestMove: string | null
  ponder?: string
  /** Latest scored line per PV, sorted by multipv (index 0 = best). Scores are side-to-move POV. */
  lines: InfoLine[]
}

export interface Engine {
  /** Resolves once `uciok` and `readyok` have been seen. Safe to call repeatedly. */
  ready(): Promise<void>
  /**
   * Searches `fen`. Only one search runs at a time: starting a new one cancels the one in
   * flight (and any still waiting), which reject with `SearchCancelledError`.
   */
  search(fen: string, options: SearchOptions, callbacks?: SearchCallbacks): Promise<SearchResult>
  /** Cancels the running search and any queued ones. */
  cancel(): void
  /**
   * Sends `setoption name <name> value <value>` once the engine is idle (after any running
   * search) and waits for `readyok`. Searches started afterwards use the new value.
   */
  setOption(name: string, value: string | number): Promise<void>
  /** Stops the engine and rejects anything pending. The engine is unusable afterwards. */
  dispose(): void
}

export class SearchCancelledError extends Error {
  constructor() {
    super('Search cancelled')
    this.name = 'SearchCancelledError'
  }
}

export class EngineError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EngineError'
  }
}

/** Public path of the lite single-threaded build copied by scripts/copy-engine.mjs. */
export const STOCKFISH_URL = `${import.meta.env.BASE_URL}engine/stockfish.js`

/** Runs Stockfish.js in a classic Web Worker loaded by URL (never bundled). */
export function createWorkerTransport(url: string = STOCKFISH_URL): UciTransport {
  const worker = new Worker(url)
  const lineListeners = new Set<(line: string) => void>()
  const errorListeners = new Set<(error: Error) => void>()

  worker.onmessage = (event: MessageEvent<unknown>) => {
    if (typeof event.data !== 'string') return
    for (const line of event.data.split('\n')) {
      if (line.trim() === '') continue
      for (const listener of lineListeners) listener(line)
    }
  }
  worker.onerror = (event: ErrorEvent) => {
    const error = new EngineError(`Engine worker failed: ${event.message || 'unknown error'}`)
    for (const listener of errorListeners) listener(error)
  }

  return {
    send: (command) => worker.postMessage(command),
    onLine(listener) {
      lineListeners.add(listener)
      return () => lineListeners.delete(listener)
    },
    onError(listener) {
      errorListeners.add(listener)
      return () => errorListeners.delete(listener)
    },
    terminate: () => worker.terminate(),
  }
}

interface ActiveSearch {
  fen: string
  infos: Map<number, InfoLine>
  onInfo?: (info: InfoLine) => void
  cancelled: boolean
  resolve: (result: SearchResult) => void
  reject: (error: Error) => void
}

interface Waiter {
  token: string
  resolve: () => void
  reject: (error: Error) => void
}

export function createEngine(transport: UciTransport): Engine {
  let disposed = false
  let fatal: Error | null = null
  let readyPromise: Promise<void> | null = null
  let multiPv = 1
  /** Bumped by every search/cancel; a queued search runs only if it is still the latest. */
  let generation = 0
  let active: ActiveSearch | null = null
  /** Settles when the previous search's `bestmove` has arrived (or it never started). */
  let idle: Promise<void> = Promise.resolve()
  const waiters: Waiter[] = []

  function failAll(error: Error) {
    fatal = error
    for (const waiter of waiters.splice(0)) waiter.reject(error)
    if (active) {
      active.reject(error)
      active = null
    }
  }

  transport.onError(failAll)

  transport.onLine((line) => {
    const head = line.trimStart().split(/\s+/, 1)[0]
    if (head === 'info' && active) {
      const info = parseInfo(line)
      if (info && !active.cancelled) {
        active.infos.set(info.multipv, info)
        active.onInfo?.(info)
      }
      return
    }
    if (head === 'bestmove' && active) {
      const best = parseBestMove(line)
      const search = active
      active = null
      if (search.cancelled) {
        search.reject(new SearchCancelledError())
      } else {
        const lines = [...search.infos.values()].sort((a, b) => a.multipv - b.multipv)
        const result: SearchResult = { fen: search.fen, bestMove: best?.move ?? null, lines }
        if (best?.ponder) result.ponder = best.ponder
        search.resolve(result)
      }
      return
    }
    // uciok / readyok
    const index = waiters.findIndex((w) => w.token === head)
    if (index !== -1) waiters.splice(index, 1)[0].resolve()
  })

  function expect(token: string, command: string): Promise<void> {
    if (fatal) return Promise.reject(fatal)
    return new Promise((resolve, reject) => {
      waiters.push({ token, resolve, reject })
      transport.send(command)
    })
  }

  function assertUsable() {
    if (disposed) throw new EngineError('Engine disposed')
    if (fatal) throw fatal
  }

  function ready(): Promise<void> {
    try {
      assertUsable()
    } catch (error) {
      return Promise.reject(error)
    }
    readyPromise ??= (async () => {
      await expect('uciok', 'uci')
      await expect('readyok', 'isready')
    })()
    return readyPromise
  }

  function stopActive() {
    if (active && !active.cancelled) {
      active.cancelled = true
      transport.send('stop')
    }
  }

  function cancel() {
    generation++
    stopActive()
  }

  async function search(
    fen: string,
    options: SearchOptions,
    callbacks: SearchCallbacks = {},
  ): Promise<SearchResult> {
    assertUsable()
    if (!Number.isInteger(options.depth) || options.depth < 1) {
      throw new RangeError(`depth must be a positive integer, got ${options.depth}`)
    }
    const { signal, onInfo } = callbacks
    if (signal?.aborted) throw new SearchCancelledError()

    const myGeneration = ++generation
    stopActive()

    // Wait for the previous search's bestmove before reusing the engine.
    const previous = idle
    let markIdle!: () => void
    idle = new Promise<void>((resolve) => (markIdle = resolve))

    try {
      await previous
      await ready()
      if (myGeneration !== generation || signal?.aborted) throw new SearchCancelledError()
      assertUsable()

      const wantPv = options.multiPv ?? 1
      if (wantPv !== multiPv) {
        transport.send(`setoption name MultiPV value ${wantPv}`)
        multiPv = wantPv
        await expect('readyok', 'isready')
        if (myGeneration !== generation || signal?.aborted) throw new SearchCancelledError()
      }

      const result = new Promise<SearchResult>((resolve, reject) => {
        active = { fen, infos: new Map(), onInfo, cancelled: false, resolve, reject }
      })
      const onAbort = () => {
        if (myGeneration === generation) cancel()
      }
      signal?.addEventListener('abort', onAbort, { once: true })

      transport.send(`position fen ${fen}`)
      transport.send(`go depth ${options.depth}`)
      try {
        return await result
      } finally {
        signal?.removeEventListener('abort', onAbort)
      }
    } finally {
      markIdle()
    }
  }

  async function setOption(name: string, value: string | number): Promise<void> {
    assertUsable()
    await ready()
    const previous = idle
    let markIdle!: () => void
    idle = new Promise<void>((resolve) => (markIdle = resolve))
    try {
      await previous
      assertUsable()
      transport.send(`setoption name ${name} value ${value}`)
      await expect('readyok', 'isready')
    } finally {
      markIdle()
    }
  }

  function dispose() {
    if (disposed) return
    cancel()
    disposed = true
    failAll(new EngineError('Engine disposed'))
    transport.send('quit')
    transport.terminate()
  }

  return { ready, search, cancel, setOption, dispose }
}
