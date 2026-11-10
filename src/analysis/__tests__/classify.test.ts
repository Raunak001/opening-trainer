import { Chess } from 'chess.js'
import { describe, expect, it } from 'vitest'
import type { AnalysisEval } from '../../db/db'
import { DEFAULT_SETTINGS } from '../../db/settings'
import {
  bookPlies,
  gameAccuracy,
  moveAccuracy,
  reviewGame,
  sacrificeValue,
  type MarkThresholds,
} from '../classify'

const T: MarkThresholds = DEFAULT_SETTINGS.analysis
const cp = (value: number, best: string | null, second?: [string, number]): AnalysisEval => ({
  score: { type: 'cp', value },
  best,
  pv: best ? [best] : [],
  ...(second ? { second: { move: second[0], score: { type: 'cp', value: second[1] } } } : {}),
})
const mate = (value: number, best: string | null): AnalysisEval => ({
  score: { type: 'mate', value },
  best,
  pv: best ? [best] : [],
})

describe('accuracy', () => {
  it('scores a move that loses nothing as 100', () => {
    expect(moveAccuracy(50, 50)).toBe(100)
    expect(moveAccuracy(50, 60)).toBe(100)
  })

  it('drops steeply with win% lost (Lichess curve)', () => {
    expect(moveAccuracy(60, 50)).toBeCloseTo(64.6, 1)
    expect(moveAccuracy(90, 10)).toBeCloseTo(1, 0)
  })

  it('is 100 for a side that never lost ground, lower for one that did', () => {
    const flat = [50, 50, 50, 50, 50]
    expect(gameAccuracy(flat, 'white')).toBe(100)
    // Black's first move hands White 30 points.
    const blackErrs = [50, 50, 80, 80, 80]
    expect(gameAccuracy(blackErrs, 'white')).toBe(100)
    expect(gameAccuracy(blackErrs, 'black')).toBeLessThan(80)
  })
})

describe('bookPlies', () => {
  const named = new Set(
    [['e4'], ['e4', 'e5'], ['e4', 'e5', 'Nf3', 'Nc6']].map((line) => {
      const c = new Chess()
      for (const m of line) c.move(m)
      return c.fen()
    }),
  )

  it('runs to the last named position, bridging short unnamed gaps', () => {
    expect(bookPlies(['e4', 'e5', 'Nf3', 'Nc6', 'a3', 'a6'], (f) => named.has(f))).toBe(4)
  })

  it('is 0 when the first move is unnamed', () => {
    expect(bookPlies(['a3', 'e5'], (f) => named.has(f))).toBe(0)
  })
})

describe('sacrificeValue', () => {
  it('sees a bishop given for a pawn (Bxf7+ Kxf7)', () => {
    const fen = 'rnbqkb1r/pppp1ppp/5n2/4p3/2B1P3/8/PPPP1PPP/RNBQK1NR w KQkq - 2 3'
    const move = new Chess(fen).move('Bxf7+')
    expect(sacrificeValue(fen, move, ['e8f7'])).toBe(2)
  })

  it('is 0 for an even trade', () => {
    // 1.e4 d5 2.exd5 Qxd5: the pawn takes, the queen takes back.
    const fen = 'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2'
    const move = new Chess(fen).move('exd5')
    expect(sacrificeValue(fen, move, ['d8d5', 'b1c3'])).toBe(0)
  })
})

describe('reviewGame', () => {
  it("marks Scholar's mate: book, best, blunder", () => {
    const sans = ['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#']
    const evals = [
      cp(30, 'e2e4', ['d2d4', 25]),
      cp(-30, 'e7e5'),
      cp(30, 'g1f3'),
      cp(0, 'b8c6'),
      cp(0, 'f1c4'),
      cp(0, 'g7g6', ['d8e7', -10]),
      mate(1, 'h5f7'),
      mate(0, null),
    ]
    const review = reviewGame(sans, evals, { thresholds: T, book: 2 })
    expect(review.moves.map((m) => m.mark)).toEqual([
      'book',
      'book',
      'good',
      'best',
      'best',
      'blunder',
      'best',
    ])
    expect(review.whiteWin[7]).toBeGreaterThan(97) // mates clamp like ±1000 cp
    expect(review.counts.black.blunder).toBe(1)
    expect(review.accuracy.white).toBeGreaterThan(review.accuracy.black)
    expect(review.moves[5].best?.san).toBe('g6')
  })

  it('marks not taking a hung queen as a miss, and taking it as great', () => {
    const sans = ['e4', 'e5', 'Nf3', 'Qh4', 'd3']
    const evals = [
      cp(30, 'e2e4'),
      cp(-30, 'e7e5'),
      cp(30, 'g1f3'),
      cp(-40, 'b8c6'),
      cp(900, 'f3h4', ['d2d3', 0]),
      cp(-40, 'b8c6'),
    ]
    const missed = reviewGame(sans, evals, { thresholds: T, book: 0 })
    expect(missed.moves[3].mark).toBe('blunder')
    expect(missed.moves[4].mark).toBe('miss')

    const took = reviewGame(
      ['e4', 'e5', 'Nf3', 'Qh4', 'Nxh4'],
      [...evals.slice(0, 5), cp(-900, 'b8c6')],
      { thresholds: T, book: 0 },
    )
    expect(took.moves[4].mark).toBe('great')
  })

  it('marks a sound piece sacrifice as brilliant', () => {
    const sans = ['e4', 'e5', 'Bc4', 'Nf6', 'Bxf7+']
    const evals = [
      cp(30, 'e2e4'),
      cp(-30, 'e7e5'),
      cp(30, 'f1c4'),
      cp(-20, 'g8f6'),
      cp(80, 'c4f7'),
      cp(-60, 'e8f7'),
    ]
    const review = reviewGame(sans, evals, { thresholds: T, book: 0 })
    expect(review.moves[4].mark).toBe('brilliant')
    expect(review.moves[4].sacrifice).toBe(2)
  })

  it('rejects evals that do not match the moves', () => {
    expect(() => reviewGame(['e4'], [cp(30, 'e2e4')], { thresholds: T, book: 0 })).toThrow()
  })
})
