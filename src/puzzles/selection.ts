/** Picking the next puzzle near the user's rating. */

export interface PuzzleCandidate {
  id: string
  rating: number
}

/** Half-widths of the rating window tried in turn, narrowest first. */
export const WINDOWS = [50, 100, 200, 400, 800] as const

/** Rating to aim the next puzzle at. */
export function targetRating(rating: number): number {
  return Math.round(rating)
}

/**
 * Picks an unseen puzzle within the narrowest window around `target` that has one,
 * at random within that window. When every puzzle in the widest window has been seen,
 * repeats are allowed (still nearest window first). `undefined` only for no candidates.
 */
export function pickPuzzle(
  candidates: readonly PuzzleCandidate[],
  target: number,
  seen: ReadonlySet<string>,
  random: () => number = Math.random,
): PuzzleCandidate | undefined {
  const unseen = candidates.filter((c) => !seen.has(c.id))
  for (const pool of [unseen, candidates]) {
    for (const w of WINDOWS) {
      const inWindow = pool.filter((c) => Math.abs(c.rating - target) <= w)
      if (inWindow.length > 0) return inWindow[Math.floor(random() * inWindow.length)]
    }
  }
  // Nothing within the widest window: the closest puzzle.
  const pool = unseen.length > 0 ? unseen : candidates
  let best: PuzzleCandidate | undefined
  for (const c of pool)
    if (!best || Math.abs(c.rating - target) < Math.abs(best.rating - target)) best = c
  return best
}
