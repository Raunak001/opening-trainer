import { describe, expect, it } from 'vitest'
import {
  hangingPieces,
  lineMaterial,
  materialBalance,
  materialFindings,
  staticExchange,
} from '../material'

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
// 1.e4 d5 2.exd5
const AFTER_EXD5 = 'rnbqkbnr/ppp1pppp/8/3P4/8/8/PPPP1PPP/RNBQKBNR b KQkq - 0 2'
// 1.e4 e5 2.Nf3 Nc6: e5 defended.
const NC6 = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3'
// 1.e4 e5 2.Nf3 a6: e5 undefended.
const A6 = 'rnbqkbnr/1ppp1ppp/p7/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 3'
// 1.e4 e5 2.Nf3 Qh4??: queen en prise to the knight.
const QH4 = 'rnb1kbnr/pppp1ppp/8/4p3/4P2q/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3'
// Knight on d4 attacked only by a knight pinned to its king.
const PINNED = '4k3/8/2n5/1B6/3N4/8/8/4K3 b - - 0 1'
const UNPINNED = '4k3/8/2n5/8/3N4/8/8/4K3 b - - 0 1'
// Doubled rooks vs a pawn defended once: the x-ray rook decides it.
const BATTERY = '3rk3/8/8/3p4/8/8/3R4/3RK3 w - - 0 1'

describe('materialBalance', () => {
  it('counts White minus Black in pawns', () => {
    expect(materialBalance(START)).toBe(0)
    expect(materialBalance(AFTER_EXD5)).toBe(1)
    expect(materialBalance(QH4)).toBe(0)
  })
})

describe('staticExchange', () => {
  it('wins an undefended pawn', () => {
    expect(staticExchange(A6, 'e5')).toBe(1)
  })

  it('loses a knight for a defended pawn', () => {
    expect(staticExchange(NC6, 'e5')).toBe(-2)
  })

  it('wins an undefended queen with a knight', () => {
    expect(staticExchange(QH4, 'h4')).toBe(9)
  })

  it('counts x-ray attackers behind the first capturer', () => {
    expect(staticExchange(BATTERY, 'd5')).toBe(1)
  })

  it('ignores pinned attackers', () => {
    expect(staticExchange(PINNED, 'd4')).toBeNull()
    expect(staticExchange(UNPINNED, 'd4')).toBe(3)
  })

  it('returns null for empty, own or king squares', () => {
    expect(staticExchange(START, 'e4')).toBeNull()
    expect(staticExchange(START, 'e2')).toBeNull()
    expect(staticExchange(START, 'e8')).toBeNull()
  })
})

describe('hangingPieces', () => {
  it('finds undefended attacked pieces with attackers and defenders', () => {
    expect(hangingPieces(A6, 'b')).toEqual([
      { square: 'e5', piece: 'p', color: 'b', value: 1, gain: 1, attackers: ['f3'], defenders: [] },
    ])
    expect(hangingPieces(NC6, 'b')).toEqual([])
  })

  it('judges the other side even when it is not to move', () => {
    // White to move in QH4; ask about White's own pieces (Black would capture): Qxe4+.
    expect(hangingPieces(QH4, 'w').map((p) => [p.square, p.gain])).toEqual([['e4', 1]])
    expect(hangingPieces(QH4, 'b').map((p) => [p.square, p.gain])).toEqual([
      ['h4', 9],
      ['e5', 1],
    ])
  })

  it('respects pins', () => {
    expect(hangingPieces(PINNED, 'w')).toEqual([])
    expect(hangingPieces(UNPINNED, 'w').map((p) => p.square)).toEqual(['d4'])
  })
})

describe('lineMaterial', () => {
  it('measures the swing for the side to move', () => {
    const line = lineMaterial(A6, ['f3e5', 'd8e7'])
    expect(line.sans).toEqual(['Nxe5', 'Qe7'])
    expect(line.swing).toBe(1)
    expect(line.captures).toEqual([{ ply: 0, san: 'Nxe5', piece: 'p', color: 'b' }])
  })

  it('settles a recapture the line stopped short of', () => {
    // Rxd5 Rxd5 and the line ends; Rxd5 is coming.
    expect(lineMaterial(BATTERY, ['d2d5', 'd8d5']).swing).toBe(1)
  })

  it('stops at the first illegal move', () => {
    const line = lineMaterial(START, ['e2e4', 'e2e4', 'd7d5'])
    expect(line.sans).toEqual(['e4'])
    expect(line.swing).toBe(0)
  })
})

describe('materialFindings', () => {
  it('reports a hung bishop', () => {
    // 3.Ba6?? bxa6
    const findings = materialFindings({
      fen: NC6,
      played: 'Ba6',
      bestPv: ['f1b5', 'a7a6', 'b5a4'],
      replyPv: ['b7a6', 'd2d4'],
    })
    expect(findings).toEqual([
      { type: 'played-loses-material', amount: 3, sans: ['Ba6', 'bxa6', 'd4'] },
      {
        type: 'hangs-piece',
        piece: {
          square: 'a6',
          piece: 'b',
          color: 'w',
          value: 3,
          gain: 3,
          attackers: ['b7'],
          defenders: [],
        },
      },
    ])
  })

  it('reports a missed free queen', () => {
    const findings = materialFindings({
      fen: QH4,
      played: 'd4',
      bestPv: ['f3h4', 'g8f6'],
      replyPv: ['h4e4'],
    })
    expect(findings).toContainEqual({
      type: 'best-wins-material',
      amount: 9,
      sans: ['Nxh4', 'Nf6'],
    })
    expect(findings).toContainEqual({
      type: 'played-loses-material',
      amount: 1,
      sans: ['d4', 'Qxe4+'],
    })
    expect(findings).toContainEqual(
      expect.objectContaining({ type: 'missed-capture', bestSan: 'Nxh4' }),
    )
    // e4 was already loose before d4, so d4 did not hang it.
    expect(findings.some((f) => f.type === 'hangs-piece')).toBe(false)
  })

  it('reports nothing bad about the engine move itself', () => {
    const findings = materialFindings({
      fen: QH4,
      played: 'f3h4',
      bestPv: ['f3h4', 'g8f6'],
      replyPv: ['g8f6'],
    })
    expect(findings).toEqual([{ type: 'best-wins-material', amount: 9, sans: ['Nxh4', 'Nf6'] }])
  })

  it('stays quiet for quiet moves', () => {
    expect(
      materialFindings({ fen: NC6, played: 'Bc4', bestPv: ['f1b5', 'a7a6'], replyPv: ['g8f6'] }),
    ).toEqual([])
  })
})
