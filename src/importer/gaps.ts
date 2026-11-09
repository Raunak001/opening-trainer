// Coverage gaps: opponent replies the tree misses, by how often games hit them.

import type { GameRow, TimeClass, TrainerDB } from '../db'
import { buildAndSave, type BuildProgress, type Repertoire } from '../repertoire/builder'
import type { ExplorerClient } from '../repertoire/explorer'
import type { PositionKey } from '../repertoire/positionKey'
import { syncCards } from '../srs/scheduler'
import { plyLabel, type GameMatch } from './deviation'
import { filterGames } from './games'

export interface CoverageGap {
  /** `${repertoireId}|${positionKey}|${san}` */
  id: string
  repertoireId: string
  /** Position the opponent played the missing reply from. */
  positionKey: PositionKey
  /** The missing reply (SAN). */
  san: string
  /** Moves from the start up to and including the reply. */
  line: string[]
  games: number
  /** End time of the most recent such game, ms. */
  lastPlayed: number
  /** The user's score in those games, 0–1. */
  score: number
}

const POINTS: Record<GameRow['result'], number> = { win: 1, draw: 0.5, loss: 0 }

/**
 * Opponent deviations grouped by repertoire, position and move, in the chosen
 * time classes, keeping those seen in at least `minGames` games. Most frequent
 * first, then most recent. Pure.
 */
export function coverageGaps(
  games: readonly GameRow[],
  matches: ReadonlyMap<string, GameMatch | undefined>,
  opts: { timeClasses: readonly TimeClass[]; minGames: number },
): CoverageGap[] {
  const byId = new Map<string, CoverageGap & { points: number }>()
  for (const game of filterGames(games, { timeClasses: opts.timeClasses })) {
    const match = matches.get(game.id)
    const d = match?.deviation
    if (!match || d?.kind !== 'opponent') continue
    const id = `${match.repertoireId}|${d.positionKey}|${d.played}`
    const gap = byId.get(id) ?? {
      id,
      repertoireId: match.repertoireId,
      positionKey: d.positionKey,
      san: d.played,
      line: game.sans.slice(0, d.ply + 1),
      games: 0,
      lastPlayed: 0,
      score: 0,
      points: 0,
    }
    gap.games++
    gap.points += POINTS[game.result]
    gap.lastPlayed = Math.max(gap.lastPlayed, game.endTime)
    byId.set(id, gap)
  }
  return [...byId.values()]
    .filter((g) => g.games >= opts.minGames)
    .map(({ points, ...g }) => ({ ...g, score: points / g.games }))
    .sort((a, b) => b.games - a.games || b.lastPlayed - a.lastPlayed || a.id.localeCompare(b.id))
}

/** "1.e4 c5 2.Nf3 Nc6" */
export function formatMoves(sans: readonly string[]): string {
  return sans.map((san, ply) => (ply % 2 === 0 ? plyLabel(ply, san) : san)).join(' ')
}

export class GapError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GapError'
  }
}

export interface ExtendOptions {
  client: ExplorerClient
  signal?: AbortSignal
  onProgress?: (p: BuildProgress) => void
}

/**
 * Adds the gap's reply to its repertoire for good (kept across rebuilds),
 * rebuilds the tree so the user gets an answer below it, and syncs cards.
 * Rebuilds from the explorer cache except for the new positions.
 */
export async function extendTree(
  db: TrainerDB,
  gap: Pick<CoverageGap, 'repertoireId' | 'positionKey' | 'san'>,
  { client, signal, onProgress }: ExtendOptions,
): Promise<Repertoire> {
  const row = await db.repertoires.get(gap.repertoireId)
  if (!row) throw new GapError('That repertoire no longer exists.')
  const current = row.extraMoves?.[gap.positionKey] ?? []
  const extraMoves = {
    ...row.extraMoves,
    [gap.positionKey]: current.includes(gap.san) ? current : [...current, gap.san],
  }
  const saved = await buildAndSave(db, {
    id: row.id,
    name: row.name,
    color: row.color,
    startMoves: row.startMoves,
    speeds: row.speeds,
    ratings: row.ratings,
    settings: row.settings,
    overrides: row.overrides,
    extraMoves,
    client,
    signal,
    onProgress,
  })
  await syncCards(db, saved.id)
  const added = saved.tree.nodes[gap.positionKey]?.edges.some((e) => e.san === gap.san)
  if (!added) throw new GapError('That position is no longer in the tree, so nothing was added.')
  return saved
}
