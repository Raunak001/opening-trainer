import { describe, expect, it } from 'vitest'
import type { ExplorerMove, ExplorerResponse } from '../explorer'
import {
  DEFAULT_PRUNE_SETTINGS,
  scoreFor,
  selectMoves,
  withinDepth,
  type Color,
  type PruneSettings,
} from '../prune'
import afterE4C5Json from './fixtures/after-e4-c5.json'
import afterE4E5Nf3Json from './fixtures/after-e4-e5-nf3.json'
import afterE4Json from './fixtures/after-e4.json'
import startJson from './fixtures/start.json'

// Real explorer data, blitz+rapid, 1600 and 1800 buckets (see fixtures/README.md).
const start = startJson as ExplorerResponse
const afterE4 = afterE4Json as ExplorerResponse
const afterE4C5 = afterE4C5Json as ExplorerResponse
const afterE4E5Nf3 = afterE4E5Nf3Json as ExplorerResponse

const sans = (r: { moves: { move: ExplorerMove }[] }) => r.moves.map((m) => m.move.san)

function select(
  response: ExplorerResponse,
  userColor: Color,
  sideToMove: Color,
  overrides: Partial<PruneSettings> = {},
  ply = 1,
) {
  return selectMoves(response, {
    ply,
    userColor,
    sideToMove,
    settings: { ...DEFAULT_PRUNE_SETTINGS, ...overrides },
  })
}

/** Synthetic response: each entry is [san, white, draws, black]. Total = sum unless given. */
function synthetic(rows: [string, number, number, number][], total?: number): ExplorerResponse {
  const moves = rows.map(([san, white, draws, black]) => ({
    uci: san,
    san,
    white,
    draws,
    black,
    averageRating: 1700,
    opening: null,
  }))
  const sum = moves.reduce((s, m) => s + m.white + m.draws + m.black, 0)
  const extra = (total ?? sum) - sum
  return {
    white: moves.reduce((s, m) => s + m.white, 0) + extra,
    draws: moves.reduce((s, m) => s + m.draws, 0),
    black: moves.reduce((s, m) => s + m.black, 0),
    moves,
    opening: null,
  }
}

describe('scoreFor', () => {
  it('counts draws as half from either side', () => {
    const stats = { white: 50, draws: 20, black: 30 }
    expect(scoreFor(stats, 'white')).toBeCloseTo(0.6)
    expect(scoreFor(stats, 'black')).toBeCloseTo(0.4)
    expect(scoreFor({ white: 0, draws: 0, black: 0 }, 'white')).toBe(0)
  })
})

describe('user move choice', () => {
  it('picks the best-scoring move among those with ≥5% share (start, as White)', () => {
    const r = select(start, 'white', 'white')
    // e4 61% share scores 51.4%, d4 26% scores 52.6%. c4 scores 53.1% but has only 3.5%.
    expect(sans(r)).toEqual(['d4'])
    expect(r.reason).toBe('chosen')
    expect(r.moves[0].share).toBeCloseTo(0.257, 3)
    expect(r.moves[0].userScore).toBeCloseTo(0.526, 3)
  })

  it('admits more candidates when the share threshold drops', () => {
    expect(sans(select(start, 'white', 'white', { userMinShare: 0.03 }))).toEqual(['c4'])
  })

  it('scores from the user side (1.e4 c5, as White picks the best of six)', () => {
    // ≥5%: Nf3 50.1, Bc4 47.1, Nc3 51.2, d4 50.9, f4 49.6, c3 51.8 → c3. d3 (2%) is out.
    expect(sans(select(afterE4C5, 'white', 'white'))).toEqual(['c3'])
  })

  it('picks the black move with the best black score (start of 1.e4, as Black)', () => {
    // ≥5%: e5 46.9, c5 50.1, e6 50.0, d5 49.4, c6 50.6 (Black score) → c6.
    expect(sans(select(afterE4, 'black', 'black'))).toEqual(['c6'])
  })

  it('includes a move at exactly the share threshold and breaks ties by games', () => {
    const r = synthetic([
      ['a', 25, 0, 25], // 50%, scores 0.5
      ['b', 22, 1, 22], // 45%, scores 0.5 (tie with a, fewer games)
      ['c', 5, 0, 0], // exactly 5%, scores 1.0
    ])
    expect(sans(select(r, 'white', 'white'))).toEqual(['c'])
    expect(sans(select(r, 'white', 'white', { userMinShare: 0.06 }))).toEqual(['a'])
  })

  it('falls back to the most played move if nothing reaches the threshold', () => {
    const r = synthetic(
      [
        ['a', 1, 0, 3],
        ['b', 2, 0, 0],
      ],
      100,
    )
    expect(sans(select(r, 'white', 'white'))).toEqual(['a'])
  })
})

