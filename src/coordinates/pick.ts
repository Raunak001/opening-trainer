import type { SquareCell } from './stats'
import { ALL_SQUARES, type Square } from './squares'

/** Random number in [0, 1), injectable for tests. */
export type Rng = () => number

/** Squares never answered get this weight, so every square comes up early on. */
export const UNSEEN_WEIGHT = 3

/**
 * How often a square should come up: misses (smoothed) weigh most, slow
 * correct answers add a little, a known square keeps weight 1.
 */
export function squareWeight(cell: SquareCell | undefined): number {
  if (!cell) return UNSEEN_WEIGHT
  const smoothedMiss = 1 - (cell.correct + 1) / (cell.attempts + 2)
  const slow = cell.avgMs === undefined ? 0 : Math.min(3, Math.max(0, (cell.avgMs - 3000) / 1000))
  return 1 + 6 * smoothedMiss + slow
}

/** A weighted random square, skipping `avoid` (recent prompts) unless nothing else is left. */
export function pickSquare(
  cells: ReadonlyMap<Square, SquareCell>,
  rng: Rng,
  avoid: readonly Square[] = [],
): Square {
  const pool = ALL_SQUARES.filter((s) => !avoid.includes(s))
  const from = pool.length > 0 ? pool : ALL_SQUARES
  const weights = from.map((s) => squareWeight(cells.get(s)))
  const total = weights.reduce((a, b) => a + b, 0)
  let x = rng() * total
  for (let i = 0; i < from.length; i++) {
    x -= weights[i]
    if (x < 0) return from[i]
  }
  return from[from.length - 1]
}

/** Uniform pick from a non-empty list. */
export function pickOne<T>(items: readonly T[], rng: Rng): T {
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))]
}

/** Fisher–Yates shuffle into a new array. */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}
