import { describe, expect, it } from 'vitest'
import type { PuzzleAttemptRow } from '../../db'
import { INITIAL_RATING } from '../glicko'
import { currentRating, puzzleStats, themeLabel } from '../stats'

const attempt = (i: number, solved: boolean, ratingAfter: number, themes: string[] = []) =>
  ({
    id: i,
    puzzleId: `p${i}`,
    at: new Date(i * 1000),
    solved,
    puzzleRating: 1000,
    themes,
    ratingBefore: 0,
    ratingAfter,
    rdAfter: 100,
    volAfter: 0.06,
    hintUsed: false,
    mistakes: solved ? 0 : 1,
    durationMs: 1000,
  }) satisfies PuzzleAttemptRow

describe('puzzleStats', () => {
  it('is the starting state with no attempts', () => {
    const s = puzzleStats([])
    expect(s).toMatchObject({ attempts: 0, successRate: 0, rating: 1000, peak: 1000, streak: 0 })
    expect(currentRating([])).toEqual(INITIAL_RATING)
  })

  it('summarises attempts in time order', () => {
    const rows = [
      attempt(3, true, 1150, ['fork', 'middlegame']),
      attempt(1, true, 1100, ['fork', 'short']),
      attempt(2, false, 1050, ['pin']),
      attempt(4, true, 1200, ['mateIn1']),
    ]
    const s = puzzleStats(rows)
    expect(s.attempts).toBe(4)
    expect(s.solved).toBe(3)
    expect(s.successRate).toBe(0.75)
    expect(s.rating).toBe(1200)
    expect(s.peak).toBe(1200)
    expect(s.history).toEqual([1000, 1100, 1050, 1150, 1200])
    expect(s.streak).toBe(2)
    expect(s.bestStreak).toBe(2)
    expect(s.themes[0]).toEqual({ theme: 'fork', attempts: 2, solved: 2 })
    expect(s.themes.map((t) => t.theme)).not.toContain('middlegame')
    expect(currentRating(rows).rating).toBe(1200)
  })
})

describe('themeLabel', () => {
  it('turns Lichess tags into words', () => {
    expect(themeLabel('mateIn2')).toBe('Mate in 2')
    expect(themeLabel('hangingPiece')).toBe('Hanging piece')
    expect(themeLabel('fork')).toBe('Fork')
  })
})
