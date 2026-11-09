import type { TrainerDB } from '../db'
// Direct module imports: the trainer index pulls in React pages.
import { recordLessonSolved } from '../srs/lessonCards'
import type { ReviewOutcome } from '../srs/grading'
import { formatInterval, ratingName } from '../trainer/review'
import type { Lesson, LessonPack } from './lesson'

/** Records a solve as a card (first time only) and says when it is due. */
export async function saveSolvedLesson(
  db: TrainerDB,
  pack: LessonPack,
  lesson: Lesson,
  outcome: ReviewOutcome,
  now: Date = new Date(),
): Promise<string> {
  const result = await recordLessonSolved(db, pack, lesson, outcome, now)
  if (!result.created) return 'Already in your reviews.'
  const due = formatInterval(result.card.due.getTime() - now.getTime())
  return `Added to your reviews (${ratingName(result.grade.rating)}): back in ${due}.`
}