describe('opponent coverage cutoff', () => {
  it('keeps replies until 85% of games are covered (1.e4, as White)', () => {
    const r = select(afterE4, 'white', 'black')
    // Cumulative: e5 38.0, c5 59.8, e6 70.7, d5 79.8, c6 87.6 ← crosses 85%, kept; stop.
    expect(sans(r)).toEqual(['e5', 'c5', 'e6', 'd5', 'c6'])
    expect(r.reason).toBe('coverage')
    expect(r.coverage).toBeCloseTo(0.876, 3)
  })

  it('stops at the first reply that crosses the line (1.e4 e5 2.Nf3)', () => {
    // Nc6 64.9, d6 81.2, Nf6 92.0
    const r = select(afterE4E5Nf3, 'white', 'black')
    expect(sans(r)).toEqual(['Nc6', 'd6', 'Nf6'])
    expect(r.reason).toBe('coverage')
  })

  it('works for White replies when the user is Black (1.e4 c5)', () => {
    // Nf3 55.2, Bc4 65.1, Nc3 73.0, d4 80.3, f4 86.5
    expect(sans(select(afterE4C5, 'black', 'white'))).toEqual(['Nf3', 'Bc4', 'Nc3', 'd4', 'f4'])
  })

  it('stops exactly on the coverage boundary', () => {
    const r = synthetic([
      ['a', 50, 0, 0],
      ['b', 35, 0, 0], // 50 + 35 = 85% exactly
      ['c', 15, 0, 0],
    ])
    const s = select(r, 'white', 'black')
    expect(sans(s)).toEqual(['a', 'b'])
    expect(s.coverage).toBe(0.85)
  })

  it('reports when the listed moves run out first', () => {
    // Listed moves cover only 60% of the position's games, all above the floor.
    const r = synthetic(
      [
        ['a', 40, 0, 0],
        ['b', 20, 0, 0],
      ],
      100,
    )
    const s = select(r, 'white', 'black')
    expect(sans(s)).toEqual(['a', 'b'])
    expect(s.reason).toBe('exhausted')
    expect(s.coverage).toBeCloseTo(0.6)
  })
})

describe('opponent floor cutoff', () => {
  it('drops replies under 3% before coverage is reached (1.e4, 95% target)', () => {
    // …c6 87.6, d6 (3.6%) 91.2, g6 (3.1%) 94.3, b6 2.0% < 3% → stop short of 95%.
    const r = select(afterE4, 'white', 'black', { opponentCoverage: 0.95 })
    expect(sans(r)).toEqual(['e5', 'c5', 'e6', 'd5', 'c6', 'd6', 'g6'])
    expect(r.reason).toBe('floor')
    expect(r.coverage).toBeCloseTo(0.943, 3)
  })

  it('cuts 2...Bc5 (2.3%) after 1.e4 e5 2.Nf3 at a 99% target', () => {
    const r = select(afterE4E5Nf3, 'white', 'black', { opponentCoverage: 0.99 })
    expect(sans(r)).toEqual(['Nc6', 'd6', 'Nf6'])
    expect(r.reason).toBe('floor')
  })

  it('keeps a reply at exactly the floor', () => {
    const r = synthetic([
      ['a', 80, 0, 0],
      ['b', 3, 0, 0], // exactly 3%
      ['c', 2, 0, 0],
      ['d', 15, 0, 0], // out of popularity order on purpose; sorted first
    ])
    // Sorted: a 80, d 15 → 95% ≥ 85% → stop before b.
    expect(sans(select(r, 'white', 'black'))).toEqual(['a', 'd'])
    // With 99% coverage the 3% reply stays and the 2% reply is cut.
    const s = select(r, 'white', 'black', { opponentCoverage: 0.99 })
    expect(sans(s)).toEqual(['a', 'd', 'b'])
    expect(s.reason).toBe('floor')
  })
})

describe('depth and empty data', () => {
  it('lets the user answer at maxPly but adds no opponent replies there', () => {
    const settings = { ...DEFAULT_PRUNE_SETTINGS, maxPly: 4 }
    expect(withinDepth(3, false, settings)).toBe(true)
    expect(withinDepth(4, false, settings)).toBe(false)
    expect(withinDepth(4, true, settings)).toBe(true)
    expect(withinDepth(5, true, settings)).toBe(false)
  })

  it('returns no moves beyond the depth limit', () => {
    const opp = select(afterE4, 'white', 'black', { maxPly: 1 }, 1)
    expect(opp).toEqual({ moves: [], reason: 'depth', coverage: 0 })
    const user = select(afterE4C5, 'white', 'white', { maxPly: 2 }, 2)
    expect(sans(user)).toEqual(['c3'])
  })

  it('handles positions with no games', () => {
    const empty: ExplorerResponse = { white: 0, draws: 0, black: 0, moves: [], opening: null }
    expect(select(empty, 'white', 'white').reason).toBe('noGames')
    expect(select(empty, 'white', 'black').moves).toEqual([])
  })
})
