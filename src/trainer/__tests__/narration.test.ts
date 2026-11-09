import { Chess } from 'chess.js'
import { describe, expect, it } from 'vitest'
import { addMove, createTree, setNodeStats, type GameStats } from '../../repertoire/tree'
import { conceptTags, narrateMove, numberedSan } from '../narration'

const fenAfter = (sans: string) => {
  const chess = new Chess()
  for (const san of sans.split(' ').filter(Boolean)) chess.move(san)
  return chess.fen()
}

/** Tree node after `prefix` with the given replies (white, draws, black). */
function nodeWith(prefix: string, replies: [string, GameStats][]) {
  let t = createTree(fenAfter(prefix))
  for (const [san, stats] of replies) t = addMove(t, t.rootKey, san, stats).tree
  const total = replies.reduce(
    (s, [, g]) => ({
      white: s.white + g.white,
      draws: s.draws + g.draws,
      black: s.black + g.black,
    }),
    { white: 0, draws: 0, black: 0 },
  )
  return setNodeStats(t, t.rootKey, total).nodes[t.rootKey]
}

const CARO_D5 = 'e4 c6 d4 d5'

describe('numberedSan', () => {
  it('numbers White and Black moves', () => {
    expect(numberedSan(fenAfter(CARO_D5), 'e5')).toBe('3.e5')
    expect(numberedSan(fenAfter('e4 c6 d4 d5 e5'), 'Bf5')).toBe('3…Bf5')
  })
})

describe('conceptTags', () => {
  it('names the ideas behind a move', () => {
    expect(conceptTags(fenAfter(''), 'e4')).toEqual(['takes a central square'])
    expect(conceptTags(fenAfter('e4 c6 d4 d5 e5'), 'c5')).toEqual(['strikes at the centre'])
    expect(conceptTags(fenAfter('e4 c6 d4 d5 e5 Bf5'), 'Nf3')).toEqual(['develops a piece'])
    expect(conceptTags(fenAfter('e4 e5 Nf3 Nc6 Bc4 Nf6'), 'O-O')).toEqual([
      'castles the king to safety',
    ])
    // 1.e4 e5 2.Qh5: 2…Nf6 develops and hits the queen.
    expect(conceptTags(fenAfter('e4 e5 Qh5'), 'Nf6')).toEqual([
      'develops a piece',
      'hits the queen',
    ])
  })
})

describe('narrateMove', () => {
  const node = nodeWith(CARO_D5, [
    ['e5', { white: 300, draws: 100, black: 180 }], // 58%
    ['Nc3', { white: 150, draws: 60, black: 90 }], //  30%
    ['exd5', { white: 40, draws: 40, black: 40 }], //  12%
  ])

  it('says how common an opponent move is', () => {
    const base = { fenBefore: fenAfter(CARO_D5), byUser: false, side: 'black' as const, node }
    expect(narrateMove({ ...base, san: 'e5' })).toBe(
      "3.e5: White's most common reply here (58% of games).",
    )
    expect(narrateMove({ ...base, san: 'Nc3' })).toBe(
      "3.Nc3: White's second most common reply here (30% of games).",
    )
    expect(narrateMove({ ...base, san: 'f3', node: undefined })).toBe('3.f3: White plays f3.')
  })

  it('calls out a new opening name', () => {
    expect(
      narrateMove({
        fenBefore: fenAfter(CARO_D5),
        san: 'e5',
        byUser: false,
        side: 'black',
        node,
        newOpening: 'Caro-Kann Defense: Advance Variation',
      }),
    ).toBe(
      "3.e5: White's most common reply here (58% of games). This is the Caro-Kann Defense: Advance Variation.",
    )
  })

  it('gives your move its score, share, ideas and engine eval', () => {
    const before = fenAfter('e4 c6 d4 d5 e5')
    const mine = nodeWith('e4 c6 d4 d5 e5', [
      ['Bf5', { white: 40, draws: 10, black: 50 }], // 100 games, Black scores 55%
      ['c5', { white: 50, draws: 0, black: 50 }],
    ])
    expect(
      narrateMove({
        fenBefore: before,
        san: 'Bf5',
        byUser: true,
        side: 'black',
        node: mine,
        // White to move after 3…Bf5 and White is better by 0.3.
        evalAfter: { type: 'cp', value: 30 },
      }),
    ).toBe(
      '3…Bf5 is your move. It scores 55% for Black and is played in 50% of games. It develops a piece. Engine: +0.3.',
    )
    // Without stats or eval, just the move and its ideas.
    expect(narrateMove({ fenBefore: fenAfter(''), san: 'e4', byUser: true, side: 'white' })).toBe(
      '1.e4 is your move. It takes a central square.',
    )
  })

  it('shows the engine eval from White’s side after a White move', () => {
    // Black to move after 1.e4 and Black is worse by 0.4 from Black's side.
    expect(
      narrateMove({
        fenBefore: fenAfter(''),
        san: 'e4',
        byUser: true,
        side: 'white',
        evalAfter: { type: 'cp', value: -40 },
      }),
    ).toBe('1.e4 is your move. It takes a central square. Engine: +0.4.')
  })
})
