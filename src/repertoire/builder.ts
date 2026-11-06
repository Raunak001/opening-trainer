import type { RepertoireRow, TrainerDB } from '../db'
import type { ExplorerClient, ExplorerQuery, RatingBucket, Speed } from './explorer'
import type { PositionKey } from './positionKey'
import {
  DEFAULT_PRUNE_SETTINGS,
  selectMoves,
  withinDepth,
  type Color,
  type PruneSettings,
} from './prune'
import { addMove, createTree, setNodeStats, sideToMove, type RepertoireTree } from './tree'

export interface BuildOptions {
  color: Color
  /** SAN moves from the initial position that every line starts with, e.g. ['e4']. */
  startMoves?: readonly string[]
  speeds: readonly Speed[]
  ratings: readonly RatingBucket[]
  settings?: PruneSettings
  client: ExplorerClient
  onProgress?: (progress: BuildProgress) => void
  signal?: AbortSignal
}

export interface BuildProgress {
  /** Positions looked up so far (cache or network). */
  expanded: number
  /** Positions in the tree so far. */
  positions: number
  /** Positions waiting to be looked up. */
  queued: number
  /** Ply of the position just looked up. */
  ply: number
}

export interface BuildResult {
  tree: RepertoireTree
  /** Explorer lookups made (cache hits included). */
  lookups: number
}

function abortError(): DOMException {
  return new DOMException('The build was cancelled.', 'AbortError')
}

/**
 * Builds a repertoire tree breadth-first from the initial position.
 *
 * The forced `startMoves` are played first (with explorer counts on each edge),
 * then every frontier position is looked up once and pruned with `selectMoves`.
 * Transpositions are looked up only once. Positions past the depth limit are
 * not looked up at all. Rejects with an AbortError if `signal` aborts.
 */
export async function buildRepertoire(options: BuildOptions): Promise<BuildResult> {
  const { color, client, onProgress, signal } = options
  const settings = options.settings ?? DEFAULT_PRUNE_SETTINGS
  const baseQuery: Omit<ExplorerQuery, 'fen'> = {
    speeds: options.speeds,
    ratings: options.ratings,
    // Only move stats are used; skipping game lists keeps responses small.
    topGames: 0,
    recentGames: 0,
  }

  let tree = createTree()
  let lookups = 0
  const lookup = async (key: PositionKey) => {
    if (signal?.aborted) throw abortError()
    const response = await client.get({ ...baseQuery, fen: tree.nodes[key].fen }, signal)
    lookups++
    tree = setNodeStats(tree, key, response)
    return response
  }

  // Forced start line.
  let key = tree.rootKey
  for (const san of options.startMoves ?? []) {
    const response = await lookup(key)
    const stats = response.moves.find((m) => m.san === san)
    const r = addMove(tree, key, san, stats)
    tree = r.tree
    key = r.node.key
  }

  // Breadth-first over the pruned tree.
  const queue: PositionKey[] = [key]
  const seen = new Set<PositionKey>(queue)
  while (queue.length) {
    const current = queue.shift() as PositionKey
    const node = tree.nodes[current]
    const side = sideToMove(current)
    const response = await lookup(current)
    const selection = selectMoves(response, {
      ply: node.ply,
      userColor: color,
      sideToMove: side,
      settings,
    })
    for (const { move } of selection.moves) {
      const r = addMove(tree, current, move.san, move)
      tree = r.tree
      const child = r.node
      // Leaves past the depth limit stay in the tree but are never looked up.
      if (
        !seen.has(child.key) &&
        withinDepth(child.ply, sideToMove(child.key) === color, settings)
      ) {
        seen.add(child.key)
        queue.push(child.key)
      }
    }
    onProgress?.({
      expanded: lookups,
      positions: Object.keys(tree.nodes).length,
      queued: queue.length,
      ply: node.ply,
    })
  }

  return { tree, lookups }
}

export interface SaveRepertoireInput extends Omit<RepertoireRow, 'id' | 'createdAt' | 'updatedAt'> {
  /** Existing id to overwrite (rebuild); omitted → new repertoire. */
  id?: string
}

/** Inserts or replaces a repertoire, keeping its original creation time. */
export async function saveRepertoire(db: TrainerDB, input: SaveRepertoireInput): Promise<string> {
  const now = Date.now()
  const id = input.id ?? crypto.randomUUID()
  return db.transaction('rw', db.repertoires, async () => {
    const existing = await db.repertoires.get(id)
    await db.repertoires.put({
      ...input,
      id,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    })
    return id
  })
}

export function loadRepertoire(db: TrainerDB, id: string): Promise<RepertoireRow | undefined> {
  return db.repertoires.get(id)
}

export function listRepertoires(db: TrainerDB): Promise<RepertoireRow[]> {
  return db.repertoires.orderBy('updatedAt').reverse().toArray()
}

/** Builds with `options` and saves the result; returns the saved row. */
export async function buildAndSave(
  db: TrainerDB,
  options: BuildOptions & { name: string; id?: string },
): Promise<RepertoireRow> {
  const settings = options.settings ?? DEFAULT_PRUNE_SETTINGS
  const { tree } = await buildRepertoire({ ...options, settings })
  const id = await saveRepertoire(db, {
    id: options.id,
    name: options.name,
    color: options.color,
    startMoves: [...(options.startMoves ?? [])],
    speeds: [...options.speeds],
    ratings: [...options.ratings],
    settings,
    tree,
  })
  return (await loadRepertoire(db, id)) as RepertoireRow
}
