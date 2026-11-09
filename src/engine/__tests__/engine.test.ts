import { describe, expect, it } from 'vitest'
import { createEngine, EngineError, SearchCancelledError, type UciTransport } from '../engine'

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
const AFTER_E4_FEN = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'

/** Fake engine: answers handshakes immediately; searches finish only when the test says so. */
function fakeTransport() {
  const sent: string[] = []
  const lineListeners = new Set<(line: string) => void>()
  const errorListeners = new Set<(error: Error) => void>()
  let searching = false
  let terminated = false

  const emit = (line: string) => {
    for (const l of [...lineListeners]) l(line)
  }

  const transport: UciTransport = {
    send(command) {
      sent.push(command)
      if (command === 'uci') queueMicrotask(() => emit('uciok'))
      else if (command === 'isready') queueMicrotask(() => emit('readyok'))
      else if (command.startsWith('go ')) searching = true
      else if (command === 'stop' && searching) {
        searching = false
        queueMicrotask(() => emit('bestmove a2a3'))
      }
    },
    onLine(listener) {
      lineListeners.add(listener)
      return () => lineListeners.delete(listener)
    },
    onError(listener) {
      errorListeners.add(listener)
      return () => errorListeners.delete(listener)
    },
    terminate() {
      terminated = true
    },
  }

  return {
    transport,
    sent,
    emit,
    get searching() {
      return searching
    },
    get terminated() {
      return terminated
    },
    finish(bestmove: string) {
      searching = false
      emit(bestmove)
    },
    fail(error: Error) {
      for (const l of errorListeners) l(error)
    },
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('createEngine', () => {
  it('handshakes once with uci and isready', async () => {
    const fake = fakeTransport()
    const engine = createEngine(fake.transport)
    await Promise.all([engine.ready(), engine.ready()])
    expect(fake.sent).toEqual(['uci', 'isready'])
  })

  it('runs a search and returns the deepest line per pv', async () => {
    const fake = fakeTransport()
    const engine = createEngine(fake.transport)
    const seen: number[] = []
    const promise = engine.search(START_FEN, { depth: 12 }, { onInfo: (i) => seen.push(i.depth) })
    await flush()

    expect(fake.sent.slice(-2)).toEqual([`position fen ${START_FEN}`, 'go depth 12'])
    fake.emit('info string NNUE evaluation using nn-61e7af4bb97d.nnue enabled')
    fake.emit('info depth 1 seldepth 2 multipv 1 score cp 18 nodes 20 nps 10000 time 2 pv d2d4')
    fake.emit('info depth 12 seldepth 17 multipv 1 score cp 31 nodes 84213 time 120 pv e2e4 e7e5')
    fake.finish('bestmove e2e4 ponder e7e5')

    const result = await promise
    expect(seen).toEqual([1, 12])
    expect(result).toMatchObject({ fen: START_FEN, bestMove: 'e2e4', ponder: 'e7e5' })
    expect(result.lines).toHaveLength(1)
    expect(result.lines[0]).toMatchObject({ depth: 12, score: { type: 'cp', value: 31 } })
  })

  it('sets MultiPV only when it changes and sorts lines', async () => {
    const fake = fakeTransport()
    const engine = createEngine(fake.transport)
    const promise = engine.search(AFTER_E4_FEN, { depth: 8, multiPv: 2 })
    await flush()

    expect(fake.sent).toContain('setoption name MultiPV value 2')
    fake.emit('info depth 8 multipv 2 score cp -45 pv e7e6')
    fake.emit('info depth 8 multipv 1 score cp -28 pv c7c5')
    fake.finish('bestmove c7c5')
    const result = await promise
    expect(result.lines.map((l) => l.pv[0])).toEqual(['c7c5', 'e7e6'])

    const second = engine.search(AFTER_E4_FEN, { depth: 8, multiPv: 2 })
    await flush()
    fake.finish('bestmove c7c5')
    await second
    expect(fake.sent.filter((c) => c.startsWith('setoption'))).toHaveLength(1)
  })

  it('returns a null best move when there is none', async () => {
    const fake = fakeTransport()
    const engine = createEngine(fake.transport)
    const mated = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3'
    const promise = engine.search(mated, { depth: 5 })
    await flush()
    fake.emit('info depth 0 score mate 0')
    fake.finish('bestmove (none)')
    expect(await promise).toMatchObject({ bestMove: null, lines: [] })
  })

  it('a new search cancels the one in flight and waits for its bestmove', async () => {
    const fake = fakeTransport()
    const engine = createEngine(fake.transport)
    const first = engine.search(START_FEN, { depth: 20 })
    const firstOutcome = first.catch((e: unknown) => e)
    await flush()
    expect(fake.searching).toBe(true)

    const second = engine.search(AFTER_E4_FEN, { depth: 10 })
    await flush()
    expect(await firstOutcome).toBeInstanceOf(SearchCancelledError)

    const commands = fake.sent.slice(fake.sent.indexOf('stop'))
    expect(commands).toEqual(['stop', `position fen ${AFTER_E4_FEN}`, 'go depth 10'])

    fake.emit('info depth 10 score cp -30 pv c7c5')
    fake.finish('bestmove c7c5')
    expect((await second).bestMove).toBe('c7c5')
  })

  it('skips searches superseded while queued', async () => {
    const fake = fakeTransport()
    const engine = createEngine(fake.transport)
    const a = engine.search(START_FEN, { depth: 20 }).catch((e: unknown) => e)
    await flush()
    const b = engine.search(AFTER_E4_FEN, { depth: 10 }).catch((e: unknown) => e)
    const c = engine.search(START_FEN, { depth: 5 })
    await flush()

    expect(await a).toBeInstanceOf(SearchCancelledError)
    expect(await b).toBeInstanceOf(SearchCancelledError)
    expect(fake.sent.filter((cmd) => cmd.startsWith('go '))).toEqual(['go depth 20', 'go depth 5'])
    fake.finish('bestmove e2e4')
    expect((await c).bestMove).toBe('e2e4')
  })

  it('cancel() stops the search and drops late info lines', async () => {
    const fake = fakeTransport()
    const engine = createEngine(fake.transport)
    const infos: number[] = []
    const p = engine.search(START_FEN, { depth: 20 }, { onInfo: (i) => infos.push(i.depth) })
    const outcome = p.catch((e: unknown) => e)
    await flush()
    engine.cancel()
    fake.emit('info depth 15 score cp 20 pv e2e4')
    expect(await outcome).toBeInstanceOf(SearchCancelledError)
    expect(infos).toEqual([])
    expect(fake.sent).toContain('stop')
  })

  it('aborts via AbortSignal, before and during a search', async () => {
    const fake = fakeTransport()
    const engine = createEngine(fake.transport)

    const aborted = AbortSignal.abort()
    await expect(
      engine.search(START_FEN, { depth: 5 }, { signal: aborted }),
    ).rejects.toBeInstanceOf(SearchCancelledError)

    const controller = new AbortController()
    const p = engine.search(START_FEN, { depth: 20 }, { signal: controller.signal })
    const outcome = p.catch((e: unknown) => e)
    await flush()
    controller.abort()
    expect(await outcome).toBeInstanceOf(SearchCancelledError)

    // Engine still usable afterwards.
    const next = engine.search(START_FEN, { depth: 3 })
    await flush()
    fake.finish('bestmove e2e4')
    expect((await next).bestMove).toBe('e2e4')
  })

  it('rejects bad depth', async () => {
    const engine = createEngine(fakeTransport().transport)
    await expect(engine.search(START_FEN, { depth: 0 })).rejects.toBeInstanceOf(RangeError)
  })

  it('rejects pending work on a worker error and afterwards', async () => {
    const fake = fakeTransport()
    const engine = createEngine(fake.transport)
    const p = engine.search(START_FEN, { depth: 20 }).catch((e: unknown) => e)
    await flush()
    fake.fail(new EngineError('wasm failed'))
    expect(await p).toBeInstanceOf(EngineError)
    await expect(engine.search(START_FEN, { depth: 5 })).rejects.toThrow('wasm failed')
    await expect(engine.ready()).rejects.toThrow('wasm failed')
  })

  it('dispose rejects the running search and terminates the worker', async () => {
    const fake = fakeTransport()
    const engine = createEngine(fake.transport)
    const p = engine.search(START_FEN, { depth: 20 }).catch((e: unknown) => e)
    await flush()
    engine.dispose()
    const error = await p
    expect(error).toBeInstanceOf(Error)
    expect(fake.sent.slice(-1)).toEqual(['quit'])
    expect(fake.terminated).toBe(true)
    await expect(engine.search(START_FEN, { depth: 5 })).rejects.toThrow('disposed')
  })

  it('sets options between searches and waits for readyok', async () => {
    const fake = fakeTransport()
    const engine = createEngine(fake.transport)
    const search = engine.search(START_FEN, { depth: 20 })
    await flush()
    const option = engine.setOption('Skill Level', 3)
    await flush()
    // Not sent while the search runs.
    expect(fake.sent).not.toContain('setoption name Skill Level value 3')
    fake.finish('bestmove e2e4')
    await search
    await option
    expect(fake.sent.slice(-2)).toEqual(['setoption name Skill Level value 3', 'isready'])
  })
})
