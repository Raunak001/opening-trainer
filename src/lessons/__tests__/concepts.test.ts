import { describe, expect, it } from 'vitest'
import { detectConcepts, developingMoves, prematureAttack } from '../concepts'
import { CENTER, fenAfter } from './fixtures'

const START = fenAfter('')
// Most fixtures are short lines: allow strikes from move 1 unless a test says otherwise.
const hit = (fen: string, concept: string) =>
  detectConcepts(fen, { strikeFromMove: 1 }).find((h) => h.concept === concept)?.moves

describe('strike the center', () => {
  it('finds pawn moves that hit an enemy central pawn', () => {
    expect(hit(fenAfter('e4 e5'), 'strike-center')?.sort()).toEqual(['d4', 'f4'])
    expect(hit(fenAfter('e4'), 'strike-center')?.sort()).toEqual(['d5', 'f5'])
    // Italian, 4...Nf6: f4 is blocked by the knight, d3 hits nothing.
    expect(hit(CENTER.fen, 'strike-center')).toEqual(['d4'])
  })

  it('includes captures on a central square', () => {
    expect(hit(fenAfter('e4 d5'), 'strike-center')).toContain('exd5')
  })

  it('needs an enemy central pawn', () => {
    expect(hit(START, 'strike-center')).toBeUndefined()
    expect(hit(fenAfter('Nf3 Nf6'), 'strike-center')).toBeUndefined()
  })

  it('starts at move 3 by default', () => {
    const concepts = (fen: string) => detectConcepts(fen).map((h) => h.concept)
    expect(concepts(fenAfter('e4 e5'))).not.toContain('strike-center')
    expect(concepts(fenAfter('e4 e5 Nf3 Nc6'))).toContain('strike-center')
  })

  it('stops after the opening', () => {
    expect(detectConcepts(fenAfter('e4 e5'), { maxMove: 1 })).toEqual([])
  })
})

describe('castle early', () => {
  it('offers castling from the configured move on', () => {
    expect(hit(CENTER.fen, 'castle-early')).toEqual(['O-O'])
    expect(detectConcepts(CENTER.fen, { castleFromMove: 6 }).map((h) => h.concept)).not.toContain(
      'castle-early',
    )
  })

  it('needs castling to be legal', () => {
    expect(hit(fenAfter('e4 e5 Nf3 Nc6 Bc4 Bc5'), 'castle-early')).toEqual(['O-O'])
    expect(hit(fenAfter('e4 e5 Nf3 Nc6'), 'castle-early')).toBeUndefined()
  })
})

describe('punish the early queen', () => {
  it('finds developing and pawn moves that attack the queen', () => {
    expect(hit(fenAfter('e4 e5 Qh5'), 'punish-early-queen')?.sort()).toEqual(['Nf6', 'g6'])
  })

  it('leaves out attackers that are simply lost', () => {
    // 1.e4 d5 2.exd5 Qxd5: Nc3 and c4 (covered by the f1 bishop) hit the queen;
    // Bc4 also hits it but loses the bishop.
    const moves = hit(fenAfter('e4 d5 exd5 Qxd5'), 'punish-early-queen')
    expect(moves?.sort()).toEqual(['Nc3', 'c4'])
  })

  it('needs an enemy queen off its home square', () => {
    expect(hit(fenAfter('e4 e5'), 'punish-early-queen')).toBeUndefined()
  })
})

describe('develop before attacking', () => {
  it('lists minor-piece moves from home that are not simply lost', () => {
    expect(developingMoves(START).sort()).toEqual(['Na3', 'Nc3', 'Nf3', 'Nh3'])
    const black = developingMoves(fenAfter('e4 e5 Nf3'))
    expect(black).toEqual(expect.arrayContaining(['Nc6', 'Nf6', 'Bc5', 'Bb4']))
    expect(black).not.toContain('Ba3') // bxa3
  })

  it('flags early queen moves, moving a piece twice and flank pawn lunges', () => {
    expect(prematureAttack(START, ['e4', 'e5'], 'Qh5')).toBe(true)
    expect(prematureAttack(START, ['e4', 'e5', 'Nf3', 'Nc6'], 'Ng5')).toBe(true)
    expect(prematureAttack(START, ['e4', 'e5'], 'h4')).toBe(true)
    expect(prematureAttack(START, ['e4', 'e5'], 'g4')).toBe(true)
  })

  it('does not flag development, small pawn moves or late moves', () => {
    expect(prematureAttack(START, ['e4', 'e5', 'Nf3', 'Nc6'], 'Bc4')).toBe(false)
    expect(prematureAttack(START, ['e4', 'e5'], 'h3')).toBe(false)
    const developed = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'Nc3', 'Bc5']
    expect(prematureAttack(START, developed, 'Qe2')).toBe(false)
  })
})
