import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { createEmptyCard, Rating, State, type Grade } from 'ts-fsrs'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, TrainerDB, updateSettings, type CardRow } from '../../db'
import { buildAndSave } from '../../repertoire/builder'
import { DEFAULT_PRUNE_SETTINGS } from '../../repertoire/prune'
import { fakeClient, keyAfter, world } from '../../repertoire/__tests__/fakeWorld'
import {
  applyReview,
  CardNotFoundError,
  createScheduler,
  reviewCard,
  syncCards,
} from '../scheduler'

const T0 = new Date('2026-11-06T12:00:00Z')
const MIN = 60_000
const DAY = 86_400_000

const newCard = (): CardRow => ({
  ...createEmptyCard(T0),
  id: 'rep:pos',
  repertoireId: 'rep',
  positionKey: 'pos',
  answer: 'Nf3',
})

const scheduler = createScheduler()
const rate = (card: CardRow, rating: Grade, at: Date) => applyReview(scheduler, card, rating, at)
const after = (card: CardRow) => card.due.getTime() - T0.getTime()

describe('rating paths from New', () => {
  it('Again → Learning, due in 1 minute', () => {
    const { card } = rate(newCard(), Rating.Again, T0)
    expect(card).toMatchObject({ state: State.Learning, reps: 1, lapses: 0 })
    expect(after(card)).toBe(1 * MIN)
  })

  it('Hard → Learning, due in 5.5 minutes', () => {
    const { card } = rate(newCard(), Rating.Hard, T0)
    expect(card.state).toBe(State.Learning)
    expect(after(card)).toBe(5.5 * MIN)
  })

  it('Good → Learning, due in 10 minutes', () => {
    const { card } = rate(newCard(), Rating.Good, T0)
    expect(card.state).toBe(State.Learning)
    expect(after(card)).toBe(10 * MIN)
  })

  it('Easy → Review, due in days', () => {
    const { card } = rate(newCard(), Rating.Easy, T0)
    expect(card.state).toBe(State.Review)
    expect(card.scheduled_days).toBe(8)
    expect(after(card)).toBe(8 * DAY)
  })
})

describe('rating paths from Learning', () => {
  const learning = rate(newCard(), Rating.Good, T0).card

  it('Good graduates to Review', () => {
    const { card } = rate(learning, Rating.Good, learning.due)
    expect(card.state).toBe(State.Review)
    expect(card.scheduled_days).toBeGreaterThanOrEqual(1)
  })

  it('Again stays in Learning with a short step', () => {
    const { card } = rate(learning, Rating.Again, learning.due)
    expect(card.state).toBe(State.Learning)
    expect(card.due.getTime() - learning.due.getTime()).toBeLessThanOrEqual(10 * MIN)
    expect(card.lapses).toBe(0) // lapses only count forgetting a Review card
  })
})

describe('rating paths from Review', () => {
  const review = rate(newCard(), Rating.Easy, T0).card
  const at = review.due
  const results = ([Rating.Again, Rating.Hard, Rating.Good, Rating.Easy] as const).map(
    (r) => rate(review, r, at).card,
  )
  const [again, hard, good, easy] = results

  it('Again is a lapse: Relearning, lapses + 1, due within minutes', () => {
    expect(again).toMatchObject({ state: State.Relearning, lapses: 1, reps: 2 })
    expect(again.due.getTime() - at.getTime()).toBeLessThan(DAY)
  })

  it('Hard, Good and Easy stay in Review with growing intervals', () => {
    for (const c of [hard, good, easy]) expect(c).toMatchObject({ state: State.Review, lapses: 0 })
    expect(hard.scheduled_days).toBeLessThan(good.scheduled_days)
    expect(good.scheduled_days).toBeLessThan(easy.scheduled_days)
    expect(hard.scheduled_days).toBeGreaterThan(review.scheduled_days)
  })

  it('Good from Relearning returns to Review', () => {
    const { card } = rate(again, Rating.Good, again.due)
    expect(card).toMatchObject({ state: State.Review, lapses: 1 })
  })
})

describe('applyReview', () => {
  it('keeps the card identity and builds a log with details', () => {
    const { card, log } = applyReview(scheduler, newCard(), Rating.Hard, T0, {
      durationMs: 17_000,
      hintUsed: true,
      mistakes: 1,
    })
    expect(card).toMatchObject({ id: 'rep:pos', positionKey: 'pos', answer: 'Nf3' })
    expect(log).toMatchObject({
      cardId: 'rep:pos',
      repertoireId: 'rep',
      rating: Rating.Hard,
      state: State.New, // state before the review
      review: T0,
      durationMs: 17_000,
      hintUsed: true,
      mistakes: 1,
    })
  })

  it('uses the configured retention', () => {
    const strict = createScheduler({
      ...DEFAULT_SETTINGS,
      fsrs: { requestRetention: 0.97 },
    })
    const base = rate(newCard(), Rating.Easy, T0).card
    const tighter = applyReview(strict, newCard(), Rating.Easy, T0).card
    expect(tighter.scheduled_days).toBeLessThan(base.scheduled_days)
  })
})

