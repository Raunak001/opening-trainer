import { Chess } from 'chess.js'
import { positionKey, type PositionKey } from './positionKey'

/** Game results from White's point of view, as reported by the explorer. */
export interface GameStats {
  white: number
  draws: number
  black: number
}

/** A move from one position to another. */
export interface TreeEdge extends GameStats {
  san: string
  /** chess.js long algebraic, e.g. `e2e4`, `e1g1` (castling is king-to-square). */
  uci: string
  to: PositionKey
}

/** Back-link to a position that leads here. Several when move orders transpose. */
export interface ParentLink {
  from: PositionKey
  san: string
}

export interface TreeNode extends GameStats {
  key: PositionKey
  /** Full FEN of the first path that reached this position (clocks are not part of the key). */
  fen: string
  /** Shortest distance from the root in half-moves. */
  ply: number
  edges: TreeEdge[]
  parents: ParentLink[]
}

/**
 * Opening tree as a graph: one node per position key, so transpositions merge.
 * Plain data only (no Maps or classes) so it stores in IndexedDB and JSON as is.
 */
export interface RepertoireTree {
  rootKey: PositionKey
  nodes: Record<PositionKey, TreeNode>
}

export type MoveSpec = string | { from: string; to: string; promotion?: string }

export interface AddMoveResult {
  tree: RepertoireTree
  edge: TreeEdge
  node: TreeNode
  /** True if the move reached a position that was not in the tree yet. */
  created: boolean
}

export class TreeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TreeError'
  }
}

export const START_FEN = new Chess().fen()

const NO_GAMES: GameStats = { white: 0, draws: 0, black: 0 }

export function totalGames(stats: GameStats): number {
  return stats.white + stats.draws + stats.black
}

export function sideToMove(key: PositionKey): 'white' | 'black' {
  return key.split(' ')[1] === 'b' ? 'black' : 'white'
}

export function createTree(rootFen: string = START_FEN): RepertoireTree {
  const key = positionKey(rootFen)
  return {
    rootKey: key,
    nodes: { [key]: { key, fen: rootFen, ply: 0, edges: [], parents: [], ...NO_GAMES } },
  }
}

export function getNode(tree: RepertoireTree, key: PositionKey): TreeNode | undefined {
  return tree.nodes[key]
}

function requireNode(tree: RepertoireTree, key: PositionKey): TreeNode {
  const node = tree.nodes[key]
  if (!node) throw new TreeError(`No node for position "${key}"`)
  return node
}

/** Copy-on-write view of a tree: clones each node at most once per operation. */
function draft(tree: RepertoireTree) {
  const nodes = { ...tree.nodes }
  const copied = new Set<PositionKey>()
  const edit = (key: PositionKey): TreeNode => {
    if (!copied.has(key)) {
      const n = requireNode(tree, key)
      nodes[key] = { ...n, edges: n.edges.map((e) => ({ ...e })), parents: [...n.parents] }
      copied.add(key)
    }
    return nodes[key]
  }
  return { nodes, edit, done: (): RepertoireTree => ({ rootKey: tree.rootKey, nodes }) }
}

/**
 * Adds (or updates) a move from `fromKey`. If the resulting position already
 * exists the edge points at that node, merging the transposition.
 * `stats`, when given, replaces the edge's game counts.
 */
export function addMove(
  tree: RepertoireTree,
  fromKey: PositionKey,
  move: MoveSpec,
  stats?: GameStats,
): AddMoveResult {
  const parent = requireNode(tree, fromKey)
  const chess = new Chess(parent.fen)
  let played
  try {
    played = chess.move(move)
  } catch {
    throw new TreeError(`Illegal move ${JSON.stringify(move)} in "${parent.fen}"`)
  }
  const childFen = chess.fen()
  const childKey = positionKey(childFen)

  const d = draft(tree)
  const from = d.edit(fromKey)
  let edge = from.edges.find((e) => e.uci === played.lan)
  if (!edge) {
    edge = { san: played.san, uci: played.lan, to: childKey, ...NO_GAMES }
    from.edges.push(edge)
  }
  if (stats) Object.assign(edge, pickStats(stats))

  const created = !d.nodes[childKey]
  if (created) {
    d.nodes[childKey] = {
      key: childKey,
      fen: childFen,
      ply: from.ply + 1,
      edges: [],
      parents: [{ from: fromKey, san: played.san }],
      ...NO_GAMES,
    }
  } else {
    const child = d.edit(childKey)
    if (!child.parents.some((p) => p.from === fromKey && p.san === played.san))
      child.parents.push({ from: fromKey, san: played.san })
    if (from.ply + 1 < child.ply) {
      child.ply = from.ply + 1
      propagatePly(d, childKey)
    }
  }

  const result = d.done()
  return { tree: result, edge: { ...edge }, node: result.nodes[childKey], created }
}

/** After a node's ply shrinks, shorten the plies of everything below it. */
function propagatePly(d: ReturnType<typeof draft>, startKey: PositionKey) {
  const queue = [startKey]
  while (queue.length) {
    const cur = d.nodes[queue.shift() as PositionKey]
    for (const e of cur.edges) {
      if (cur.ply + 1 < d.nodes[e.to].ply) {
        d.edit(e.to).ply = cur.ply + 1
        queue.push(e.to)
      }
    }
  }
}

function pickStats({ white, draws, black }: GameStats): GameStats {
  return { white, draws, black }
}

/** Sets the position-level game counts (explorer totals for the node). */
export function setNodeStats(
  tree: RepertoireTree,
  key: PositionKey,
  stats: GameStats,
): RepertoireTree {
  const d = draft(tree)
  Object.assign(d.edit(key), pickStats(stats))
  return d.done()
}

export function children(
  tree: RepertoireTree,
  key: PositionKey,
): { edge: TreeEdge; node: TreeNode }[] {
  return requireNode(tree, key).edges.map((edge) => ({ edge, node: requireNode(tree, edge.to) }))
}

/**
 * A shortest move sequence (SAN) from the root to `key`, walking parent links.
 * Each step goes to a parent one ply closer to the root, so it always ends.
 */
export function pathTo(tree: RepertoireTree, key: PositionKey): string[] {
  const moves: string[] = []
  let node = requireNode(tree, key)
  while (node.key !== tree.rootKey) {
    const link = node.parents.find((p) => requireNode(tree, p.from).ply === node.ply - 1)
    if (!link) throw new TreeError(`Position "${node.key}" is not connected to the root`)
    moves.push(link.san)
    node = requireNode(tree, link.from)
  }
  return moves.reverse()
}

/** Follows a SAN sequence from the root; undefined if any move is missing from the tree. */
export function findBySan(tree: RepertoireTree, sans: readonly string[]): TreeNode | undefined {
  let node: TreeNode | undefined = requireNode(tree, tree.rootKey)
  for (const san of sans) {
    const edge: TreeEdge | undefined = node.edges.find((e) => e.san === san)
    if (!edge) return undefined
    node = tree.nodes[edge.to]
    if (!node) return undefined
  }
  return node
}
