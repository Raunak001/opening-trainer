import { Chess } from 'chess.js'
import { describe, expect, it } from 'vitest'
import { amountWords, explainMove, fill, formatScore } from '../explain'
import type { MoveGrade, MoveGrading } from '../grading'
import { positionKey } from '../../repertoire/positionKey'
import type { Score } from '../uci'

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
// 1.e4 e5 2.Nf3 a6: e5 is loose.
const A6 = 'rnbqkbnr/1ppp1ppp/p7/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 3'
// 1.e4 e5 2.Nf3 Nc6
const NC6 = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3'
const GUARDS_BACK_RANK = '6k1/5ppp/8/8/8/8/r4PPP/3R2K1 w - - 0 1'
// 1.e4 e5
const E4_E5 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2'

/** A MoveGrading as gradeMove would return it, from hand-picked engine output. */
function grading(opts: {
  fen: string
  played: string
  grade: MoveGrade
  bestPv: string[]
  before: Score
  replyPv: string[]
  after: Score
}): MoveGrading {
  const chess = new Chess(opts.fen)
  const played = chess.move(opts.played)
  const best = new Chess(opts.fen).move({
    from: opts.bestPv[0].slice(0, 2),
    to: opts.bestPv[0].slice(2, 4),
  })
  const uci = (m: { from: string; to: string; promotion?: string }) =>
    m.from + m.to + (m.promotion ?? '')
  return {
    grade: opts.grade,
    played: { uci: uci(played), san: played.san },
    best: { uci: uci(best), san: best.san },
    before: {
      positionKey: positionKey(opts.fen),
      depth: 16,
      score: opts.before,
      bestMove: opts.bestPv[0],
      pv: opts.bestPv,
    },
    after: {
      positionKey: positionKey(chess.fen()),
      depth: 16,
      score: opts.after,
      bestMove: opts.replyPv[0] ?? null,
      pv: opts.replyPv,
    },
    winBefore: 0,
    winAfter: 0,
    loss: 0,
  }
}

describe('helpers', () => {
  it('fills placeholders and leaves unknown ones visible', () => {
    expect(fill('Best was {best} ({eval}).', { best: 'Nxe5', eval: '+1.2' })).toBe(
      'Best was Nxe5 (+1.2).',
    )
    expect(fill('{nope}', {})).toBe('{nope}')
  })

  it('formats scores from the mover side', () => {
    expect(formatScore({ type: 'cp', value: 120 })).toBe('+1.2')
    expect(formatScore({ type: 'cp', value: -35 })).toBe('-0.3')
    expect(formatScore({ type: 'cp', value: 4 })).toBe('0.0')
    expect(formatScore({ type: 'mate', value: 3 })).toBe('#3')
    expect(formatScore({ type: 'mate', value: -2 })).toBe('#-2')
    expect(formatScore({ type: 'mate', value: 0 })).toBe('#')
  })

  it('words material amounts', () => {
    expect([1, 2, 3, 5, 7, 9].map(amountWords)).toEqual([
      'a pawn',
      'two pawns',
      'a piece',
      'a rook',
      "7 pawns' worth of material",
      'the queen',
    ])
  })
})

