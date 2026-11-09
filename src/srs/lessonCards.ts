// Solved concept lessons become FSRS cards (T6.5). Not React.

import { createEmptyCard } from 'ts-fsrs'
import { getSettings, nodeId, type CardRow, type TrainerDB } from '../db'
// Direct module imports: the lessons index also re-exports React pages.
import type { Lesson, LessonPack } from '../lessons/lesson'
import { positionKey } from '../repertoire/positionKey'
import { autoGrade, outcomeDetails, type AutoGrade, type ReviewOutcome } from './grading'
import { applyReview, createScheduler } from './scheduler'

/** Lesson cards live under a pseudo-repertoire per pack. Repertoire ids are UUIDs: no clash. */
export const LESSON_REPERTOIRE_PREFIX = 'lessons/'

export function lessonRepertoireId(packId: string): string {
  return `${LESSON_REPERTOIRE_PREFIX}${packId}`
}

/** `${repertoireId}:${positionKey}`, like every card id. */
export function lessonCardId(packId: string, fen: string): string {
  return nodeId(lessonRepertoireId(packId), positionKey(fen))
}

export function isLessonCard(card: Pick<CardRow, 'origin'>): boolean {
  return card.origin === 'lesson'
}

/** A fresh card for a lesson. Its answer is the main accepted move. */
export function newLessonCard(pack: Pick<LessonPack, 'id'>, lesson: Lesson, now: Date): CardRow {
  return {
    ...createEmptyCard(now),
    id: lessonCardId(pack.id, lesson.fen),
    repertoireId: lessonRepertoireId(pack.id),
    positionKey: positionKey(lesson.fen),
    answer: lesson.accepted[0],
    origin: 'lesson',
    lessonId: lesson.id,
  }
}

export type LessonSolvedResult =
  { created: true; card: CardRow; grade: AutoGrade } | { created: false; card: CardRow }

/**
 * Called when a lesson is solved in the lesson player. The first solve creates the card
 * and counts as its first review, graded from how it went (so a lesson that took two
 * tries comes back soon). Later solves are practice: the card is left to its schedule.
 */
export async function recordLessonSolved(
  db: TrainerDB,
  pack: Pick<LessonPack, 'id'>,
  lesson: Lesson,
  outcome: ReviewOutcome,
  now: Date = new Date(),
): Promise<LessonSolvedResult> {
  return db.transaction('rw', db.cards, db.reviewLogs, db.settings, async () => {
    const id = lessonCardId(pack.id, lesson.fen)
    const existing = await db.cards.get(id)
    if (existing) return { created: false, card: existing }
    const settings = await getSettings(db)
    const grade = autoGrade(outcome, settings.grading)
    const { card, log } = applyReview(
      createScheduler(settings),
      newLessonCard(pack, lesson, now),
      grade.rating,
      now,
      outcomeDetails(outcome),
    )
    await db.cards.put(card)
    await db.reviewLogs.add(log)
    return { created: true, card, grade }
  })
}

/** Finds the lesson a card was made from, if its pack still has it on the same position. */
export function lessonForCard(
  card: Pick<CardRow, 'repertoireId' | 'lessonId' | 'positionKey'>,
  packs: readonly LessonPack[],
): Lesson | undefined {
  const pack = packs.find((p) => lessonRepertoireId(p.id) === card.repertoireId)
  const lesson = pack?.lessons.find((l) => l.id === card.lessonId)
  return lesson && positionKey(lesson.fen) === card.positionKey ? lesson : undefined
}
