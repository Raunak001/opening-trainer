import { describe, expect, it } from 'vitest'
import { isPromptMove, makePrompt, pickPrompts, promptsFromLine } from '../movePrompts'
import { seeded } from './rng'

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
// Italian after 1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5: White to move.
const ITALIAN = 'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4'

describe('move prompts', () => {
  it('makes a prompt with from/to and the side to move', () => {
    expect(makePrompt(START, 'Nf3', 'test')).toMatchObject({
      san: 'Nf3',
      from: 'g1',
      to: 'f3',
      view: 'white',
    })
    expect(makePrompt(ITALIAN, 'O-O', 'Italian')).toMatchObject({
      from: 'e1',
      to: 'g1',
      view: 'white',
    })
    expect(makePrompt(START, 'Nf6', 'test')).toBeUndefined()
    expect(makePrompt('not a fen', 'e4', 'test')).toBeUndefined()
  })

  it('walks a line, Black prompts included', () => {
    const ps = promptsFromLine(['e4', 'c6', 'd4', 'd5'], 'Caro-Kann')
    expect(ps.map((p) => `${p.view}:${p.from}${p.to}`)).toEqual([
      'white:e2e4',
      'black:c7c6',
      'white:d2d4',
      'black:d7d5',
    ])
  })

  it('stops a line at an illegal move', () => {
    expect(promptsFromLine(['e4', 'e4', 'd4'], 'x')).toHaveLength(1)
  })

  it('checks the played move, promotion included', () => {
    const p = makePrompt('8/P7/8/8/8/8/8/k6K w - - 0 1', 'a8=Q', 'x')
    if (!p) throw new Error('no prompt')
    expect(isPromptMove(p, 'a7', 'a8', 'q')).toBe(true)
    expect(isPromptMove(p, 'a7', 'a8', 'n')).toBe(false)
    expect(isPromptMove(p, 'a7', 'a8')).toBe(false)
  })

  it('fills a round from cards first, then the fallback, without repeats', () => {
    const cards = promptsFromLine(['e4', 'c5'], 'cards')
    const fallback = promptsFromLine(['d4', 'd5', 'c4'], 'catalog')
    const round = pickPrompts(cards, fallback, 4, seeded(4))
    expect(round).toHaveLength(4)
    expect(round.slice(0, 2).every((p) => p.source === 'cards')).toBe(true)
    expect(new Set(round.map((p) => p.fen)).size).toBe(4)
  })
})