describe('explainMove', () => {
  it('says "Best was Nxe5, winning a pawn (+1.2)" for a missed free pawn', () => {
    const explanation = explainMove({
      fen: A6,
      grading: grading({
        fen: A6,
        played: 'd3',
        grade: 'inaccuracy',
        bestPv: ['f3e5', 'd8e7', 'e5f3'],
        before: { type: 'cp', value: 120 },
        replyPv: ['b8c6', 'c2c3'],
        after: { type: 'cp', value: -30 },
      }),
    })
    expect(explanation).toMatchObject({
      grade: 'inaccuracy',
      label: 'inaccuracy',
      reason: 'The pawn on e5 was free to take.',
      best: 'Best was Nxe5, winning a pawn (+1.2).',
      evalBest: '+1.2',
      evalPlayed: '+0.3',
    })
  })

  it('explains a hung bishop without naming the better move', () => {
    const explanation = explainMove({
      fen: NC6,
      grading: grading({
        fen: NC6,
        played: 'Ba6',
        grade: 'blunder',
        bestPv: ['f1b5', 'a7a6', 'b5a4'],
        before: { type: 'cp', value: 39 },
        replyPv: ['b7a6', 'd2d4'],
        after: { type: 'cp', value: 290 },
      }),
    })
    expect(explanation.reason).toBe('This leaves your bishop on a6 hanging.')
    expect(explanation.reason).not.toContain('Bb5')
    expect(explanation.best).toBe('Best was Bb5 (+0.4).')
    expect(explanation.evalPlayed).toBe('-2.9')
  })

  it('puts walking into mate first', () => {
    const explanation = explainMove({
      fen: GUARDS_BACK_RANK,
      grading: grading({
        fen: GUARDS_BACK_RANK,
        played: 'Rd7',
        grade: 'blunder',
        bestPv: ['h2h3'],
        before: { type: 'cp', value: -500 },
        replyPv: ['a2a1', 'd7d1', 'a1d1'],
        after: { type: 'mate', value: 2 },
      }),
    })
    expect(explanation.reason).toBe('This allows mate in 2: Ra1+ Rd1 Rxd1#.')
    expect(explanation.evalPlayed).toBe('#-2')
  })

  it('uses opening principles when nothing tactical applies, for bad moves only', () => {
    const quiet = {
      fen: E4_E5,
      played: 'Qh5',
      bestPv: ['g1f3', 'b8c6'],
      before: { type: 'cp', value: 35 } as Score,
      replyPv: ['b8c6', 'f1c4'],
      after: { type: 'cp', value: 20 } as Score,
    }
    const history = { startFen: START, sans: ['e4', 'e5', 'Qh5'] }
    const bad = explainMove({
      fen: E4_E5,
      grading: grading({ ...quiet, grade: 'inaccuracy' }),
      history,
    })
    expect(bad.reason).toBe(
      'Bringing the queen out this early lets your opponent gain time by attacking it.',
    )
    expect(bad.findings.map((f) => f.type)).toContain('early-queen')

    const fine = explainMove({ fen: E4_E5, grading: grading({ ...quiet, grade: 'good' }), history })
    expect(fine.reason).toBeUndefined()
    expect(fine.label).toBe('good move')
  })

  it('falls back to the eval when there is no specific finding', () => {
    const explanation = explainMove({
      fen: NC6,
      grading: grading({
        fen: NC6,
        played: 'h3',
        grade: 'inaccuracy',
        bestPv: ['f1b5'],
        before: { type: 'cp', value: 39 },
        replyPv: ['g8f6'],
        after: { type: 'cp', value: 20 },
      }),
    })
    expect(explanation.reason).toBe('This drops the evaluation to -0.2.')
    expect(explanation.best).toBe('Best was Bb5 (+0.4).')
  })

  it('cuts long lines with an ellipsis and no trailing full stop', () => {
    // Scores are hand-made: only the wording is under test.
    const explanation = explainMove({
      fen: START,
      grading: grading({
        fen: START,
        played: 'f3',
        grade: 'blunder',
        bestPv: ['e2e4'],
        before: { type: 'cp', value: 30 },
        replyPv: ['e7e5', 'g2g4', 'b8c6', 'a2a3', 'g8f6', 'a3a4', 'f8c5', 'a4a5', 'd8e7'],
        after: { type: 'mate', value: 5 },
      }),
    })
    expect(explanation.reason).toBe('This allows mate in 5: e5 g4 Nc6 a3 Nf6 a4 Bc5 a5…')
  })

  it('has no "best" sentence when the move was the best', () => {
    const explanation = explainMove({
      fen: NC6,
      grading: grading({
        fen: NC6,
        played: 'Bb5',
        grade: 'good',
        bestPv: ['f1b5', 'a7a6'],
        before: { type: 'cp', value: 39 },
        replyPv: ['a7a6'],
        after: { type: 'cp', value: -39 },
      }),
    })
    expect(explanation.best).toBeUndefined()
    expect(explanation.reason).toBeUndefined()
  })
})
