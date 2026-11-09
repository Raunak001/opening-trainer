import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { TrainerDB } from '../../db/db'
import { positionKey } from '../../repertoire/positionKey'
import {
  dexieEvalCache,
  evalCacheKey,
  evaluatePosition,
  terminalEval,
  type PositionEval,
} from '../evalCache'
import { stubEngine } from './stubEngine'

const ITALIAN_FEN = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3'
// Same position reached later in a game: different clocks, same key.
const ITALIAN_FEN_LATER = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 7 9'
const FOOLS_MATE_FEN = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3'
const STALEMATE_FEN = '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1'

const names: string[] = []
const openDb = () => {
  const name = `eval-cache-test-${names.length}`
  names.push(name)
  return new TrainerDB(name)
}
afterEach(async () => {
  for (const n of names.splice(0)) await Dexie.delete(n)
})

const evalAt = (depth: number, cp: number): PositionEval => ({
  positionKey: positionKey(ITALIAN_FEN),
  depth,
  score: { type: 'cp', value: cp },
  bestMove: 'g8f6',
  pv: ['g8f6', 'd2d3'],
})

describe('dexieEvalCache', () => {
  it('stores rows keyed by position key + depth', async () => {
    const db = openDb()
    const cache = dexieEvalCache(db, () => 123)
    await cache.put(evalAt(16, -30))
    const row = await db.evalCache.get(evalCacheKey(positionKey(ITALIAN_FEN), 16))
    expect(row).toEqual({
      key: `${positionKey(ITALIAN_FEN)}|16`,
      positionKey: positionKey(ITALIAN_FEN),
      depth: 16,
      scoreCp: -30,
      bestMove: 'g8f6',
      pv: ['g8f6', 'd2d3'],
      createdAt: 123,
    })
  })

  it('returns the deepest eval at or above the requested depth', async () => {
    const cache = dexieEvalCache(openDb())
    const pk = positionKey(ITALIAN_FEN)
    await cache.put(evalAt(12, -20))
    await cache.put(evalAt(20, -35))
    await cache.put(evalAt(16, -30))
    expect((await cache.get(pk, 10))?.depth).toBe(20)
    expect((await cache.get(pk, 20))?.score).toEqual({ type: 'cp', value: -35 })
    expect(await cache.get(pk, 22)).toBeUndefined()
  })

  it('round-trips mate scores', async () => {
    const cache = dexieEvalCache(openDb())
    const mateEval: PositionEval = { ...evalAt(18, 0), score: { type: 'mate', value: -3 } }
    await cache.put(mateEval)
    expect(await cache.get(mateEval.positionKey, 18)).toEqual(mateEval)
  })
})

describe('terminalEval', () => {
  it('scores checkmate as mate 0 and stalemate as 0', () => {
    expect(terminalEval(FOOLS_MATE_FEN, 16)?.score).toEqual({ type: 'mate', value: 0 })
    expect(terminalEval(STALEMATE_FEN, 16)?.score).toEqual({ type: 'cp', value: 0 })
    expect(terminalEval(ITALIAN_FEN, 16)).toBeUndefined()
  })
})

describe('evaluatePosition', () => {
  it('searches once, then serves transpositions from the cache', async () => {
    const db = openDb()
    const cache = dexieEvalCache(db)
    const { engine, searched } = stubEngine({
      [positionKey(ITALIAN_FEN)]: { score: { type: 'cp', value: -30 }, pv: ['g8f6', 'd2d3'] },
    })

    const first = await evaluatePosition(engine, cache, ITALIAN_FEN, { depth: 16 })
    const second = await evaluatePosition(engine, cache, ITALIAN_FEN_LATER, { depth: 16 })
    const shallower = await evaluatePosition(engine, cache, ITALIAN_FEN, { depth: 10 })

    expect(searched).toEqual([ITALIAN_FEN])
    expect(first).toEqual({
      positionKey: positionKey(ITALIAN_FEN),
      depth: 16,
      score: { type: 'cp', value: -30 },
      bestMove: 'g8f6',
      pv: ['g8f6', 'd2d3'],
    })
    expect(second).toEqual(first)
    expect(shallower).toEqual(first)
    expect(await db.evalCache.count()).toBe(1)
  })

  it('searches again when only a shallower eval is cached', async () => {
    const cache = dexieEvalCache(openDb())
    const { engine, searched } = stubEngine({
      [positionKey(ITALIAN_FEN)]: { score: { type: 'cp', value: -30 }, pv: ['g8f6'] },
    })
    await evaluatePosition(engine, cache, ITALIAN_FEN, { depth: 10 })
    await evaluatePosition(engine, cache, ITALIAN_FEN, { depth: 18 })
    expect(searched).toHaveLength(2)
  })

  it('never asks the engine about positions with no legal move', async () => {
    const db = openDb()
    const { engine, searched } = stubEngine({})
    const result = await evaluatePosition(engine, dexieEvalCache(db), FOOLS_MATE_FEN, { depth: 16 })
    expect(result.bestMove).toBeNull()
    expect(searched).toEqual([])
    expect(await db.evalCache.count()).toBe(0)
  })
})
