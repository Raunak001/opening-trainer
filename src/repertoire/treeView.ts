import type { ExplorerResponse } from './explorer'
import type { PositionKey } from './positionKey'
import { scoreFor, selectMoves, type Color, type PruneSettings } from './prune'
import {
  shortestParent,
  sideToMove,
  totalGames,
  type RepertoireTree,
  type TreeEdge,
  type TreeNode,
} from './tree'

/** Percent split of results, White / draw / Black. Sums to 100 (or all 0). */
export interface ResultSplit {
  white: number
  draws: number
  black: number
}

export interface EdgeView {
  edge: TreeEdge
  child: TreeNode
  /** "1.e4", "1…e5", "12.Nf3" */
  label: string
  /**
   * True when this is the child's main route from the root, so the viewer
   * shows the child's subtree here. False for a transposition into a position
   * shown elsewhere (or a move back to an earlier position).
   */
  canonical: boolean
  games: number
  /** Share of the parent position's games; undefined if the parent has no totals. */
  share: number | undefined
  /** User's score with this move, 0–1. */
  score: number
  split: ResultSplit
  /** Whose move the edge is. */
  mover: Color
}

export function moveLabel(parentPly: number, san: string): string {
  const moveNo = Math.floor(parentPly / 2) + 1
  return parentPly % 2 === 0 ? `${moveNo}.${san}` : `${moveNo}…${san}`
}

export function resultSplit(stats: { white: number; draws: number; black: number }): ResultSplit {
  const games = totalGames(stats)
  if (games === 0) return { white: 0, draws: 0, black: 0 }
  return {
    white: (stats.white / games) * 100,
    draws: (stats.draws / games) * 100,
    black: (stats.black / games) * 100,
  }
}

/** The children of a position as the viewer shows them, most played first. */
export function childViews(tree: RepertoireTree, key: PositionKey, userColor: Color): EdgeView[] {
  const parent = tree.nodes[key]
  const parentGames = totalGames(parent)
  const mover = sideToMove(key)
  return parent.edges
    .map((edge) => {
      const child = tree.nodes[edge.to]
      const games = totalGames(edge)
      return {
        edge,
        child,
        label: moveLabel(parent.ply, edge.san),
        canonical: child.ply === parent.ply + 1 && shortestParent(tree, child)?.from === key,
        games,
        share: parentGames > 0 ? games / parentGames : undefined,
        score: scoreFor(edge, userColor),
        split: resultSplit(edge),
        mover,
      }
    })
    .sort((a, b) => b.games - a.games)
}

/** Positions shallower than `ply`: the viewer's initial expansion. */
export function expandedToPly(tree: RepertoireTree, ply: number): Set<PositionKey> {
  return new Set(
    Object.values(tree.nodes)
      .filter((n) => n.ply < ply)
      .map((n) => n.key),
  )
}

/** Every position that has children (for "expand all"). */
export function allExpandable(tree: RepertoireTree): Set<PositionKey> {
  return new Set(
    Object.values(tree.nodes)
      .filter((n) => n.edges.length > 0)
      .map((n) => n.key),
  )
}

export interface Candidate {
  san: string
  games: number
  share: number
  /** User's score with the move, 0–1. */
  score: number
  /** Meets the minimum share for automatic selection. */
  eligible: boolean
  /** What the builder picks without an override. */
  auto: boolean
  /** Currently in the repertoire. */
  current: boolean
}

/** Moves the user can swap to at a position, from its explorer data. */
export function overrideCandidates(
  response: ExplorerResponse,
  opts: { ply: number; userColor: Color; settings: PruneSettings; currentSan?: string },
): Candidate[] {
  const total = totalGames(response)
  const auto = selectMoves(response, {
    ply: opts.ply,
    userColor: opts.userColor,
    sideToMove: opts.userColor,
    settings: opts.settings,
  }).moves[0]?.move.san
  return response.moves
    .map((m) => {
      const games = totalGames(m)
      const share = total > 0 ? games / total : 0
      return {
        san: m.san,
        games,
        share,
        score: scoreFor(m, opts.userColor),
        eligible: share >= opts.settings.userMinShare,
        auto: m.san === auto,
        current: m.san === opts.currentSan,
      }
    })
    .filter((c) => c.games > 0)
    .sort((a, b) => b.games - a.games)
}

/**
 * New overrides after choosing `san` at `key`. Choosing the automatic pick
 * clears the override, so the position follows the data again.
 */
export function withOverride(
  overrides: Readonly<Record<PositionKey, string>> | undefined,
  key: PositionKey,
  san: string,
  autoSan: string | undefined,
): Record<PositionKey, string> {
  const rest = Object.fromEntries(Object.entries(overrides ?? {}).filter(([k]) => k !== key))
  return san === autoSan ? rest : { ...rest, [key]: san }
}

/** "61%" / "0.4%" / "<0.1%" */
export function formatPercent(fraction: number): string {
  const pct = fraction * 100
  if (pct === 0) return '0%'
  if (pct < 0.1) return '<0.1%'
  return pct < 10 ? `${pct.toFixed(1)}%` : `${Math.round(pct)}%`
}

/** 1234 → "1.2k", 1157866480 → "1.2B" */
export function formatGames(n: number): string {
  if (n < 1000) return String(n)
  const units: [number, string][] = [
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'k'],
  ]
  for (const [size, suffix] of units) {
    if (n >= size) {
      const v = n / size
      return `${v < 10 ? v.toFixed(1) : Math.round(v)}${suffix}`
    }
  }
  return String(n)
}
