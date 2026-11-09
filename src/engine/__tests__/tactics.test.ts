import { describe, expect, it } from 'vitest'
import { findForks, forkAt, tacticFindings } from '../tactics'

// White knight b5; Nc7+ forks Ke8 and Qa8 from a square nothing guards.
const KNIGHT_FORK = 'q3k3/8/8/1N6/8/8/8/4K3 w - - 0 1'
const AFTER_NC7 = 'q3k3/2N5/8/8/8/8/8/4K3 b - - 1 1'
// Same, but the black king on d8 guards c7: the "fork" just loses the knight.
const GUARDED = 'q2k4/8/8/1N6/8/8/8/4K3 w - - 0 1'
// Black knight b4 threatens Nc2+ forking Ke1 and Qa1.
const ALLOWS = '4k3/8/8/8/1n6/8/7P/Q3K3 w - - 0 1'
// Back rank: Ra8#.
const BACK_RANK = '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1'
// White's rook guards the back rank; Rd7?? allows Ra1+ Rd1 Rxd1#.
const GUARDS_BACK_RANK = '6k1/5ppp/8/8/8/8/r4PPP/3R2K1 w - - 0 1'
// 1.e4 e5 2.Nf3 Nc6, nothing tactical.
const NC6 = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3'

describe('forkAt', () => {
  it('detects a safe knight fork of king and queen', () => {
    expect(forkAt(AFTER_NC7, 'c7')).toEqual([
      { square: 'e8', piece: 'k' },
      { square: 'a8', piece: 'q' },
    ])
  })

  it('rejects forks from a square the opponent wins', () => {
    const forks = findForks(GUARDED, ['b5c7'], 'w')
    expect(forks).toEqual([])
  })

  it('needs two targets', () => {
    expect(forkAt('q3k3/8/8/8/8/8/2N5/4K3 b - - 1 1', 'c2')).toBeNull()
  })
})

describe('findForks', () => {
  it('finds the forking ply in a line', () => {
    expect(findForks(KNIGHT_FORK, ['b5c7', 'e8d7', 'c7a8'], 'w')).toEqual([
      {
        ply: 0,
        san: 'Nc7+',
        color: 'w',
        piece: 'n',
        square: 'c7',
        targets: [
          { square: 'e8', piece: 'k' },
          { square: 'a8', piece: 'q' },
        ],
      },
    ])
  })

  it('only reports forks by the requested side', () => {
    expect(findForks(KNIGHT_FORK, ['b5c7'], 'b')).toEqual([])
  })
})

describe('tacticFindings', () => {
  it('reports a missed fork', () => {
    const findings = tacticFindings({
      fen: KNIGHT_FORK,
      played: 'Kd2',
      bestPv: ['b5c7', 'e8d7', 'c7a8'],
      replyPv: ['a8a2'],
      before: { type: 'cp', value: 900 },
      after: { type: 'cp', value: 0 },
    })
    expect(findings).toEqual([expect.objectContaining({ type: 'missed-fork' })])
    expect(findings[0].type === 'missed-fork' && findings[0].fork.san).toBe('Nc7+')
  })

  it('reports an allowed fork', () => {
    const findings = tacticFindings({
      fen: ALLOWS,
      played: 'h3',
      bestPv: ['a1b1'],
      replyPv: ['b4c2', 'e1d2', 'c2a1'],
      before: { type: 'cp', value: 600 },
      after: { type: 'cp', value: 600 },
    })
    expect(findings).toEqual([
      {
        type: 'allows-fork',
        fork: {
          ply: 0,
          san: 'Nc2+',
          color: 'b',
          piece: 'n',
          square: 'c2',
          targets: [
            { square: 'e1', piece: 'k' },
            { square: 'a1', piece: 'q' },
          ],
        },
      },
    ])
  })

  it('reports a missed mate in one', () => {
    expect(
      tacticFindings({
        fen: BACK_RANK,
        played: 'h3',
        bestPv: ['a1a8'],
        replyPv: ['h7h6'],
        before: { type: 'mate', value: 1 },
        after: { type: 'cp', value: -500 },
      }),
    ).toEqual([{ type: 'missed-mate', mateIn: 1, sans: ['Ra8#'] }])
  })

  it('does not call a slower mate a missed mate', () => {
    expect(
      tacticFindings({
        fen: BACK_RANK,
        played: 'Ra7',
        bestPv: ['a1a8'],
        replyPv: ['h7h6', 'a7a8'],
        before: { type: 'mate', value: 1 },
        after: { type: 'mate', value: -2 },
      }),
    ).toEqual([])
  })

  it('reports walking into mate', () => {
    expect(
      tacticFindings({
        fen: GUARDS_BACK_RANK,
        played: 'Rd7',
        bestPv: ['h2h3'],
        replyPv: ['a2a1', 'd7d1', 'a1d1'],
        before: { type: 'cp', value: -500 },
        after: { type: 'mate', value: 2 },
      }),
    ).toEqual([{ type: 'allows-mate', mateIn: 2, sans: ['Ra1+', 'Rd1', 'Rxd1#'] }])
  })

  it('stays quiet for the engine move and for quiet positions', () => {
    const quiet = { before: { type: 'cp', value: 30 }, after: { type: 'cp', value: -25 } } as const
    expect(
      tacticFindings({ fen: KNIGHT_FORK, played: 'b5c7', bestPv: ['b5c7'], replyPv: [], ...quiet }),
    ).toEqual([])
    expect(
      tacticFindings({
        fen: NC6,
        played: 'Bc4',
        bestPv: ['f1b5', 'a7a6'],
        replyPv: ['g8f6', 'd2d3'],
        ...quiet,
      }),
    ).toEqual([])
  })
})
