import { describe, expect, it } from 'vitest'
import { fensAlong, moveRows } from '../moveRows'

describe('moveRows', () => {
  it('numbers moves from the initial position', () => {
    expect(moveRows(['e4', 'c6', 'd4'])).toEqual([
      { number: 1, white: { san: 'e4', ply: 0 }, black: { san: 'c6', ply: 1 } },
      { number: 2, white: { san: 'd4', ply: 2 } },
    ])
  })

  it('starts with Black when the FEN has Black to move', () => {
    // After 1.e4 e5 2.Nf3 Nc6 3.Bc4 (Italian): Black's 3rd move is next.
    const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3'
    expect(moveRows(['Bc5', 'c3'], fen)).toEqual([
      { number: 3, black: { san: 'Bc5', ply: 0 } },
      { number: 4, white: { san: 'c3', ply: 1 } },
    ])
  })

  it('is empty for no moves', () => {
    expect(moveRows([])).toEqual([])
  })
})

describe('fensAlong', () => {
  it('gives the start and the position after each move', () => {
    const fens = fensAlong(['e4', 'c6'])
    expect(fens).toHaveLength(3)
    expect(fens[0]).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')
    expect(fens[2]).toBe('rnbqkbnr/pp1ppppp/2p5/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2')
  })
})
