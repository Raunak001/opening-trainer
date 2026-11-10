import type { CoordStatRow, DrillMode } from '../db/db'
import { ALL_SQUARES, type Square, type View } from './squares'

/** Stat key: one row per drill, view and square. */
export function statKey(mode: DrillMode, view: View, square: Square): string {
  return `${mode}:${view}:${square}`
}

export interface Answer {
  mode: DrillMode
  view: View
  square: Square
  correct: boolean
  /** Time from the prompt to the answer. */
  ms: number
  at: number
}

/** The stat row after one more answer. Only correct answers count toward the time. */
export function recordAnswer(prev: CoordStatRow | undefined, a: Answer): CoordStatRow {
  const base: CoordStatRow = prev ?? {
    key: statKey(a.mode, a.view, a.square),
    mode: a.mode,
    view: a.view,
    square: a.square,
    attempts: 0,
    misses: 0,
    correctMs: 0,
    lastAt: 0,
  }
  return {
    ...base,
    attempts: base.attempts + 1,
    misses: base.misses + (a.correct ? 0 : 1),
    correctMs: base.correctMs + (a.correct ? a.ms : 0),
    lastAt: a.at,
  }
}

/** Folds many answers into rows, starting from the stored ones (keyed by `statKey`). */
export function recordAnswers(
  stored: ReadonlyMap<string, CoordStatRow>,
  answers: readonly Answer[],
): CoordStatRow[] {
  const next = new Map<string, CoordStatRow>()
  for (const a of answers) {
    const key = statKey(a.mode, a.view, a.square)
    next.set(key, recordAnswer(next.get(key) ?? stored.get(key), a))
  }
  return [...next.values()]
}

/** One square's combined record. */
export interface SquareCell {
  square: Square
  attempts: number
  correct: number
  /** correct / attempts. */
  accuracy: number
  /** Mean time of correct answers; undefined with none. */
  avgMs?: number
  /** 0 (weak) … 1 (automatic): accuracy, scaled down for slow answers. */
  strength: number
}

/** Answers faster than this count as fully automatic… */
export const FAST_MS = 1500
/** …and slower than this as half-known at best. */
export const SLOW_MS = 5000

export function strength(accuracy: number, avgMs: number | undefined): number {
  if (avgMs === undefined) return accuracy
  const t = Math.min(1, Math.max(0, (SLOW_MS - avgMs) / (SLOW_MS - FAST_MS)))
  return accuracy * (0.5 + 0.5 * t)
}

export interface HeatmapFilter {
  view?: View
  modes?: readonly DrillMode[]
}

/** Per-square cells over the matching rows; squares with no answers are absent. */
export function heatmap(
  rows: readonly CoordStatRow[],
  filter: HeatmapFilter = {},
): Map<Square, SquareCell> {
  const sums = new Map<string, { attempts: number; misses: number; correctMs: number }>()
  for (const row of rows) {
    if (filter.view && row.view !== filter.view) continue
    if (filter.modes && !filter.modes.includes(row.mode)) continue
    const s = sums.get(row.square) ?? { attempts: 0, misses: 0, correctMs: 0 }
    s.attempts += row.attempts
    s.misses += row.misses
    s.correctMs += row.correctMs
    sums.set(row.square, s)
  }
  const cells = new Map<Square, SquareCell>()
  for (const square of ALL_SQUARES) {
    const s = sums.get(square)
    if (!s || s.attempts === 0) continue
    const correct = s.attempts - s.misses
    const accuracy = correct / s.attempts
    const avgMs = correct > 0 ? s.correctMs / correct : undefined
    cells.set(square, {
      square,
      attempts: s.attempts,
      correct,
      accuracy,
      avgMs,
      strength: strength(accuracy, avgMs),
    })
  }
  return cells
}

/** The weakest answered squares, weakest first. */
export function weakest(cells: ReadonlyMap<Square, SquareCell>, n: number): SquareCell[] {
  return [...cells.values()]
    .sort((a, b) => a.strength - b.strength || b.attempts - a.attempts)
    .slice(0, n)
}
