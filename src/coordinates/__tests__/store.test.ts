import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { nodeId, TrainerDB, type CoordRunRow } from '../../db'
import { bestRuns, catalogPrompts, loadCardPrompts, runKey, saveRound } from '../store'

let n = 0
const openDb = () => new TrainerDB(`coord-store-${n++}-${Math.random()}`)

const run = (over: Partial<CoordRunRow>): Omit<CoordRunRow, 'id'> => ({
  drill: 'find',
  view: 'white',
  at: new Date(0),
  correct: 10,
  wrong: 1,
  durationMs: 30_000,
  ...over,
})

describe('coordinate store', () => {
  it('saves a round, adding to stored square stats', async () => {
    const db = openDb()
    const ans = (square: 'e4' | 'b6', correct: boolean, ms: number) => ({
      mode: 'find' as const,
      view: 'white' as const,
      square,
      correct,
      ms,
      at: 1,
    })
    await saveRound(db, run({}), [ans('e4', true, 1000), ans('b6', false, 3000)])
    await saveRound(db, run({}), [ans('e4', false, 500)])
    expect(await db.coordStats.get('find:white:e4')).toMatchObject({
      attempts: 2,
      misses: 1,
      correctMs: 1000,
    })
    expect(await db.coordStats.get('find:white:b6')).toMatchObject({ attempts: 1, misses: 1 })
    expect(await db.coordRuns.count()).toBe(2)
  })

  it('picks the best run per drill and side', () => {
    const runs = [
      run({ id: 1, correct: 10, wrong: 3 }),
      run({ id: 2, correct: 10, wrong: 1 }),
      run({ id: 3, correct: 8 }),
      run({ id: 4, view: 'black', correct: 4 }),
      run({ id: 5, drill: 'visualize', correct: 9, durationMs: 50_000 }),
      run({ id: 6, drill: 'visualize', correct: 9, durationMs: 40_000 }),
    ] as CoordRunRow[]
    const best = bestRuns(runs)
    expect(best.get(runKey('find', 'white'))?.id).toBe(2)
    expect(best.get(runKey('find', 'black'))?.id).toBe(4)
    expect(best.get(runKey('visualize', 'white'))?.id).toBe(6)
  })

  it('loads move prompts from tree cards only', async () => {
    const db = openDb()
    const fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'
    const key = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -'
    await db.repertoires.put({ id: 'r', name: 'Caro-Kann' } as never)
    await db.nodes.put({ id: nodeId('r', key), repertoireId: 'r', key, fen } as never)
    await db.cards.bulkPut([
      { id: nodeId('r', key), repertoireId: 'r', positionKey: key, answer: 'c6' },
      { id: 'r:gone', repertoireId: 'r', positionKey: 'gone', answer: 'e5', suspended: true },
    ] as never)
    const prompts = await loadCardPrompts(db)
    expect(prompts).toEqual([
      expect.objectContaining({
        san: 'c6',
        from: 'c7',
        to: 'c6',
        view: 'black',
        source: 'Caro-Kann',
      }),
    ])
  })

  it('has a fallback pool for both sides', () => {
    const pool = catalogPrompts()
    expect(pool.some((p) => p.view === 'white')).toBe(true)
    expect(pool.some((p) => p.view === 'black')).toBe(true)
  })
})
