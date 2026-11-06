import type { ExplorerMove, ExplorerResponse } from './explorer'
import { totalGames, type GameStats } from './tree'

export type Color = 'white' | 'black'

export interface PruneSettings {
  /** User move candidates need at least this share of the position's games. */
  userMinShare: number
  /** Stop adding opponent replies once they cover this share of games. */
  opponentCoverage: number
  /** Never keep an opponent reply below this share. */
  opponentMinShare: number
  /**
   * Deepest ply (half-moves from the tree root) at which an opponent reply is
   * added. The user still gets one answer at this ply, so lines end on a user move.
   */
  maxPly: number
}

/** CLAUDE.md defaults. maxPly is a starting guess; T2.4b tunes it to the ~300-position target. */
export const DEFAULT_PRUNE_SETTINGS: PruneSettings = {
  userMinShare: 0.05,
  opponentCoverage: 0.85,
  opponentMinShare: 0.03,
  maxPly: 12,
}

export interface SelectedMove {
  move: ExplorerMove
  /** Move games / position games. */
  share: number
  /** (wins + draws / 2) / games, from the user's side. */
  userScore: number
}

export type StopReason =
  | 'chosen' // user node: one move picked
  | 'coverage' // opponent node: coverage target reached
  | 'floor' // opponent node: next reply was below the minimum share
  | 'exhausted' // opponent node: ran out of listed moves first
  | 'depth' // not expanded: beyond maxPly
  | 'noGames' // no data for this position

export interface Selection {
  moves: SelectedMove[]
  reason: StopReason
  /** Share of the position's games covered by the kept moves. */
  coverage: number
}

/** Fraction of games scored by `color` (win = 1, draw = ½). 0 when there are no games. */
export function scoreFor(stats: GameStats, color: Color): number {
  const games = totalGames(stats)
  if (games === 0) return 0
  const wins = color === 'white' ? stats.white : stats.black
  return (wins + stats.draws / 2) / games
}

/** Whether a node at `ply` should be expanded at all, given whose move it is. */
export function withinDepth(ply: number, isUserTurn: boolean, settings: PruneSettings): boolean {
  return isUserTurn ? ply <= settings.maxPly : ply < settings.maxPly
}

/**
 * Picks the moves to keep at one position from its explorer response.
 *
 * - User to move: the best-scoring move among those with ≥ `userMinShare` of
 *   games (ties → more games). If none qualifies, the most played move.
 * - Opponent to move: replies by popularity until `opponentCoverage` of games is
 *   covered (the move that crosses the line is kept), skipping everything from
 *   the first reply below `opponentMinShare`.
 *
 * Shares are against the position's total games, not just the listed moves.
 */
export function selectMoves(
  response: ExplorerResponse,
  opts: { ply: number; userColor: Color; sideToMove: Color; settings?: PruneSettings },
): Selection {
  const settings = opts.settings ?? DEFAULT_PRUNE_SETTINGS
  const isUserTurn = opts.sideToMove === opts.userColor
  if (!withinDepth(opts.ply, isUserTurn, settings))
    return { moves: [], reason: 'depth', coverage: 0 }

  const total = totalGames(response)
  const candidates = response.moves
    .map((move) => ({
      move,
      share: total > 0 ? totalGames(move) / total : 0,
      userScore: scoreFor(move, opts.userColor),
    }))
    .filter((c) => c.share > 0)
    .sort((a, b) => b.share - a.share)
  if (candidates.length === 0) return { moves: [], reason: 'noGames', coverage: 0 }

  if (isUserTurn) {
    const eligible = candidates.filter((c) => c.share >= settings.userMinShare)
    const pick = eligible.length
      ? eligible.reduce((best, c) =>
          c.userScore > best.userScore || (c.userScore === best.userScore && c.share > best.share)
            ? c
            : best,
        )
      : candidates[0]
    return { moves: [pick], reason: 'chosen', coverage: pick.share }
  }

  const kept: SelectedMove[] = []
  // Sum integer game counts, not float shares, so boundary cases compare exactly.
  let coveredGames = 0
  const result = (reason: StopReason): Selection => ({
    moves: kept,
    reason,
    coverage: coveredGames / total,
  })
  for (const c of candidates) {
    if (c.share < settings.opponentMinShare) return result('floor')
    kept.push(c)
    coveredGames += totalGames(c.move)
    if (coveredGames / total >= settings.opponentCoverage) return result('coverage')
  }
  return result('exhausted')
}
