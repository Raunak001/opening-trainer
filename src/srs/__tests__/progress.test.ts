import { createEmptyCard, State } from 'ts-fsrs'
import { describe, expect, it } from 'vitest'
import type { CardRow } from '../../db'
import { keyAfter } from '../../repertoire/__tests__/fakeWorld'
import { addMove, createTree, type RepertoireTree } from '../../repertoire/tree'
import {
  cardMastery,
  endOfDay,
  lineProgress,
  overallMastery,
  studyStreak,
  todayCounts,
} from '../progress'

// Local times, so "today" is the machine's own calendar day.
const NOW = new Date(2026, 10, 8, 18, 0) // 8 Nov, 18:00
const at = (day: number, hour = 12) => new Date(2026, 10, day, hour)

function card(line: string, patch: Partial<CardRow> = {}): CardRow {
  return {
    ...createEmptyCard(at(1)),
    id: `rep:${keyAfter(line)}`,
    repertoireId: 'rep',
    positionKey: keyAfter(line),
    answer: 'x',
    ...patch,
  }
}
const studied = (line: string, stability: number, due = at(20)) =>
  card(line, { state: State.Review, stability, due, reps: 3 })

describe('endOfDay', () => {
  it('is the next local midnight', () => {
    expect(endOfDay(NOW)).toEqual(new Date(2026, 10, 9))
    expect(endOfDay(new Date(2026, 11, 31, 23, 59))).toEqual(new Date(2027, 0, 1))
  })
})

describe('todayCounts', () => {
  const limits = { reviews: 200 }
  const none = { reviews: 0 }

  it('counts started cards due before midnight, by kind', () => {
    const counts = todayCounts(
      [
        studied('e4', 5, at(7)), // overdue
        studied('d4', 5, at(8, 23)), // later today
        studied('c4', 5, at(9, 0)), // tomorrow
        card('Nf3', { state: State.Learning, due: at(8, 18) }),
        card('g3', { state: State.Relearning, due: at(8, 19) }),
        card('b3'), // new
        card('f4'),
        card('e3', { suspended: true }),
        studied('b4', 5, at(1)),
      ].map((c, i) => (i === 8 ? { ...c, suspended: true } : c)),
      NOW,
      limits,
      none,
    )
    expect(counts).toEqual({
      due: 4,
      learning: 2,
      review: 2,
      reviewWithinCap: 2,
      newTotal: 2,
    })
  })

  it("applies what is left of today's review cap", () => {
    const cards = [studied('e4', 5, at(7)), studied('d4', 5, at(7)), card('c4'), card('Nf3')]
    expect(todayCounts(cards, NOW, { reviews: 5 }, { reviews: 4 })).toMatchObject({
      review: 2,
      reviewWithinCap: 1,
      newTotal: 2,
    })
    expect(todayCounts(cards, NOW, limits, { reviews: 300 })).toMatchObject({
      reviewWithinCap: 0,
      newTotal: 2,
    })
  })
})

describe('studyStreak', () => {
  it('is zero with no reviews', () => {
    expect(studyStreak([], NOW)).toEqual({ current: 0, longest: 0, studiedToday: false })
  })

  it('counts consecutive days ending today, once per day', () => {
    const s = studyStreak([at(6), at(7, 9), at(7, 21), at(8, 8)], NOW)
    expect(s).toEqual({ current: 3, longest: 3, studiedToday: true })
  })

  it('stays alive until the end of today when yesterday was the last study day', () => {
    expect(studyStreak([at(6), at(7)], NOW)).toEqual({
      current: 2,
      longest: 2,
      studiedToday: false,
    })
  })

  it('breaks after a missed day but remembers the longest', () => {
    const s = studyStreak([at(1), at(2), at(3), at(4), at(6)], NOW)
    expect(s).toEqual({ current: 0, longest: 4, studiedToday: false })
    expect(studyStreak([at(1), at(2), at(3), at(5), at(7), at(8)], NOW).current).toBe(2)
  })

  it('ignores order and future times', () => {
    expect(studyStreak([at(8), at(7), at(9), at(10)], NOW)).toMatchObject({
      current: 2,
      studiedToday: true,
    })
  })

  it('counts calendar days across a month boundary', () => {
    const now = new Date(2026, 11, 1, 10)
    expect(studyStreak([new Date(2026, 10, 29), new Date(2026, 10, 30), now], now).current).toBe(3)
  })
})

describe('mastery', () => {
  it('scales stability to the mastered threshold; new cards are 0', () => {
    expect(cardMastery(card('e4'), 21)).toBe(0)
    expect(cardMastery(studied('e4', 10.5), 21)).toBe(0.5)
    expect(cardMastery(studied('e4', 60), 21)).toBe(1)
    expect(cardMastery(studied('e4', 7), 14)).toBe(0.5)
  })

  it('averages over live cards', () => {
    expect(
      overallMastery([studied('a3', 21), card('b3'), studied('c3', 0, at(1))], 21),
    ).toBeCloseTo(1 / 3)
    expect(overallMastery([card('h3', { suspended: true })], 21)).toBe(0)
    expect(overallMastery([], 21)).toBe(0)
  })
})

describe('lineProgress', () => {
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

  // White: 1.e4, then 2.Nf3 (vs e5) and 2.c3 (vs c5). Two lines, three cards.
  const TREE = addLine(addLine(createTree(), 'e4 e5 Nf3'), 'e4 c5 c3')
  const CARDS = [
    studied('', 21), // 1.e4: shared by both lines
    studied('e4 e5', 10.5), // 2.Nf3
    card('e4 c5'), // 2.c3, not studied yet
  ]

  it('one entry per leaf, with the cards on its path, weakest first', () => {
    const lines = lineProgress(TREE, CARDS, 21)
    expect(lines.map((l) => l.moves.join(' '))).toEqual(['e4 c5 c3', 'e4 e5 Nf3'])
    expect(lines[0]).toMatchObject({
      leafKey: keyAfter('e4 c5 c3'),
      cards: 2,
      studied: 1,
      meanStability: 10.5, // (21 + 0) / 2
      mastery: 0.5, // (1 + 0) / 2
    })
    expect(lines[1]).toMatchObject({ cards: 2, studied: 2, meanStability: 15.75, mastery: 0.75 })
    expect(lines[1].positions).toEqual(['', 'e4', 'e4 e5', 'e4 e5 Nf3'].map(keyAfter))
  })

  it('leaves out suspended cards and lines with no cards', () => {
    const lines = lineProgress(
      TREE,
      [card('e4 c5'), { ...studied('e4 e5', 5), suspended: true }],
      21,
    )
    expect(lines.map((l) => l.moves.join(' '))).toEqual(['e4 c5 c3'])
  })

  it('follows the shortest route into a transposed position', () => {
    // The Italian reached by 1.e4 e5 2.Nf3 Nc6 3.Bc4 and 1.Nf3 Nc6 2.e4 e5 3.Bc4: one leaf.
    const tree = addLine(addLine(createTree(), 'e4 e5 Nf3 Nc6 Bc4'), 'Nf3 Nc6 e4 e5')
    const lines = lineProgress(tree, [studied('e4 e5 Nf3 Nc6', 21)], 21)
    expect(lines).toHaveLength(1)
    expect(lines[0].moves).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'])
  })
})
