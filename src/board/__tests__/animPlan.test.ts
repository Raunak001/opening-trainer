import { read } from 'chessground/fen'
import { describe, expect, it } from 'vitest'
import { animPlan, squarePos } from '../animPlan'

const pieces = (fen: string) => read(fen.split(' ')[0])

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
const E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1'

describe('squarePos', () => {
  it('maps squares to file and rank indexes', () => {
    expect(squarePos('a1')).toEqual([0, 0])
    expect(squarePos('h8')).toEqual([7, 7])
    expect(squarePos('e4')).toEqual([4, 3])
  })
})

describe('animPlan', () => {
  it('slides the moved piece', () => {
    expect(animPlan(pieces(START), pieces(E4))).toEqual({
      slides: [{ from: 'e2', to: 'e4' }],
      fades: [],
    })
  })

  it('slides back on a take-back', () => {
    expect(animPlan(pieces(E4), pieces(START)).slides).toEqual([{ from: 'e4', to: 'e2' }])
  })

  it('slides king and rook when castling', () => {
    const before = 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4'
    const after = 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQ1RK1 b kq - 5 4'
    const { slides, fades } = animPlan(pieces(before), pieces(after))
    expect(slides).toHaveLength(2)
    expect(slides).toEqual(
      expect.arrayContaining([
        { from: 'e1', to: 'g1' },
        { from: 'h1', to: 'f1' },
      ]),
    )
    expect(fades).toEqual([])
  })

  it('fades the captured piece', () => {
    const before = 'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2'
    const after = 'rnbqkbnr/ppp1pppp/8/3P4/8/8/PPPP1PPP/RNBQKBNR b KQkq - 0 2'
    expect(animPlan(pieces(before), pieces(after))).toEqual({
      slides: [{ from: 'e4', to: 'd5' }],
      fades: [{ key: 'd5', piece: { role: 'pawn', color: 'black' } }],
    })
  })

  it('fades the pawn on promotion; the new queen just appears', () => {
    const before = '8/4P1k1/8/8/8/8/6K1/8 w - - 0 1'
    const after = '4Q3/6k1/8/8/8/8/6K1/8 b - - 0 1'
    expect(animPlan(pieces(before), pieces(after))).toEqual({
      slides: [],
      fades: [{ key: 'e7', piece: { role: 'pawn', color: 'white' } }],
    })
  })

  it('uses each origin once when two like pieces move', () => {
    const before = '4k3/8/8/8/8/8/8/R3K2R w - - 0 1'
    const after = '4k3/8/8/8/8/8/R6R/4K3 w - - 0 1'
    expect(animPlan(pieces(before), pieces(after)).slides).toEqual([
      { from: 'a1', to: 'a2' },
      { from: 'h1', to: 'h2' },
    ])
  })

  it('plans nothing for the same position', () => {
    expect(animPlan(pieces(START), pieces(START))).toEqual({ slides: [], fades: [] })
  })
})
