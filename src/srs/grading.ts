import { Rating, type Grade } from 'ts-fsrs'
import type { AppSettings, ReviewDetails } from '../db'

/** What happened when the user answered one card. */
export interface ReviewOutcome {
  /** Wrong moves played before the right one. */
  mistakes: number
  /** The hint was requested (any level). */
  hintUsed: boolean
  /** From the prompt to the correct move. */
  durationMs: number
}

export type GradeReason = 'wrong' | 'hint' | 'slow' | 'fast' | 'normal'

export interface AutoGrade {
  rating: Grade
  reason: GradeReason
}

/**
 * CLAUDE.md auto-grading, first match wins:
 *   wrong → Again; hint used or slower than `hardAfterMs` → Hard;
 *   faster than `easyUnderMs` → Easy; otherwise Good.
 * Both time limits are strict: exactly on a threshold is Good.
 * A duration that is not a finite, non-negative number is ignored (no Hard/Easy from time).
 */
export function autoGrade(outcome: ReviewOutcome, thresholds: AppSettings['grading']): AutoGrade {
  if (outcome.mistakes > 0) return { rating: Rating.Again, reason: 'wrong' }
  if (outcome.hintUsed) return { rating: Rating.Hard, reason: 'hint' }
  const ms = outcome.durationMs
  const timed = Number.isFinite(ms) && ms >= 0
  if (timed && ms > thresholds.hardAfterMs) return { rating: Rating.Hard, reason: 'slow' }
  if (timed && ms < thresholds.easyUnderMs) return { rating: Rating.Easy, reason: 'fast' }
  return { rating: Rating.Good, reason: 'normal' }
}

/** The outcome as stored on the review log. */
export function outcomeDetails(outcome: ReviewOutcome): ReviewDetails {
  return {
    durationMs: outcome.durationMs,
    hintUsed: outcome.hintUsed,
    mistakes: outcome.mistakes,
  }
}
