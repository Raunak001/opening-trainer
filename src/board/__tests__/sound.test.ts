import { Chess } from 'chess.js'
import { describe, expect, it } from 'vitest'
import { moveSound } from '../sound'

const START = new Chess().fen()
const after = (fen: string, san: string) => {
  const chess = new Chess(fen)
  chess.move(san)
  return chess.fen()
}

describe('moveSound', () => {
  it('plain move', () => {
    expect(moveSound(START, after(START, 'e4'))).toBe('move')
  })

  it('capture', () => {
    const fen = 'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2'
    expect(moveSound(fen, after(fen, 'exd5'))).toBe('capture')
  })

  it('en passant counts as a capture', () => {
    const fen = 'rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3'
    expect(moveSound(fen, after(fen, 'exf6'))).toBe('capture')
  })

  it('castling, both sides', () => {
    const fen = 'r3k2r/pppqbppp/2np1n2/4p3/2B1P1b1/2NP1N2/PPP1QPPP/R1B1K2R w KQkq - 4 7'
    expect(moveSound(fen, after(fen, 'O-O'))).toBe('castle')
    const black = 'r3k2r/pppqbppp/2np1n2/4p3/2B1P1b1/2NP1N2/PPP1QPPP/R1B2RK1 b kq - 5 7'
    expect(moveSound(black, after(black, 'O-O-O'))).toBe('castle')
  })

  it('check wins over capture', () => {
    // Bxf7+ takes a pawn with check.
    const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 2 3'
    expect(moveSound(fen, after(fen, 'Bxf7+'))).toBe('check')
  })

  it('mate sounds as check', () => {
    const fen = 'rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq g3 0 2'
    expect(moveSound(fen, after(fen, 'Qh4#'))).toBe('check')
  })

  it('promotion', () => {
    const fen = '8/4P1k1/8/8/8/8/6K1/8 w - - 0 1'
    expect(moveSound(fen, after(fen, 'e8=Q'))).toBe('promote')
  })

  it('silent for no change, a step back or a jump', () => {
    const e4 = after(START, 'e4')
    expect(moveSound(START, START)).toBeNull()
    expect(moveSound(e4, START)).toBeNull()
    expect(moveSound(START, after(e4, 'e5'))).toBeNull()
  })

  it('silent for an invalid FEN', () => {
    expect(moveSound('not a fen', START)).toBeNull()
  })
})
