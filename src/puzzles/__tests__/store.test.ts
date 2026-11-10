import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'
import { TrainerDB } from '../../db'
import { INITIAL_RATING } from '../glicko'
import {
  ensurePuzzles,
  nextPuzzle,
  parsePuzzleData,
  PUZZLE_DATA_URL,
  recordAttempt,
} from '../store'
import { MATE_IN_1, MATE_IN_2, MATERIAL, PROMOTION } from './fixtures'

let n = 0
const openDb = () => new TrainerDB(`puzzle-store-${n++}-${Math.random()}`)

const BUNDLE = {
  fields: ['id', 'fen', 'moves', 'rating', 'themes'],
  puzzles: [MATE_IN_1, MATE_IN_2, PROMOTION, MATERIAL].map((p) => [
    p.id,
    p.fen,
    p.moves.join(' '),
    p.rating,
    p.themes.join(' '),
  ]),
}

const okFetch = () =>
  vi.fn(async () => ({ ok: true, status: 200, json: async () => BUNDLE as unknown }))

describe('parsePuzzleData', () => {
  it('reads the compact bundle format', () => {
    expect(parsePuzzleData(BUNDLE)[1]).toEqual(MATE_IN_2)
  })

  it('rejects malformed data', () => {
    expect(() => parsePuzzleData({})).toThrow('no "puzzles"')
    expect(() => parsePuzzleData({ puzzles: [['x', 'fen']] })).toThrow('row 1')
  })
})

describe('ensurePuzzles', () => {
  it('loads the bundle once', async () => {
    const db = openDb()
    const fetchFn = okFetch()
    expect(await ensurePuzzles(db, fetchFn)).toBe(4)
    expect(await ensurePuzzles(db, fetchFn)).toBe(4)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(fetchFn).toHaveBeenCalledWith(PUZZLE_DATA_URL)
    expect(await db.puzzles.get('0boOL')).toEqual(MATE_IN_2)
  })

  it('reports a failed load', async () => {
    const fetchFn = vi.fn(async () => ({ ok: false, status: 404, json: async () => null }))
    await expect(ensurePuzzles(openDb(), fetchFn)).rejects.toThrow('HTTP 404')
  })
})

describe('rated play', () => {
  it('picks near the rating, records attempts, and moves the rating', async () => {
    const db = openDb()
    await ensurePuzzles(db, okFetch())
    // Start at 1000: the 1433 puzzle is the only one within the 800 window above, but
    // the 500s are closer.
    const first = await nextPuzzle(db, () => 0)
    expect(first?.rating).toBeLessThan(600)

    const win = await recordAttempt(db, {
      puzzle: MATERIAL,
      solved: true,
      hintUsed: false,
      mistakes: 0,
      durationMs: 5000,
      at: new Date(1),
    })
    expect(win.ratingBefore).toBe(INITIAL_RATING.rating)
    expect(win.ratingAfter).toBeGreaterThan(1200)

    const loss = await recordAttempt(db, {
      puzzle: MATE_IN_1,
      solved: false,
      hintUsed: true,
      mistakes: 0,
      durationMs: 3000,
      at: new Date(2),
    })
    expect(loss.ratingBefore).toBe(win.ratingAfter)
    expect(loss.ratingAfter).toBeLessThan(win.ratingAfter)
    expect(await db.puzzleAttempts.count()).toBe(2)
  })

  it('does not repeat a puzzle while unseen ones are near', async () => {
    const db = openDb()
    await ensurePuzzles(db, okFetch())
    const seen = new Set<string>()
    for (let i = 0; i < 3; i++) {
      const p = await nextPuzzle(db, () => 0)
      if (!p) throw new Error('no puzzle')
      expect(seen.has(p.id)).toBe(false)
      seen.add(p.id)
      await recordAttempt(db, {
        puzzle: p,
        solved: false,
        hintUsed: false,
        mistakes: 1,
        durationMs: 1,
        at: new Date(i + 1),
      })
    }
  })
})
