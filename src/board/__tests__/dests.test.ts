import { describe, expect, it } from 'vitest'
import { inCheck, isPromotion, legalDests, normalizeCastle, turnColor } from '../dests'

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

const sorted = (keys: readonly string[] | undefined) => [...(keys ?? [])].sort()

describe('legalDests', () => {
  it('gives the 20 opening moves from the start position', () => {
    const dests = legalDests(START)
    const total = [...dests.values()].reduce((n, ks) => n + ks.length, 0)
    expect(total).toBe(20)
    expect(sorted(dests.get('e2'))).toEqual(['e3', 'e4'])
    expect(sorted(dests.get('g1'))).toEqual(['f3', 'h3'])
    expect(dests.has('e1')).toBe(false)
  })

  it('only lists pieces of the side to move', () => {
    // After 1.e4
    const dests = legalDests('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1')
    expect(dests.has('e4')).toBe(false)
    expect(sorted(dests.get('e7'))).toEqual(['e5', 'e6'])
  })

  it('lists castling as both the king target and the rook square', () => {
    // Italian, both sides ready to castle short: 1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5
    const dests = legalDests('r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4')
    expect(sorted(dests.get('e1'))).toEqual(['e2', 'f1', 'g1', 'h1'])
  })

  it('lists queenside castling squares for Black', () => {
    // 1.d4 d5 2.Nc3 Nc6 3.Bf4 Bf5 4.Qd2 Qd7 5.O-O-O
    const fen = 'r3kbnr/pppqpppp/2n5/3p1b2/3P1B2/2N5/PPPQPPPP/2KR1BNR b kq - 7 5'
    expect(sorted(legalDests(fen).get('e8'))).toEqual(['a8', 'c8', 'd8'])
  })

  it('omits the rook square when castling is not legal', () => {
    // Same Italian position but White has lost castling rights
    const dests = legalDests('r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w kq - 4 4')
    expect(sorted(dests.get('e1'))).toEqual(['e2', 'f1'])
  })

  it('includes en passant captures', () => {
    // 1.e4 a6 2.e5 d5 — exd6 e.p. is legal
    const dests = legalDests('rnbqkbnr/1pp1pppp/p7/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3')
    expect(sorted(dests.get('e5'))).toEqual(['d6', 'e6'])
  })

  it('lists a promotion square once, not once per piece type', () => {
    const dests = legalDests('8/4P3/8/8/8/8/k7/4K3 w - - 0 1')
    expect(dests.get('e7')).toEqual(['e8'])
  })

  it('restricts moves when in check', () => {
    // Scholar's-style check: 1.e4 f6 2.Qh5+ — only g6 blocks
    const fen = 'rnbqkbnr/ppppp1pp/5p2/7Q/4P3/8/PPPP1PPP/RNB1KBNR b KQkq - 1 2'
    const dests = legalDests(fen)
    expect([...dests.entries()]).toEqual([['g7', ['g6']]])
    expect(inCheck(fen)).toBe(true)
  })

  it('is empty at checkmate', () => {
    // Fool's mate
    const fen = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3'
    expect(legalDests(fen).size).toBe(0)
  })
})

describe('turnColor', () => {
  it('reads the side to move from the FEN', () => {
    expect(turnColor(START)).toBe('white')
    expect(turnColor('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1')).toBe('black')
  })
})

describe('normalizeCastle', () => {
  const ITALIAN = 'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4'
  const LONG = 'r3kbnr/pppqpppp/2n5/3p1b2/3P1B2/2N5/PPPQPPPP/2KR1BNR b kq - 7 5'

  it('maps a king dropped on its rook to the castling square', () => {
    expect(normalizeCastle(ITALIAN, 'e1', 'h1')).toBe('g1')
    expect(normalizeCastle(LONG, 'e8', 'a8')).toBe('c8')
  })

  it('leaves other moves alone', () => {
    expect(normalizeCastle(ITALIAN, 'e1', 'g1')).toBe('g1')
    expect(normalizeCastle(ITALIAN, 'e1', 'f1')).toBe('f1')
    expect(normalizeCastle(ITALIAN, 'h1', 'g1')).toBe('g1')
  })
})

describe('isPromotion', () => {
  it('detects pawn moves to the last rank only', () => {
    const fen = '4k3/P7/8/8/8/8/7p/4K3 w - - 0 1'
    expect(isPromotion(fen, 'a7', 'a8')).toBe(true)
    expect(isPromotion(fen, 'e1', 'e2')).toBe(false)
    expect(isPromotion(START, 'e2', 'e4')).toBe(false)
  })
})
