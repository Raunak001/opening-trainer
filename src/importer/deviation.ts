// Where a game left the repertoire, and who left it.

import { Chess } from 'chess.js'
// Direct module imports: the repertoire index also re-exports React pages.
import type { PositionKey } from '../repertoire/positionKey'
import type { Color } from '../repertoire/prune'
import { sideToMove, type RepertoireTree } from '../repertoire/tree'

/** Where the game stopped following the tree. `ply` is the index of the game's move there. */
export type Deviation =
  /** The user played something other than the repertoire move. */
  | {
      kind: 'user'
      ply: number
      positionKey: PositionKey
      fen: string
      /** Repertoire move (SAN). */
      expected: string
      played: string
    }
  /** The opponent played a reply the tree does not cover. */
  | { kind: 'opponent'; ply: number; positionKey: PositionKey; fen: string; played: string }
  /** The game followed the tree to one of its leaves; `ply` is the first move past it. */
  | { kind: 'endOfBook'; ply: number; positionKey: PositionKey }
  /** The game ended while still in the tree. */
  | { kind: 'gameOver'; ply: number }
  /** The game left before the end of the repertoire's start moves: a different opening. */
  | { kind: 'outside'; ply: number }

export type DeviationKind = Deviation['kind']

export interface RepertoireForMatch {
  id: string
  color: Color
  startMoves: readonly string[]
  tree: RepertoireTree
}

/**
 * Walks a game's moves through the tree by position, so transposed move orders
 * still match. At a user-to-move node the move must be the repertoire's; at an
 * opponent node any move the tree keeps continues. Pure.
 */
export function detectDeviation(
  sans: readonly string[],
  repertoire: RepertoireForMatch,
): Deviation {
  const { tree, color } = repertoire
  const chess = new Chess()
  let node = tree.nodes[tree.rootKey]
  for (let ply = 0; ply < sans.length; ply++) {
    const fen = chess.fen()
    const played = chess.move(sans[ply])
    const inStart = ply < repertoire.startMoves.length
    if (node.edges.length === 0) {
      return inStart ? { kind: 'outside', ply } : { kind: 'endOfBook', ply, positionKey: node.key }
    }
    const userTurn = sideToMove(node.key) === color
    const edge = userTurn ? node.edges[0] : node.edges.find((e) => e.uci === played.lan)
    if (!edge || edge.uci !== played.lan) {
      if (inStart) return { kind: 'outside', ply }
      return userTurn
        ? {
            kind: 'user',
            ply,
            positionKey: node.key,
            fen,
            expected: node.edges[0].san,
            played: played.san,
          }
        : { kind: 'opponent', ply, positionKey: node.key, fen, played: played.san }
    }
    node = tree.nodes[edge.to]
  }
  return { kind: 'gameOver', ply: sans.length }
}

export interface GameMatch {
  repertoireId: string
  deviation: Deviation
}

/**
 * The repertoire (of the user's color) that a game follows longest, with its
 * deviation. Games outside every repertoire still get the best `outside`
 * match. Undefined when there is no repertoire for that color. Ties go to the
 * earlier repertoire in the list.
 */
export function matchGame(
  sans: readonly string[],
  color: Color,
  repertoires: readonly RepertoireForMatch[],
): GameMatch | undefined {
  let best: GameMatch | undefined
  const rank = (d: Deviation) => (d.kind === 'outside' ? -1 : 0)
  for (const rep of repertoires) {
    if (rep.color !== color) continue
    const deviation = detectDeviation(sans, rep)
    if (
      !best ||
      rank(deviation) > rank(best.deviation) ||
      (rank(deviation) === rank(best.deviation) && deviation.ply > best.deviation.ply)
    )
      best = { repertoireId: rep.id, deviation }
  }
  return best
}

/** "1.e4", "3…Nc6": the game's move at `ply` with its number. */
export function plyLabel(ply: number, san: string): string {
  const n = Math.floor(ply / 2) + 1
  return ply % 2 === 0 ? `${n}.${san}` : `${n}…${san}`
}

/** One line for the games list. */
export function describeDeviation(d: Deviation, sans: readonly string[]): string {
  switch (d.kind) {
    case 'user':
      return `You left book: ${plyLabel(d.ply, d.played)} (repertoire: ${d.expected})`
    case 'opponent':
      return `Opponent left book: ${plyLabel(d.ply, d.played)}`
    case 'endOfBook':
      return `In book to the end of the line (${plyLabel(d.ply, sans[d.ply])} is past it)`
    case 'gameOver':
      return 'The game ended in book'
    case 'outside':
      return 'Different opening'
  }
}
