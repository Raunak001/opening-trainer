import { createEmptyCard, Rating, State, type Grade } from 'ts-fsrs'
import { describe, expect, it } from 'vitest'
import type { CardRow, ReviewLogRow } from '../../db'
import {
  answerCurrent,
  buildDueQueue,
  createSession,
  currentCard,
  dailyUsage,
  isFinished,
  queueKind,
  startOfDay,
  type DueQueue,
  type QueueOptions,
} from '../queue'
import { applyReview, createScheduler } from '../scheduler'

// Local times so day boundaries are the machine's own midnight.
const NOW = new Date(2026, 10, 6, 18, 0) // 6 Nov, 18:00
const at = (day: number, hour: number, min = 0) => new Date(2026, 10, day, hour, min)

function card(id: string, patch: Partial<CardRow> = {}): CardRow {
  return {
    ...createEmptyCard(at(1, 9)),
    id: `rep:${id}`,
    repertoireId: 'rep',
    positionKey: id,
    answer: 'e4',
    ...patch,
  }
}
const review = (id: string, due: Date) => card(id, { state: State.Review, due, reps: 3 })
const learning = (id: string, due: Date) => card(id, { state: State.Learning, due, reps: 1 })

const LIMITS = { newCards: 20, reviews: 200 }
const opts = (patch: Partial<QueueOptions> = {}): QueueOptions => ({
  limits: LIMITS,
  usage: { newCards: 0, reviews: 0 },
  ...patch,
})
const ids = (q: { cards: CardRow[] }) => q.cards.map((c) => c.positionKey)

function log(cardId: string, state: State, when: Date): ReviewLogRow {
  return {
    cardId: `rep:${cardId}`,
    repertoireId: 'rep',
    state,
    rating: Rating.Good,
    review: when,
    due: when,
    stability: 1,
    difficulty: 5,
    scheduled_days: 0,
    learning_steps: 0,
  }
}

describe('helpers', () => {
  it('starts the day at local midnight', () => {
    expect(startOfDay(NOW)).toEqual(at(6, 0))
    expect(startOfDay(at(6, 0))).toEqual(at(6, 0))
  })

  it('classifies cards by FSRS state', () => {
    expect(queueKind(card('a'))).toBe('new')
    expect(queueKind(review('a', NOW))).toBe('review')
    expect(queueKind(learning('a', NOW))).toBe('learning')
    expect(queueKind(card('a', { state: State.Relearning }))).toBe('learning')
  })
})

describe('dailyUsage', () => {
  it("counts today's distinct new and review cards only", () => {
    const usage = dailyUsage(
      [
        log('a', State.New, at(6, 9)),
        log('a', State.Learning, at(6, 9, 1)), // same card's learning step: not a new card again
        log('b', State.New, at(6, 10)),
        log('c', State.Review, at(6, 11)),
        log('c', State.Relearning, at(6, 11, 5)), // relearning steps are not counted
        log('d', State.Review, at(6, 12)),
        log('d', State.Review, at(6, 13)), // same review card twice: counted once
        log('e', State.New, at(5, 23, 59)), // yesterday
        log('f', State.Review, at(6, 19)), // after `now`
      ],
      NOW,
    )
    expect(usage).toEqual({ newCards: 2, reviews: 2 })
  })
})

describe('buildDueQueue', () => {
  const cards = [
    card('new-deep'),
    card('new-shallow'),
    review('rev-old', at(2, 9)),
    review('rev-recent', at(6, 8)),
    review('rev-future', at(7, 9)),
    learning('learn-due', at(6, 17, 55)),
    learning('learn-later', at(6, 18, 10)),
    card('suspended-new', { suspended: true }),
    review('suspended-rev', at(1, 9)),
  ]
  cards[cards.length - 1].suspended = true
  const rank = new Map([
    ['new-shallow', 2],
    ['new-deep', 6],
  ])

  it('orders learning, then reviews oldest first, then new by rank; skips suspended and not-due', () => {
    const q = buildDueQueue(cards, NOW, opts({ newRank: rank }))
    expect(ids(q)).toEqual(['learn-due', 'rev-old', 'rev-recent', 'new-shallow', 'new-deep'])
    expect(q.counts).toEqual({ learning: 1, review: 2, new: 2 })
    expect(q.heldBack).toEqual({ reviews: 0, newCards: 0 })
  })

  it('puts unranked new cards after ranked ones', () => {
    const q = buildDueQueue([card('x'), card('new-shallow')], NOW, opts({ newRank: rank }))
    expect(ids(q)).toEqual(['new-shallow', 'x'])
  })

  it('caps new cards and reviews by what is left of today', () => {
    const many = [
      ...Array.from({ length: 5 }, (_, i) => review(`r${i}`, at(5, i))),
      ...Array.from({ length: 5 }, (_, i) => card(`n${i}`)),
    ]
    const q = buildDueQueue(
      many,
      NOW,
      opts({ limits: { newCards: 3, reviews: 4 }, usage: { newCards: 1, reviews: 1 } }),
    )
    expect(q.counts).toEqual({ learning: 0, review: 3, new: 2 })
    expect(ids(q)).toEqual(['r0', 'r1', 'r2', 'n0', 'n1'])
    expect(q.heldBack).toEqual({ reviews: 2, newCards: 3 })
  })

  it('never blocks learning cards, even with both caps used up', () => {
    const q = buildDueQueue(
      [learning('l', at(6, 17)), review('r', at(6, 1)), card('n')],
      NOW,
      opts({ limits: { newCards: 2, reviews: 2 }, usage: { newCards: 5, reviews: 5 } }),
    )
    expect(ids(q)).toEqual(['l'])
    expect(q.heldBack).toEqual({ reviews: 1, newCards: 1 })
  })

  it('treats due exactly now as due', () => {
    expect(ids(buildDueQueue([review('r', NOW)], NOW, opts()))).toEqual(['r'])
  })
})

