import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { TrainerDB } from '../../db/db'
import { DEFAULT_SETTINGS } from '../../db/settings'
import { positionKey } from '../../repertoire/positionKey'
import { dexieEvalCache } from '../evalCache'
import { gradeForLoss, gradeMove, winPercent } from '../grading'
import { stubEngine } from './stubEngine'

const thresholds = DEFAULT_SETTINGS.moveGrading

const names: string[] = []
const openDb = () => {
  const name = `grading-test-${names.length}`
  names.push(name)
  return new TrainerDB(name)
}
afterEach(async () => {
  for (const n of names.splice(0)) await Dexie.delete(n)
})

describe('winPercent', () => {
  it('matches the Lichess formula', () => {
    expect(winPercent({ type: 'cp', value: 0 })).toBe(50)
    expect(winPercent({ type: 'cp', value: 100 })).toBeCloseTo(59.1026, 3)
    expect(winPercent({ type: 'cp', value: -100 })).toBeCloseTo(40.8974, 3)
    expect(winPercent({ type: 'cp', value: 300 })).toBeCloseTo(75.1126, 3)
  })

  it('clamps at ±1000 cp and treats mates as the clamp', () => {
    const ceiling = winPercent({ type: 'cp', value: 1000 })
    expect(ceiling).toBeCloseTo(97.5447, 3)
    expect(winPercent({ type: 'cp', value: 5000 })).toBe(ceiling)
    expect(winPercent({ type: 'mate', value: 4 })).toBe(ceiling)
    expect(winPercent({ type: 'mate', value: -2 })).toBeCloseTo(100 - ceiling, 10)
    expect(winPercent({ type: 'mate', value: 0 })).toBeCloseTo(100 - ceiling, 10)
  })
})

describe('gradeForLoss', () => {
  it('uses the thresholds from settings', () => {
    expect(gradeForLoss(0, thresholds)).toBe('good')
    expect(gradeForLoss(4.99, thresholds)).toBe('good')
    expect(gradeForLoss(5, thresholds)).toBe('inaccuracy')
    expect(gradeForLoss(10, thresholds)).toBe('mistake')
    expect(gradeForLoss(15, thresholds)).toBe('blunder')
    expect(gradeForLoss(8, { inaccuracy: 2, mistake: 4, blunder: 8 })).toBe('blunder')
  })
})

// 1.e4 e5 2.Nf3 Nc6, White to move. The start, Bb5 and Bc4 scores come from Stockfish 19 lite
// at depth 14; the Ba6 and Ng1 scores are illustrative.
const FEN = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3'
const AFTER = {
  Bb5: 'r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3',
  Bc4: 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3',
  Ba6: 'r1bqkbnr/pppp1ppp/B1n5/4p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3',
  Ng1: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 3 3',
}
const table = {
  [positionKey(FEN)]: { score: { type: 'cp', value: 39 } as const, pv: ['f1b5', 'a7a6'] },
  [positionKey(AFTER.Bb5)]: { score: { type: 'cp', value: -39 } as const, pv: ['a7a6', 'b5a4'] },
  [positionKey(AFTER.Bc4)]: { score: { type: 'cp', value: -23 } as const, pv: ['g8f6', 'd2d3'] },
  [positionKey(AFTER.Ba6)]: { score: { type: 'cp', value: 290 } as const, pv: ['b7a6', 'd2d4'] },
  [positionKey(AFTER.Ng1)]: { score: { type: 'cp', value: 40 } as const, pv: ['g8f6', 'b1c3'] },
}

describe('gradeMove', () => {
  it('grades the engine move as good with zero loss', async () => {
    const { engine } = stubEngine(table)
    const result = await gradeMove(engine, dexieEvalCache(openDb()), FEN, 'Bb5', {
      depth: 14,
      thresholds,
    })
    expect(result).toMatchObject({
      grade: 'good',
      played: { uci: 'f1b5', san: 'Bb5' },
      best: { uci: 'f1b5', san: 'Bb5' },
      loss: 0,
    })
    expect(result.winBefore).toBeCloseTo(winPercent({ type: 'cp', value: 39 }), 10)
  })

  it('grades a slightly worse move as good', async () => {
    const { engine } = stubEngine(table)
    const result = await gradeMove(engine, dexieEvalCache(openDb()), FEN, 'f1c4', {
      depth: 14,
      thresholds,
    })
    expect(result.grade).toBe('good')
    expect(result.played.san).toBe('Bc4')
    expect(result.loss).toBeCloseTo(
      winPercent({ type: 'cp', value: 39 }) - winPercent({ type: 'cp', value: 23 }),
      10,
    )
  })

  it('grades a retreat as an inaccuracy and a piece hang as a blunder', async () => {
    const { engine } = stubEngine(table)
    const cache = dexieEvalCache(openDb())
    const retreat = await gradeMove(engine, cache, FEN, 'Ng1', { depth: 14, thresholds })
    expect(retreat.loss).toBeGreaterThan(5)
    expect(retreat.grade).toBe('inaccuracy')

    const hang = await gradeMove(engine, cache, FEN, 'Ba6', { depth: 14, thresholds })
    expect(hang.grade).toBe('blunder')
    expect(hang.best?.san).toBe('Bb5')
    expect(hang.after.score).toEqual({ type: 'cp', value: 290 })
  })

  it('labels book moves as book', async () => {
    const { engine } = stubEngine(table)
    const result = await gradeMove(engine, dexieEvalCache(openDb()), FEN, 'Ng1', {
      depth: 14,
      thresholds,
      isBook: true,
    })
    expect(result.grade).toBe('book')
  })

  it('loads repeat positions from the cache', async () => {
    const { engine, searched } = stubEngine(table)
    const cache = dexieEvalCache(openDb())
    await gradeMove(engine, cache, FEN, 'Bc4', { depth: 14, thresholds })
    expect(searched).toHaveLength(2)
    await gradeMove(engine, cache, FEN, 'Bc4', { depth: 14, thresholds })
    await gradeMove(engine, cache, FEN, 'Bb5', { depth: 14, thresholds })
    expect(searched).toHaveLength(3) // only the Bb5 position was new
  })

  it('handles delivering and missing mate', async () => {
    // 1.f3 e5 2.g4, Black to move: Qh4#.
    const fen = 'rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2'
    const afterNc6 = 'r1bqkbnr/pppp1ppp/2n5/4p3/6P1/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3'
    const { engine, searched } = stubEngine({
      [positionKey(fen)]: { score: { type: 'mate', value: 1 }, pv: ['d8h4'] },
      [positionKey(afterNc6)]: { score: { type: 'cp', value: -250 }, pv: ['g1h3'] },
    })
    const cache = dexieEvalCache(openDb())

    const mate = await gradeMove(engine, cache, fen, 'Qh4#', { depth: 14, thresholds })
    expect(mate.grade).toBe('good')
    expect(mate.after.score).toEqual({ type: 'mate', value: 0 })
    expect(mate.winAfter).toBeCloseTo(winPercent({ type: 'cp', value: 1000 }), 10)

    const missed = await gradeMove(engine, cache, fen, 'Nc6', { depth: 14, thresholds })
    expect(missed.grade).toBe('blunder')
    expect(searched).toEqual([fen, afterNc6])
  })

  it('rejects illegal moves', async () => {
    const { engine } = stubEngine(table)
    await expect(
      gradeMove(engine, dexieEvalCache(openDb()), FEN, 'Ke2', { depth: 14, thresholds }),
    ).rejects.toThrow()
  })
})
