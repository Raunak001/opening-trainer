import { describe, expect, it } from 'vitest'
import { principleFindings } from '../principles'

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'
const types = (sans: string[], fen = START) => principleFindings(fen, sans).map((f) => f.type)

describe('early queen', () => {
  it('flags 2.Qh5', () => {
    expect(principleFindings(START, ['e4', 'e5', 'Qh5'])).toEqual([
      { type: 'early-queen', san: 'Qh5', moveNumber: 2 },
    ])
  })

  it('flags Black too, counting move numbers from a mid-game FEN', () => {
    expect(principleFindings(AFTER_E4, ['e5', 'Nf3', 'Qf6'])).toEqual([
      { type: 'early-queen', san: 'Qf6', moveNumber: 2 },
    ])
  })

  it('allows a queen recapture', () => {
    expect(types(['e4', 'd5', 'exd5', 'Qxd5'])).toEqual([])
  })
})

describe('same piece twice', () => {
  it('flags 3.Ng5', () => {
    expect(principleFindings(START, ['e4', 'e5', 'Nf3', 'Nc6', 'Ng5'])).toEqual([
      { type: 'same-piece-twice', san: 'Ng5', piece: 'n', moveNumber: 3 },
    ])
  })

  it('allows running from an attack (Alekhine 2...Nd5)', () => {
    expect(types(['e4', 'Nf6', 'e5', 'Nd5'])).toEqual([])
  })

  it('allows captures', () => {
    expect(types(['e4', 'e5', 'Nf3', 'Nc6', 'Nxe5'])).toEqual([])
  })
})

describe('castling', () => {
  const giuoco = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd3', 'd6']
  const slow = [...giuoco, 'Nbd2', 'a6', 'a4', 'h6', 'h3', 'O-O', 'Nf1', 'Re8']

  it('flags no castle by move 10', () => {
    expect(types([...slow, 'Ng3'])).toContain('no-castle')
  })

  it('is satisfied by castling', () => {
    const castlesOnTen = [...giuoco, 'Nbd2', 'a6', 'a4', 'h6', 'h3', 'O-O', 'b4', 'Re8', 'O-O']
    expect(types(castlesOnTen)).toEqual([])
  })

  it('does not nag before move 10', () => {
    expect(types(giuoco.slice(0, 9))).not.toContain('no-castle')
  })
})

describe('central pawns', () => {
  it('flags no d- or e-pawn move by move 3', () => {
    expect(types(['Nf3', 'd5', 'g3', 'Nf6', 'Bg2'])).toEqual(['no-central-pawn'])
  })

  it('is satisfied by either central pawn', () => {
    expect(types(['Nf3', 'd5', 'd3', 'Nf6', 'g3'])).toEqual([])
  })
})

describe('undeveloped minors', () => {
  it('flags a pawn move at move 6 with all minors at home', () => {
    const findings = principleFindings(START, [
      'a3',
      'e5',
      'h3',
      'd5',
      'b3',
      'Nf6',
      'g3',
      'Nc6',
      'c3',
      'Bd6',
      'f3',
    ])
    expect(findings).toContainEqual({
      type: 'undeveloped-minors',
      moveNumber: 6,
      squares: ['b1', 'c1', 'f1', 'g1'],
    })
    expect(findings.map((f) => f.type)).toContain('no-central-pawn')
  })

  it('accepts the developing move itself', () => {
    expect(
      types(['a3', 'e5', 'h3', 'd5', 'b3', 'Nf6', 'g3', 'Nc6', 'c3', 'Bd6', 'Nf3']),
    ).not.toContain('undeveloped-minors')
  })
})

describe('options', () => {
  it('reads thresholds from options', () => {
    expect(principleFindings(START, ['e4', 'e5', 'Qh5'], { earlyQueenUntilMove: 1 })).toEqual([])
  })

  it('returns nothing for an empty game', () => {
    expect(principleFindings(START, [])).toEqual([])
  })
})