describe('session', () => {
  const queueOf = (...names: string[]): DueQueue => ({
    cards: names.map((n) => card(n)),
    counts: { learning: 0, review: 0, new: names.length },
    heldBack: { reviews: 0, newCards: 0 },
  })
  const answer = (s: ReturnType<typeof createSession>, rating: Grade) =>
    answerCurrent(s, currentCard(s) as CardRow, rating)

  it('walks the queue in order', () => {
    let s = createSession(queueOf('a', 'b'))
    expect(currentCard(s)?.positionKey).toBe('a')
    s = answer(s, Rating.Good)
    expect(currentCard(s)?.positionKey).toBe('b')
    s = answer(s, Rating.Good)
    expect(isFinished(s)).toBe(true)
    expect(currentCard(s)).toBeUndefined()
    expect(s.answered[Rating.Good]).toBe(2)
  })

  it('requeues Again three cards later', () => {
    let s = createSession(queueOf('a', 'b', 'c', 'd', 'e'))
    s = answer(s, Rating.Again)
    expect(s.pending.map((id) => id.slice(4))).toEqual(['b', 'c', 'd', 'a', 'e'])
    expect(s.requeued).toBe(1)
  })

  it('requeues at the end when fewer cards remain, and immediately when alone', () => {
    let s = createSession(queueOf('a', 'b'))
    s = answer(s, Rating.Again)
    expect(s.pending.map((id) => id.slice(4))).toEqual(['b', 'a'])

    let solo = createSession(queueOf('only'))
    solo = answer(solo, Rating.Again)
    expect(currentCard(solo)?.positionKey).toBe('only')
    solo = answer(solo, Rating.Good)
    expect(isFinished(solo)).toBe(true)
    expect(solo.answered).toMatchObject({ [Rating.Again]: 1, [Rating.Good]: 1 })
  })

  it('honours a custom gap', () => {
    const s = answer(createSession(queueOf('a', 'b', 'c'), 1), Rating.Again)
    expect(s.pending.map((id) => id.slice(4))).toEqual(['b', 'a', 'c'])
  })

  it('keeps the latest card state and does not mutate the old session', () => {
    const s0 = createSession(queueOf('a', 'b'))
    const updated = { ...card('a'), reps: 1, state: State.Learning }
    const s1 = answerCurrent(s0, updated, Rating.Again)
    expect(s1.cards['rep:a']).toBe(updated)
    expect(s0.cards['rep:a'].reps).toBe(0)
    expect(s0.pending).toEqual(['rep:a', 'rep:b'])
  })

  it('rejects answers for the wrong card or after the end', () => {
    const s = createSession(queueOf('a', 'b'))
    expect(() => answerCurrent(s, card('b'), Rating.Good)).toThrow(/current card is "rep:a"/)
    const done = createSession(queueOf())
    expect(() => answerCurrent(done, card('a'), Rating.Good)).toThrow(/already finished/)
  })

  it('a failed card comes back with its rescheduled state (with real FSRS)', () => {
    const scheduler = createScheduler()
    let s = createSession(queueOf('a', 'b', 'c', 'd'))
    const failed = applyReview(scheduler, currentCard(s) as CardRow, Rating.Again, NOW).card
    s = answerCurrent(s, failed, Rating.Again)
    for (let i = 0; i < 3; i++) s = answer(s, Rating.Good)
    expect(currentCard(s)).toMatchObject({ positionKey: 'a', state: State.Learning, reps: 1 })
  })
})
