import { Chess } from 'chess.js'
import type { RepertoireRow } from '../db'
import type { RatingBucket, Speed } from './explorer'
import { DEFAULT_PRUNE_SETTINGS, type Color, type PruneSettings } from './prune'

/** Lichess explorer rating buckets (lower bounds), ascending. */
export const RATING_BUCKETS: readonly RatingBucket[] = [
  400, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500,
]

export const SPEEDS: readonly Speed[] = [
  'ultraBullet',
  'bullet',
  'blitz',
  'rapid',
  'classical',
  'correspondence',
]

export const SPEED_LABELS: Record<Speed, string> = {
  ultraBullet: 'UltraBullet',
  bullet: 'Bullet',
  blitz: 'Blitz',
  rapid: 'Rapid',
  classical: 'Classical',
  correspondence: 'Correspondence',
}

/** Highest rating included in a bucket, for labels ("1600" bucket → "1799"). */
export function bucketUpperLabel(bucket: RatingBucket): string {
  const next = RATING_BUCKETS[RATING_BUCKETS.indexOf(bucket) + 1]
  return next === undefined ? 'and up' : String(next - 1)
}

/** Buckets from `min` to `max` inclusive (both are bucket lower bounds). */
export function bucketsInBand(min: RatingBucket, max: RatingBucket): RatingBucket[] {
  return RATING_BUCKETS.filter((b) => b >= min && b <= max)
}

/** Editable form state. Numbers stay strings so inputs can be cleared while typing. */
export interface BuilderForm {
  /** Saved repertoire being edited; undefined for a new one. */
  id?: string
  name: string
  color: Color
  /** SAN, move numbers optional: "1.e4 e5 2.Nf3" or "e4 e5 Nf3". */
  startMoves: string
  ratingMin: RatingBucket
  ratingMax: RatingBucket
  speeds: Speed[]
  /** Percent, 1–100. */
  coverage: string
  /** Percent, 0–100. */
  floor: string
  /** Plies from the initial position. */
  maxPly: string
  /** Not on the form; kept so editing a saved repertoire preserves it. */
  userMinShare: number
  /** Not on the form; move swaps made in the tree viewer, kept across rebuilds. */
  overrides: Record<string, string>
}

export const DEFAULT_FORM: BuilderForm = {
  name: '',
  color: 'white',
  startMoves: '1.e4',
  ratingMin: 1600,
  ratingMax: 1800,
  speeds: ['blitz', 'rapid'],
  coverage: String(DEFAULT_PRUNE_SETTINGS.opponentCoverage * 100),
  floor: String(DEFAULT_PRUNE_SETTINGS.opponentMinShare * 100),
  maxPly: String(DEFAULT_PRUNE_SETTINGS.maxPly),
  userMinShare: DEFAULT_PRUNE_SETTINGS.userMinShare,
  overrides: {},
}

export type ParsedMoves = { ok: true; sans: string[] } | { ok: false; error: string }

/** Parses and validates a SAN move list from the initial position. */
export function parseStartMoves(text: string): ParsedMoves {
  const tokens = text
    .replace(/\d+\.(\.\.)?/g, ' ') // move numbers: "1." "1..." "12."
    .split(/[\s,]+/)
    .filter(Boolean)
  const chess = new Chess()
  const sans: string[] = []
  for (const token of tokens) {
    try {
      sans.push(chess.move(token).san)
    } catch {
      const after = sans.length ? ` after ${formatLine(sans)}` : ''
      return { ok: false, error: `"${token}" is not a legal move${after}.` }
    }
  }
  return { ok: true, sans }
}

/** "e4 e5 Nf3" → "1.e4 e5 2.Nf3" */
export function formatLine(sans: readonly string[]): string {
  return sans.map((san, i) => (i % 2 === 0 ? `${i / 2 + 1}.${san}` : san)).join(' ')
}

export type FormField =
  'name' | 'startMoves' | 'rating' | 'speeds' | 'coverage' | 'floor' | 'maxPly'

export interface ValidBuild {
  id?: string
  name: string
  color: Color
  startMoves: string[]
  speeds: Speed[]
  ratings: RatingBucket[]
  settings: PruneSettings
  overrides: Record<string, string>
}

export type FormResult =
  { ok: true; value: ValidBuild } | { ok: false; errors: Partial<Record<FormField, string>> }

function parsePercent(text: string, min: number, max: number): number | undefined {
  if (text.trim() === '') return undefined
  const n = Number(text)
  return Number.isFinite(n) && n >= min && n <= max ? n / 100 : undefined
}

/** Checks every field; on success returns options ready for `buildAndSave`. */
export function validateForm(form: BuilderForm): FormResult {
  const errors: Partial<Record<FormField, string>> = {}

  const name = form.name.trim()
  if (!name) errors.name = 'Give the repertoire a name.'

  const moves = parseStartMoves(form.startMoves)
  if (!moves.ok) errors.startMoves = moves.error

  if (form.ratingMin > form.ratingMax) errors.rating = 'The lower rating must not exceed the upper.'

  const speeds = SPEEDS.filter((s) => form.speeds.includes(s))
  if (speeds.length === 0) errors.speeds = 'Pick at least one time control.'

  const coverage = parsePercent(form.coverage, 1, 100)
  if (coverage === undefined) errors.coverage = 'Enter a percentage from 1 to 100.'

  const floor = parsePercent(form.floor, 0, 100)
  if (floor === undefined) errors.floor = 'Enter a percentage from 0 to 100.'
  else if (coverage !== undefined && floor >= coverage)
    errors.floor = 'The floor must be below the coverage target.'

  const maxPly = Number(form.maxPly)
  if (!Number.isInteger(maxPly) || maxPly < 1 || maxPly > 40)
    errors.maxPly = 'Enter a whole number of plies from 1 to 40.'
  else if (moves.ok && maxPly <= moves.sans.length)
    errors.maxPly = `Depth must be more than the ${moves.sans.length} start plies.`

  if (Object.keys(errors).length > 0 || !moves.ok) return { ok: false, errors }

  return {
    ok: true,
    value: {
      id: form.id,
      name,
      color: form.color,
      startMoves: moves.sans,
      speeds,
      ratings: bucketsInBand(form.ratingMin, form.ratingMax),
      settings: {
        userMinShare: form.userMinShare,
        opponentCoverage: coverage as number,
        opponentMinShare: floor as number,
        maxPly,
      },
      overrides: { ...form.overrides },
    },
  }
}

/** Form pre-filled from a saved repertoire, for editing and rebuilding it. */
export function formFromRow(row: RepertoireRow): BuilderForm {
  const ratings = [...row.ratings].sort((a, b) => a - b)
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    startMoves: formatLine(row.startMoves),
    ratingMin: ratings[0] ?? DEFAULT_FORM.ratingMin,
    ratingMax: ratings.at(-1) ?? DEFAULT_FORM.ratingMax,
    speeds: [...row.speeds],
    coverage: String(round(row.settings.opponentCoverage * 100)),
    floor: String(round(row.settings.opponentMinShare * 100)),
    maxPly: String(row.settings.maxPly),
    userMinShare: row.settings.userMinShare,
    overrides: { ...row.overrides },
  }
}

/** Trims float noise from percent conversions (0.07 * 100 = 7.000000000000001). */
function round(n: number): number {
  return Math.round(n * 1e6) / 1e6
}
