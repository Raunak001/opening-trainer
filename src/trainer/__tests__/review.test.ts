import { createEmptyCard, Rating } from 'ts-fsrs'
import { describe, expect, it } from 'vitest'
import type { CardRow } from '../../db'
import { keyAfter } from '../../repertoire/__tests__/fakeWorld'
import { addMove, createTree, type RepertoireTree } from '../../repertoire/tree'
import { createDrill } from '../drill'
import { cardLine, isPlayable, formatInterval, gradeFeedback, ratingName } from '../review'

function addLine(tree: RepertoireTree, line: string) {
  let t = tree
  let key = t.rootKey
  for (const san of line.split(' ')) {
    const r = addMove(t, key, san)
    t = r.tree
    key = r.node.key
  }
  return t
}

// Two routes to the Italian: the card's context follows the shortest one.
const TREE = addLine(addLine(createTree(), 'e4 e5 Nf3 Nc6 Bc4'), 'Nf3 Nc6 e4 e5 Bc4')

const card = (line: string, answer: string): CardRow => ({
  ...createEmptyCard(new Date(2026, 10, 6)),
  id: `rep:${keyAfter(line)}`,
  repertoireId: 'rep',
  positionKey: keyAfter(line),
  answer,
})

describe('cardLine', () => {
  it('plays the path to the card as context, then asks for the answer', () => {
    const line = cardLine(card('e4 e5 Nf3 Nc6', 'Bc4'), { tree: TREE, color: 'white' }, 'Italian')
    expect(line).toEqual({
      id: `rep:${keyAfter('e4 e5 Nf3 Nc6')}#0`,
      name: 'Italian',
      side: 'white',
      moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'],
      autoPlay: 4,
    })
    const drill = createDrill(line)
    expect(drill.steps.filter((s) => !s.auto).map((s) => s.san)).toEqual(['Bc4'])
  })

  it('works for Black and for the root position', () => {
    const black = cardLine(card('e4 e5 Nf3', 'Nc6'), { tree: TREE, color: 'black' }, 'x', 2)
    expect(black).toMatchObject({ moves: ['e4', 'e5', 'Nf3', 'Nc6'], autoPlay: 3, side: 'black' })
    expect(black.id.endsWith('#2')).toBe(true)
    expect(createDrill(black).status).toBe('replaying')

    const root = cardLine(card('', 'e4'), { tree: TREE, color: 'white' }, 'x')
    expect(root).toMatchObject({ moves: ['e4'], autoPlay: 0 })
    expect(createDrill(root).status).toBe('awaitingUser')
  })

  it('plays a game card from its own moves; it need not be in the tree', () => {
    const gameCard = { ...card('e4 d5', 'exd5'), origin: 'game' as const, line: ['e4', 'd5'] }
    expect(isPlayable(gameCard, TREE)).toBe(true)
    expect(isPlayable(card('e4 d5', 'exd5'), TREE)).toBe(false)
    expect(cardLine(gameCard, { tree: TREE, color: 'white' }, 'x')).toMatchObject({
      moves: ['e4', 'd5', 'exd5'],
      autoPlay: 2,
    })
  })

  it('throws for a position missing from the tree', () => {
    expect(() => cardLine(card('d4', 'd5'), { tree: TREE, color: 'black' }, 'x')).toThrow()
  })
})

describe('feedback text', () => {
  it('formats intervals', () => {
    expect(formatInterval(30_000)).toBe('1 min')
    expect(formatInterval(10 * 60_000)).toBe('10 min')
    expect(formatInterval(3 * 3_600_000)).toBe('3 h')
    expect(formatInterval(26 * 3_600_000)).toBe('1 day')
    expect(formatInterval(39 * 86_400_000)).toBe('39 days')
  })

  it('names the rating, the reason and the next review', () => {
    expect(ratingName(Rating.Easy)).toBe('Easy')
    expect(gradeFeedback({ rating: Rating.Good, reason: 'normal' }, 6_000, 600_000)).toBe(
      'Good: Correct! Next review in 10 min.',
    )
    expect(gradeFeedback({ rating: Rating.Hard, reason: 'slow' }, 21_400, 86_400_000)).toBe(
      'Hard: Correct, in 21s. Next review in 1 day.',
    )
    expect(gradeFeedback({ rating: Rating.Hard, reason: 'hint' }, 4_000, 300_000)).toBe(
      'Hard: You used a hint. Next review in 5 min.',
    )
    expect(gradeFeedback({ rating: Rating.Easy, reason: 'fast' }, 1_200, 8 * 86_400_000)).toBe(
      'Easy: Instant, 1s! Next review in 8 days.',
    )
    expect(gradeFeedback({ rating: Rating.Again, reason: 'wrong' }, 9_000, 60_000)).toBe(
      'Again: Not first time. It comes back shortly.',
    )
  })
})
