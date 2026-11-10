import type { PuzzleAttemptRow } from '../db'
import { INITIAL_RATING, type GlickoRating } from './glicko'

/** The user's current puzzle rating: from the latest attempt, or the starting rating. */
export function currentRating(attempts: readonly PuzzleAttemptRow[]): GlickoRating {
  const last = latest(attempts)
  return last ? { rating: last.ratingAfter, rd: last.rdAfter, vol: last.volAfter } : INITIAL_RATING
}

function latest(attempts: readonly PuzzleAttemptRow[]): PuzzleAttemptRow | undefined {
  let last: PuzzleAttemptRow | undefined
  for (const a of attempts) if (!last || a.at.getTime() >= last.at.getTime()) last = a
  return last
}

export interface ThemeStat {
  theme: string
  attempts: number
  solved: number
}

export interface PuzzleStats {
  attempts: number
  solved: number
  /** 0–1; 0 with no attempts. */
  successRate: number
  rating: number
  /** Highest rating reached (the starting rating counts). */
  peak: number
  /** Solved in a row, ending with the latest attempt. */
  streak: number
  bestStreak: number
  /** Rating after each attempt, oldest first, starting with the initial rating. */
  history: number[]
  /** Most-attempted themes first; names as Lichess tags them (camelCase). */
  themes: ThemeStat[]
}

/** Tags that describe length or phase rather than the tactic; left out of the theme table. */
const NON_TACTIC = new Set([
  'oneMove',
  'short',
  'long',
  'veryLong',
  'opening',
  'middlegame',
  'endgame',
  'master',
  'masterVsMaster',
  'superGM',
  'crushing',
  'advantage',
  'equality',
])

export function puzzleStats(attempts: readonly PuzzleAttemptRow[]): PuzzleStats {
  const sorted = [...attempts].sort((a, b) => a.at.getTime() - b.at.getTime())
  const history = [INITIAL_RATING.rating, ...sorted.map((a) => a.ratingAfter)]
  let streak = 0
  let bestStreak = 0
  const themes = new Map<string, ThemeStat>()
  for (const a of sorted) {
    streak = a.solved ? streak + 1 : 0
    bestStreak = Math.max(bestStreak, streak)
    for (const theme of a.themes) {
      if (NON_TACTIC.has(theme)) continue
      const t = themes.get(theme) ?? { theme, attempts: 0, solved: 0 }
      t.attempts++
      if (a.solved) t.solved++
      themes.set(theme, t)
    }
  }
  const solved = sorted.filter((a) => a.solved).length
  return {
    attempts: sorted.length,
    solved,
    successRate: sorted.length > 0 ? solved / sorted.length : 0,
    rating: currentRating(sorted).rating,
    peak: Math.max(...history),
    streak,
    bestStreak,
    history,
    themes: [...themes.values()].sort(
      (a, b) => b.attempts - a.attempts || a.theme.localeCompare(b.theme),
    ),
  }
}

/** "mateIn2" → "Mate in 2", "hangingPiece" → "Hanging piece". */
export function themeLabel(theme: string): string {
  const words = theme
    .replace(/([a-z])([A-Z0-9])/g, '$1 $2')
    .replace(/([0-9])([A-Za-z])/g, '$1 $2')
    .toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}
