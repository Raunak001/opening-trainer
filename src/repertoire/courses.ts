import { getSettings, type RepertoireRow, type TrainerDB } from '../db'
// Direct module import: the srs index is fine, but keep the dependency narrow.
import { syncCards, type CardSyncSummary } from '../srs/scheduler'
import { buildAndSave, type BuildProgress, type Repertoire } from './builder'
import type { CatalogEntry } from './catalog'
import type { ExplorerClient } from './explorer'
import { DEFAULT_PRUNE_SETTINGS, type PruneSettings } from './prune'

/** How much of an opening a course covers. */
export type CourseTier = NonNullable<RepertoireRow['tier']>

export interface TierPreset {
  label: string
  /** Plies after the catalog entry's start moves. */
  plies: number
  /** Opponent coverage target, 0–1. */
  coverage: number
  description: string
}

/**
 * Agreed in Phase 7: Essentials ≈ 8 plies / 70%, Advanced ≈ 12 / 85%,
 * Full ≈ 16 / 90%. Plies count from the end of the start moves, so every
 * opening gets the same depth of its own theory.
 */
export const TIERS: Record<CourseTier, TierPreset> = {
  essentials: {
    label: 'Essentials',
    plies: 8,
    coverage: 0.7,
    description: 'The main replies, about four moves deep.',
  },
  advanced: {
    label: 'Advanced',
    plies: 12,
    coverage: 0.85,
    description: 'Most replies you will meet, about six moves deep.',
  },
  full: {
    label: 'Full',
    plies: 16,
    coverage: 0.9,
    description: 'Nearly everything, about eight moves deep. Large.',
  },
}

export const TIER_ORDER: readonly CourseTier[] = ['essentials', 'advanced', 'full']

/**
 * Pruning for a tier. Only depth and coverage change between tiers; the user's
 * move choice and the rarity floor stay the same, so each tier's tree contains
 * the one below it.
 */
export function tierSettings(entry: CatalogEntry, tier: CourseTier): PruneSettings {
  const preset = TIERS[tier]
  return {
    ...DEFAULT_PRUNE_SETTINGS,
    opponentCoverage: preset.coverage,
    maxPly: entry.startMoves.length + preset.plies,
  }
}

/** Courses use a fixed repertoire id, so there is at most one per catalog entry. */
export function courseRepertoireId(entryId: string): string {
  return `course-${entryId}`
}

/** The course's repertoire row, if the course has been started. */
export async function findCourse(
  db: TrainerDB,
  entryId: string,
): Promise<RepertoireRow | undefined> {
  return db.repertoires.get(courseRepertoireId(entryId))
}

/** All started courses, keyed by catalog entry id. */
export async function listCourses(db: TrainerDB): Promise<Map<string, RepertoireRow>> {
  const rows = await db.repertoires.toArray()
  return new Map(rows.filter((r) => r.courseId !== undefined).map((r) => [r.courseId as string, r]))
}

export interface BuildCourseOptions {
  client: ExplorerClient
  onProgress?: (progress: BuildProgress) => void
  signal?: AbortSignal
  now?: Date
}

export interface CourseBuild {
  repertoire: Repertoire
  cards: CardSyncSummary
}

/**
 * Builds (or rebuilds at another tier) a course from its catalog entry and
 * syncs its cards. Rating band and speeds come from settings. Move swaps and
 * added replies from an earlier build are kept. Card history survives: cards
 * that leave the tree are suspended, not deleted, and resume if they return.
 */
export async function buildCourse(
  db: TrainerDB,
  entry: CatalogEntry,
  tier: CourseTier,
  options: BuildCourseOptions,
): Promise<CourseBuild> {
  const settings = await getSettings(db)
  const id = courseRepertoireId(entry.id)
  const existing = await db.repertoires.get(id)
  const repertoire = await buildAndSave(db, {
    id,
    name: entry.name,
    courseId: entry.id,
    tier,
    color: entry.color,
    startMoves: entry.startMoves,
    speeds: settings.courses.speeds,
    ratings: settings.courses.ratings,
    settings: tierSettings(entry, tier),
    overrides: existing?.overrides,
    extraMoves: existing?.extraMoves,
    client: options.client,
    onProgress: options.onProgress,
    signal: options.signal,
  })
  const cards = await syncCards(db, id, options.now)
  return { repertoire, cards }
}
