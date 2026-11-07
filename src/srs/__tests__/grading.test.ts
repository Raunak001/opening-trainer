import { Rating } from 'ts-fsrs'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../../db'
import { autoGrade, outcomeDetails, type ReviewOutcome } from '../grading'

const T = DEFAULT_SETTINGS.grading // hard after 15 s, easy under 2 s
const clean: ReviewOutcome = { mistakes: 0, hintUsed: false, durationMs: 6_000 }
const grade = (patch: Partial<ReviewOutcome>, thresholds = T) =>
  autoGrade({ ...clean, ...patch }, thresholds)

describe('autoGrade', () => {
  it('uses the CLAUDE.md defaults', () => {
    expect(T).toEqual({ hardAfterMs: 15_000, easyUnderMs: 2_000 })
  })

  it('normal answer → Good', () => {
    expect(grade({})).toEqual({ rating: Rating.Good, reason: 'normal' })
  })

  it('any wrong move → Again, whatever else happened', () => {
    expect(grade({ mistakes: 1 })).toEqual({ rating: Rating.Again, reason: 'wrong' })
    expect(grade({ mistakes: 2, hintUsed: true, durationMs: 40_000 }).rating).toBe(Rating.Again)
    expect(grade({ mistakes: 1, durationMs: 500 }).rating).toBe(Rating.Again) // fast but wrong
  })

  it('hint used → Hard, even when fast', () => {
    expect(grade({ hintUsed: true })).toEqual({ rating: Rating.Hard, reason: 'hint' })
    expect(grade({ hintUsed: true, durationMs: 800 }).rating).toBe(Rating.Hard)
  })

  it('slower than the Hard threshold → Hard', () => {
    expect(grade({ durationMs: 15_001 })).toEqual({ rating: Rating.Hard, reason: 'slow' })
    expect(grade({ durationMs: 120_000 }).rating).toBe(Rating.Hard)
  })

  it('faster than the Easy threshold → Easy', () => {
    expect(grade({ durationMs: 1_999 })).toEqual({ rating: Rating.Easy, reason: 'fast' })
    expect(grade({ durationMs: 0 }).rating).toBe(Rating.Easy)
  })

  it('exactly on either threshold → Good', () => {
    expect(grade({ durationMs: 15_000 }).rating).toBe(Rating.Good)
    expect(grade({ durationMs: 2_000 }).rating).toBe(Rating.Good)
  })

  it('reads thresholds from settings, not constants', () => {
    const patient = { hardAfterMs: 30_000, easyUnderMs: 5_000 }
    expect(grade({ durationMs: 20_000 }, patient).rating).toBe(Rating.Good)
    expect(grade({ durationMs: 4_000 }, patient).rating).toBe(Rating.Easy)
    expect(grade({ durationMs: 31_000 }, patient).rating).toBe(Rating.Hard)
  })

  it('ignores a duration that is not a real time', () => {
    for (const durationMs of [NaN, Infinity, -1])
      expect(grade({ durationMs }).rating).toBe(Rating.Good)
    expect(grade({ durationMs: NaN, hintUsed: true }).rating).toBe(Rating.Hard)
  })
})

describe('outcomeDetails', () => {
  it('copies the outcome onto the review log fields', () => {
    expect(outcomeDetails({ mistakes: 1, hintUsed: true, durationMs: 9_500 })).toEqual({
      mistakes: 1,
      hintUsed: true,
      durationMs: 9_500,
    })
  })
})