describe('with the database', () => {
  const names: string[] = []
  const open = () => {
    const name = `srs-test-${names.length}`
    names.push(name)
    return new TrainerDB(name)
  }
  afterEach(async () => {
    for (const n of names.splice(0)) await Dexie.delete(n)
  })

  const WORLD = world({
    '': [['e4', 60, 10, 30]],
    e4: [
      ['e5', 30, 10, 20],
      ['c5', 15, 5, 10],
    ],
    'e4 e5': [
      ['Nf3', 60, 0, 40],
      ['Bc4', 50, 0, 50],
    ],
    'e4 c5': [['c3', 50, 0, 50]],
  })

  async function build(db: TrainerDB, overrides: Record<string, string> = {}, id?: string) {
    return buildAndSave(db, {
      id,
      name: 'e4',
      color: 'white',
      startMoves: ['e4'],
      speeds: ['blitz'],
      ratings: [1600],
      settings: { ...DEFAULT_PRUNE_SETTINGS, maxPly: 3 },
      overrides,
      client: fakeClient(WORLD).client,
    })
  }

  it('reviewCard updates the card and writes one log per rating', async () => {
    const db = open()
    const rep = await build(db)
    await syncCards(db, rep.id, T0)
    const id = `${rep.id}:${keyAfter('e4 e5')}`

    for (const [i, rating] of [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy].entries()) {
      const at = new Date(T0.getTime() + i * DAY)
      const { card, log } = await reviewCard(db, id, rating, at, { durationMs: 1000 * (i + 1) })
      expect(card.reps).toBe(i + 1)
      expect(log.id).toEqual(expect.any(Number))
      expect(await db.cards.get(id)).toEqual(card)
    }
    const logs = await db.reviewLogs.where('cardId').equals(id).sortBy('review')
    expect(logs.map((l) => [l.rating, l.durationMs])).toEqual([
      [Rating.Again, 1000],
      [Rating.Hard, 2000],
      [Rating.Good, 3000],
      [Rating.Easy, 4000],
    ])
  })

  it('reviewCard follows retention saved in settings', async () => {
    const db = open()
    const rep = await build(db)
    await syncCards(db, rep.id, T0)
    const id = `${rep.id}:${keyAfter('')}`
    const easyDefault = (await reviewCard(db, id, Rating.Easy, T0)).card.scheduled_days

    await updateSettings(db, { fsrs: { requestRetention: 0.97 } })
    await db.cards.put({ ...newCard(), id, repertoireId: rep.id, positionKey: keyAfter('') })
    expect((await reviewCard(db, id, Rating.Easy, T0)).card.scheduled_days).toBeLessThan(
      easyDefault,
    )
  })

  it('reviewCard rejects unknown cards and writes nothing', async () => {
    const db = open()
    await expect(reviewCard(db, 'nope', Rating.Good, T0)).rejects.toBeInstanceOf(CardNotFoundError)
    expect(await db.reviewLogs.count()).toBe(0)
  })

  it('syncCards follows the tree through a move swap and back', async () => {
    const db = open()
    const rep = await build(db)
    expect(await syncCards(db, rep.id, T0)).toEqual({
      added: 3, // start (1.e4), after 1...e5 (2.Nf3), after 1...c5 (2.c3)
      reset: 0,
      suspended: 0,
      resumed: 0,
      unchanged: 0,
    })
    expect(await syncCards(db, rep.id, T0)).toMatchObject({ added: 0, unchanged: 3 })

    const e5 = `${rep.id}:${keyAfter('e4 e5')}`
    await reviewCard(db, e5, Rating.Good, T0)

    // Swap 2.Nf3 → 2.Bc4: that card starts over; its review log stays.
    await build(db, { [keyAfter('e4 e5')]: 'Bc4' }, rep.id)
    expect(await syncCards(db, rep.id, T0)).toMatchObject({ reset: 1, unchanged: 2 })
    expect(await db.cards.get(e5)).toMatchObject({ answer: 'Bc4', reps: 0, state: State.New })
    expect(await db.reviewLogs.where('cardId').equals(e5).count()).toBe(1)

    // Shrink the tree to the start move only: deeper cards are suspended, not deleted.
    await buildAndSave(db, {
      id: rep.id,
      name: 'e4',
      color: 'white',
      startMoves: ['e4'],
      speeds: ['blitz'],
      ratings: [1600],
      settings: { ...DEFAULT_PRUNE_SETTINGS, maxPly: 1 },
      client: fakeClient(WORLD).client,
    })
    expect(await syncCards(db, rep.id, T0)).toMatchObject({ suspended: 2, unchanged: 1 })
    expect(await db.cards.where('repertoireId').equals(rep.id).count()).toBe(3)
    expect((await db.cards.get(`${rep.id}:${keyAfter('e4 c5')}`))?.suspended).toBe(true)

    // Back to the full tree: the 2.c3 card resumes with its state.
    await build(db, {}, rep.id)
    expect(await syncCards(db, rep.id, T0)).toMatchObject({ resumed: 1, reset: 1, unchanged: 1 })
  })

  it('syncCards rejects an unknown repertoire', async () => {
    await expect(syncCards(open(), 'missing', T0)).rejects.toThrow('No repertoire "missing"')
  })
})
