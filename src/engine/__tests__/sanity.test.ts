import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { TrainerDB } from '../../db/db'
import { positionKey } from '../../repertoire/positionKey'
import { dexieEvalCache } from '../evalCache'
import { checkRepertoireMoves, clampedCp } from '../sanity'
import { stubEngine } from './stubEngine'

// 1.e4 e5 2.Nf3 Nc6, White to move.
const NC6 = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3'
const AFTER_BC4 = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3'
const AFTER_H3 = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N1P/PPPP1PP1/RNBQKB1R b KQkq - 0 3'
// 1.e4 e5, White to move.
const E4_E5 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2'

const names: string[] = []
const openDb = () => {
  const name = `sanity-test-${names.length}`
  names.push(name)
  return new TrainerDB(name)
}
afterEach(async () => {
  for (const n of names.splice(0)) await Dexie.delete(n)
})

const table = {
  [positionKey(NC6)]: { score: { type: 'cp', value: 40 } as const, pv: ['f1b5', 'a7a6'] },
  [positionKey(AFTER_BC4)]: { score: { type: 'cp', value: -20 } as const, pv: ['g8f6'] },
  [positionKey(AFTER_H3)]: { score: { type: 'cp', value: 35 } as const, pv: ['g8f6'] },
  [positionKey(E4_E5)]: { score: { type: 'cp', value: 30 } as const, pv: ['g1f3', 'b8c6'] },
}

describe('checkRepertoireMoves', () => {
  it('flags moves losing more than the limit, worst first, and reports progress', async () => {
    const { engine } = stubEngine(table)
    const progress: string[] = []
    const flags = await checkRepertoireMoves(
      engine,
      dexieEvalCache(openDb()),
      [
        { positionKey: positionKey(E4_E5), fen: E4_E5, san: 'Nf3' }, // the engine move
        { positionKey: positionKey(NC6), fen: NC6, san: 'Bc4' }, // loses 20 cp
        { positionKey: positionKey(NC6), fen: NC6, san: 'h3' }, // loses 75 cp
      ],
      { depth: 16, maxCpLoss: 50, onProgress: (d, t) => progress.push(`${d}/${t}`) },
    )
    expect(flags).toEqual([
      {
        positionKey: positionKey(NC6),
        fen: NC6,
        san: 'h3',
        bestSan: 'Bb5',
        cpLoss: 75,
        bestScore: { type: 'cp', value: 40 },
        playedScore: { type: 'cp', value: -35 },
      },
    ])
    expect(progress).toEqual(['0/3', '1/3', '2/3', '3/3'])
  })

  it('does not search after the move when it is the best one', async () => {
    const { engine, searched } = stubEngine(table)
    await checkRepertoireMoves(
      engine,
      dexieEvalCache(openDb()),
      [{ positionKey: positionKey(E4_E5), fen: E4_E5, san: 'Nf3' }],
      { depth: 16, maxCpLoss: 50 },
    )
    expect(searched).toEqual([E4_E5])
  })

  it('stops when aborted', async () => {
    const { engine } = stubEngine(table)
    await expect(
      checkRepertoireMoves(
        engine,
        dexieEvalCache(openDb()),
        [{ positionKey: positionKey(NC6), fen: NC6, san: 'h3' }],
        { depth: 16, maxCpLoss: 50, signal: AbortSignal.abort() },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('clampedCp', () => {
  it('clamps and maps mates to the ceiling', () => {
    expect(clampedCp({ type: 'cp', value: 2500 })).toBe(1000)
    expect(clampedCp({ type: 'mate', value: 3 })).toBe(1000)
    expect(clampedCp({ type: 'mate', value: -1 })).toBe(-1000)
    expect(clampedCp({ type: 'cp', value: -42 })).toBe(-42)
  })
})
