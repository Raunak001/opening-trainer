import { describe, expect, it } from 'vitest'
import { positionKey } from '../positionKey'
import { AFTER_E4, ITALIAN_VIA_E4, ITALIAN_VIA_NF3, START } from './fixtures'

describe('positionKey', () => {
  it('keeps placement, side, castling and en passant', () => {
    expect(positionKey(START)).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -')
    expect(positionKey(AFTER_E4)).toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -')
  })

  it('merges transpositions that differ only in move clocks', () => {
    expect(positionKey(ITALIAN_VIA_NF3)).toBe(positionKey(ITALIAN_VIA_E4))
  })

  it('rejects malformed FEN', () => {
    expect(() => positionKey('8/8/8/8 w')).toThrow(/Invalid FEN/)
  })
})
