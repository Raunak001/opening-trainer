import { Rating, type Grade } from 'ts-fsrs'
import type { CardRow } from '../db'
// Direct module imports: the repertoire index also re-exports React pages.
import type { Color } from '../repertoire/prune'
import { pathTo, type RepertoireTree } from '../repertoire/tree'
import type { AutoGrade } from '../srs'
import type { Line } from './drill'

/**
 * The drill line for one card: the moves from the root to the card's
 * position, played automatically as context, then the card's answer for the
 * user to find. Game cards (positions outside the tree) carry their own moves.
 * `attempt` keeps line ids unique when a card is retried.
 * Throws if a tree card's position is not in the tree.
 */
export function cardLine(
  card: CardRow,
  repertoire: { tree: RepertoireTree; color: Color },
  name: string,
  attempt = 0,
): Line {
  const context = card.line ? [...card.line] : pathTo(repertoire.tree, card.positionKey)
  return {
    id: `${card.id}#${attempt}`,
    name,
    side: repertoire.color,
    moves: [...context, card.answer],
    autoPlay: context.length,
  }
}

/** Whether a card can be shown: its position is in the tree, or it carries its own line. */
export function isPlayable(card: CardRow, tree: RepertoireTree): boolean {
  return card.line !== undefined || tree.nodes[card.positionKey] !== undefined
}

const RATING_NAMES: Record<Grade, string> = {
  [Rating.Again]: 'Again',
  [Rating.Hard]: 'Hard',
  [Rating.Good]: 'Good',
  [Rating.Easy]: 'Easy',
}

export function ratingName(rating: Grade): string {
  return RATING_NAMES[rating]
}

/** "1 min", "10 min", "3 h", "1 day", "39 days" */
export function formatInterval(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000))
  if (min < 60) return `${min} min`
  const hours = Math.round(min / 60)
  if (hours < 24) return `${hours} h`
  const days = Math.round(hours / 24)
  return days === 1 ? '1 day' : `${days} days`
}

/** Coach line after a card: the grade, why, and when it comes back. */
export function gradeFeedback(grade: AutoGrade, durationMs: number, nextDueInMs: number): string {
  const seconds = Math.round(durationMs / 1000)
  const why: Record<AutoGrade['reason'], string> = {
    wrong: 'Not first time. It comes back shortly.',
    hint: 'You used a hint.',
    slow: `Correct, in ${seconds}s.`,
    fast: `Instant, ${seconds}s!`,
    normal: 'Correct!',
  }
  const when = grade.reason === 'wrong' ? '' : ` Next review in ${formatInterval(nextDueInMs)}.`
  return `${ratingName(grade.rating)}: ${why[grade.reason]}${when}`
}
