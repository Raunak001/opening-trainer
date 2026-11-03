import { describe, expect, it } from 'vitest'
import { inCheck, legalDests, turnColor } from '../dests'

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

  it('includes castling as a king move to the g/c file', () => {
    // Italian, both sides ready to castle short: 1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5
    const dests = legalDests('r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4')
    expect(dests.get('e1')).toContain('g1')
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
