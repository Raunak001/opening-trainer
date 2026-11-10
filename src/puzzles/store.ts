import type { PuzzleAttemptRow, PuzzleRow, TrainerDB } from '../db'
import { DEFAULT_GLICKO, updateRating, type GlickoOptions } from './glicko'
import { pickPuzzle, targetRating, WINDOWS } from './selection'
import { currentRating } from './stats'

/** Served by Vite from `public/`; bundled with the app, so no external request. */
export const PUZZLE_DATA_URL = '/puzzles/puzzles.json'

type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

/** Bundle format: `{ fields: [...], puzzles: [[id, fen, "uci uci …", rating, "theme theme"], …] }`. */
export function parsePuzzleData(data: unknown): PuzzleRow[] {
  const rows = (data as { puzzles?: unknown } | null)?.puzzles
  if (!Array.isArray(rows)) throw new Error('Puzzle data has no "puzzles" array.')
  return rows.map((r: unknown, i) => {
    if (
      !Array.isArray(r) ||
      typeof r[0] !== 'string' ||
      typeof r[1] !== 'string' ||
      typeof r[2] !== 'string' ||
      typeof r[3] !== 'number' ||
      typeof r[4] !== 'string'
    )
      throw new Error(`Puzzle row ${i + 1} is malformed.`)
    return {
      id: r[0],
      fen: r[1],
      moves: r[2].split(' ').filter(Boolean),
      rating: r[3],
      themes: r[4].split(' ').filter(Boolean),
    }
  })
}

/** Loads the bundled puzzles into IndexedDB once. Returns how many puzzles the db has. */
export async function ensurePuzzles(
  db: TrainerDB,
  fetchFn: FetchLike = (url) => fetch(url),
): Promise<number> {
  const count = await db.puzzles.count()
  if (count > 0) return count
  const res = await fetchFn(PUZZLE_DATA_URL)
  if (!res.ok) throw new Error(`Could not load puzzles (HTTP ${res.status}).`)
  const rows = parsePuzzleData(await res.json())
  await db.puzzles.bulkPut(rows)
  return rows.length
}

export async function loadAttempts(db: TrainerDB): Promise<PuzzleAttemptRow[]> {
  return db.puzzleAttempts.orderBy('at').toArray()
}

/** The next puzzle near the user's rating, not seen before when possible. */
export async function nextPuzzle(
  db: TrainerDB,
  random: () => number = Math.random,
): Promise<PuzzleRow | undefined> {
  const attempts = await loadAttempts(db)
  const target = targetRating(currentRating(attempts).rating)
  const seen = new Set(attempts.map((a) => a.puzzleId))
  const widest = WINDOWS[WINDOWS.length - 1]
  let candidates = await db.puzzles
    .where('rating')
    .between(target - widest, target + widest, true, true)
    .toArray()
  if (candidates.length === 0) candidates = await db.puzzles.toArray()
  const pick = pickPuzzle(candidates, target, seen, random)
  return pick && candidates.find((c) => c.id === pick.id)
}

export interface AttemptInput {
  puzzle: PuzzleRow
  solved: boolean
  hintUsed: boolean
  mistakes: number
  durationMs: number
  at?: Date
}

/** Rates one attempt against the user's current rating and stores it. */
export async function recordAttempt(
  db: TrainerDB,
  input: AttemptInput,
  options: GlickoOptions = DEFAULT_GLICKO,
): Promise<PuzzleAttemptRow> {
  return db.transaction('rw', db.puzzleAttempts, async () => {
    const before = currentRating(await loadAttempts(db))
    const after = updateRating(before, input.puzzle.rating, input.solved, options)
    const row: PuzzleAttemptRow = {
      puzzleId: input.puzzle.id,
      at: input.at ?? new Date(),
      solved: input.solved,
      puzzleRating: input.puzzle.rating,
      themes: input.puzzle.themes,
      ratingBefore: before.rating,
      ratingAfter: after.rating,
      rdAfter: after.rd,
      volAfter: after.vol,
      hintUsed: input.hintUsed,
      mistakes: input.mistakes,
      durationMs: input.durationMs,
    }
    row.id = await db.puzzleAttempts.add(row)
    return row
  })
}
