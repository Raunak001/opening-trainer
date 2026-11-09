import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { Rating, State } from 'ts-fsrs'
import { afterEach, describe, expect, it } from 'vitest'
import { TrainerDB } from '../../db'
import { CENTER, PACK, QUEEN } from '../../lessons/__tests__/fixtures'
import { positionKey } from '../../repertoire/positionKey'
import {
  isLessonCard,
  lessonCardId,
  lessonForCard,
  lessonRepertoireId,
  newLessonCard,
  recordLessonSolved,
} from '../lessonCards'
import { loadDueQueue } from '../scheduler'

const names: string[] = []
afterEach(async () => {
  for (const n of names.splice(0)) await Dexie.delete(n)
})
function openDb() {
  const name = `lesson-cards-${names.length}`
  names.push(name)
  return new TrainerDB(name)
}

const NOW = new Date('2026-11-09T12:00:00Z')
const clean = { mistakes: 0, hintUsed: false, durationMs: 5_000 }

describe('lesson card ids', () => {
  it('use a per-pack pseudo-repertoire and the position key', () => {
    expect(lessonRepertoireId('test-pack')).toBe('lessons/test-pack')
    expect(lessonCardId('test-pack', CENTER.fen)).toBe(
      `lessons/test-pack:${positionKey(CENTER.fen)}`,
    )
  })

  it('builds a fresh card answered by the main move', () => {
    const card = newLessonCard(PACK, CENTER, NOW)
    expect(card).toMatchObject({
      id: lessonCardId(PACK.id, CENTER.fen),
      repertoireId: 'lessons/test-pack',
      positionKey: positionKey(CENTER.fen),
      answer: 'd4',
      origin: 'lesson',
      lessonId: 'center-01',
      state: State.New,
    })
    expect(isLessonCard(card)).toBe(true)
    expect(isLessonCard({ origin: 'game' })).toBe(false)
  })

  it('finds the lesson behind a card, only while it is on the same position', () => {
    const card = newLessonCard(PACK, QUEEN, NOW)
    expect(lessonForCard(card, [PACK])).toBe(QUEEN)
    expect(lessonForCard(card, [])).toBeUndefined()
    const moved = { ...PACK, lessons: [{ ...QUEEN, fen: CENTER.fen }] }
    expect(lessonForCard(card, [moved])).toBeUndefined()
  })
})

describe('recordLessonSolved', () => {
  it('creates the card on the first solve, graded as its first review', async () => {
    const db = openDb()
    const result = await recordLessonSolved(db, PACK, CENTER, clean, NOW)
    expect(result.created).toBe(true)
    if (!result.created) return
    expect(result.grade.rating).toBe(Rating.Good)
    expect(result.card.due.getTime()).toBeGreaterThan(NOW.getTime())

    const stored = await db.cards.get(lessonCardId(PACK.id, CENTER.fen))
    expect(stored).toMatchObject({ origin: 'lesson', reps: 1, lessonId: 'center-01' })
    const logs = await db.reviewLogs.toArray()
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({
      cardId: stored?.id,
      repertoireId: 'lessons/test-pack',
      rating: Rating.Good,
      durationMs: 5_000,
      mistakes: 0,
    })
  })

  it('leaves an existing card alone on later solves', async () => {
    const db = openDb()
    await recordLessonSolved(db, PACK, CENTER, clean, NOW)
    const again = await recordLessonSolved(db, PACK, CENTER, { ...clean, mistakes: 3 }, NOW)
    expect(again.created).toBe(false)
    expect(await db.reviewLogs.count()).toBe(1)
  })

  it('brings a lesson that took several tries back the same day', async () => {
    const db = openDb()
    const result = await recordLessonSolved(db, PACK, QUEEN, { ...clean, mistakes: 1 }, NOW)
    expect(result.created && result.grade.rating).toBe(Rating.Again)
    const later = new Date(NOW.getTime() + 60 * 60_000)
    const queue = await loadDueQueue(db, later)
    expect(queue.cards.map((c) => c.id)).toEqual([lessonCardId(PACK.id, QUEEN.fen)])
  })
})
