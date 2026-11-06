import { nodeId, type NodeRow, type RepertoireRow, type TrainerDB } from '../db'
import type { ExplorerClient, ExplorerQuery, RatingBucket, Speed } from './explorer'
import type { PositionKey } from './positionKey'
import {
  DEFAULT_PRUNE_SETTINGS,
  selectMoves,
  withinDepth,
  type Color,
  type PruneSettings,
} from './prune'
import {
  addMove,
  createTree,
  setNodeStats,
  sideToMove,
  TreeError,
  type GameStats,
  type RepertoireTree,
  type TreeNode,
} from './tree'

export interface BuildOptions {
  color: Color
  /** SAN moves from the initial position that every line starts with, e.g. ['e4']. */
  startMoves?: readonly string[]
  speeds: readonly Speed[]
  ratings: readonly RatingBucket[]
  settings?: PruneSettings
  /**
   * User's own choices at user-to-move positions (position key → SAN), used
   * instead of the automatic pick. Ignored where the move is illegal or the
   * position is never reached.
   */
  overrides?: Readonly<Record<PositionKey, string>>
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
  /** Override positions that were reached and applied. */
  appliedOverrides: PositionKey[]
}

/**
 * The explorer query the builder sends for a position. Anything else that
 * reads a repertoire's explorer data must use this too, to hit the same cache.
 */
export function explorerQueryFor(
  filter: { speeds: readonly Speed[]; ratings: readonly RatingBucket[] },
  fen: string,
): ExplorerQuery {
  return {
    fen,
    speeds: filter.speeds,
    ratings: filter.ratings,
    // Only move stats are used; skipping game lists keeps responses small.
    topGames: 0,
    recentGames: 0,
  }
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
  const overrides = options.overrides ?? {}
  const appliedOverrides: PositionKey[] = []

  let tree = createTree()
  let lookups = 0
  const lookup = async (key: PositionKey) => {
    if (signal?.aborted) throw abortError()
    const response = await client.get(explorerQueryFor(options, tree.nodes[key].fen), signal)
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
    let picks = selection.moves.map(({ move }) => ({ san: move.san, stats: move as GameStats }))
    const override = overrides[current]
    if (override && side === color && selection.reason !== 'depth') {
      const stats = response.moves.find((m) => m.san === override)
      try {
        // Validate before replacing the automatic pick; illegal overrides are ignored.
        addMove(tree, current, override)
        picks = [{ san: override, stats: stats ?? { white: 0, draws: 0, black: 0 } }]
        appliedOverrides.push(current)
      } catch (err) {
        if (!(err instanceof TreeError)) throw err
      }
    }
    for (const pick of picks) {
      const r = addMove(tree, current, pick.san, pick.stats)
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

  return { tree, lookups, appliedOverrides }
}

/** A repertoire with its tree assembled from the `nodes` table. */
export interface Repertoire extends RepertoireRow {
  tree: RepertoireTree
}

export interface SaveRepertoireInput extends Omit<
  RepertoireRow,
  'id' | 'createdAt' | 'updatedAt' | 'rootKey' | 'positionCount'
> {
  /** Existing id to overwrite (rebuild); omitted → new repertoire. */
  id?: string
  tree: RepertoireTree
}

/**
 * Inserts or replaces a repertoire and its tree in one transaction, keeping
 * the original creation time. Replacing drops the old tree's node rows.
 * Cards are left alone: review history outlives rebuilds.
 */
export async function saveRepertoire(db: TrainerDB, input: SaveRepertoireInput): Promise<string> {
  const now = Date.now()
  const id = input.id ?? crypto.randomUUID()
  const { tree, ...definition } = input
  const nodes: NodeRow[] = Object.values(tree.nodes).map((n) => ({
    ...n,
    id: nodeId(id, n.key),
    repertoireId: id,
  }))
  return db.transaction('rw', db.repertoires, db.nodes, async () => {
    const existing = await db.repertoires.get(id)
    await db.nodes.where('repertoireId').equals(id).delete()
    await db.nodes.bulkPut(nodes)
    await db.repertoires.put({
      ...definition,
      id,
      rootKey: tree.rootKey,
      positionCount: nodes.length,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    })
    return id
  })
}

/** The tree node stored in a row, without the row's own id fields. */
function nodeFromRow(r: NodeRow): TreeNode {
  const { key, fen, ply, edges, parents, white, draws, black } = r
  return { key, fen, ply, edges, parents, white, draws, black }
}

/** A repertoire with its tree, or undefined if there is no such id. */
export async function loadRepertoire(db: TrainerDB, id: string): Promise<Repertoire | undefined> {
  return db.transaction('r', db.repertoires, db.nodes, async () => {
    const row = await db.repertoires.get(id)
    if (!row) return undefined
    const nodeRows = await db.nodes.where('repertoireId').equals(id).toArray()
    const nodes: RepertoireTree['nodes'] = {}
    for (const r of nodeRows) nodes[r.key] = nodeFromRow(r)
    return { ...row, tree: { rootKey: row.rootKey, nodes } }
  })
}

/** Repertoire definitions, newest first. Trees are not loaded. */
export function listRepertoires(db: TrainerDB): Promise<RepertoireRow[]> {
  return db.repertoires.orderBy('updatedAt').reverse().toArray()
}

/** Builds with `options` and saves the result; returns the saved repertoire. */
export async function buildAndSave(
  db: TrainerDB,
  options: BuildOptions & { name: string; id?: string },
): Promise<Repertoire> {
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
    overrides: { ...options.overrides },
    tree,
  })
  return (await loadRepertoire(db, id)) as Repertoire
}
