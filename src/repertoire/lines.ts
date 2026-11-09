import { State } from 'ts-fsrs'
import type { CardRow } from '../db'
import type { OpeningIndex } from './openings'
import type { PositionKey } from './positionKey'
import type { Color } from './prune'
import { sideToMove, totalGames, type RepertoireTree, type TreeNode } from './tree'

/** One root-to-leaf line of a course tree. */
export interface CourseLine {
  /** The leaf's position key: a stable id for the line. */
  id: PositionKey
  /** SAN from the initial position to the leaf. */
  moves: string[]
  /** Positions along the line: the start, then after each move. */
  positions: PositionKey[]
  /**
   * How often you will meet this line: the product of the opponent's move
   * shares along it (your own moves count as 1). 0–1.
   */
  frequency: number
  /** Deepest opening name on the line, if any position on it is named. */
  name?: string
}

/** Share of a node's games that went into one of its edges. */
function edgeShare(node: TreeNode, edgeGames: number): number {
  const total = totalGames(node) || node.edges.reduce((s, e) => s + totalGames(e), 0)
  return total > 0 ? edgeGames / total : 0
}

/** Nodes reachable from the root, parents before children (DFS post-order, reversed). */
function topoOrder(tree: RepertoireTree): TreeNode[] {
  const order: TreeNode[] = []
  const state = new Map<PositionKey, 'open' | 'done'>()
  const visit = (key: PositionKey) => {
    if (state.has(key)) return // done, or a cycle back to an open node (skipped)
    state.set(key, 'open')
    const node = tree.nodes[key]
    if (!node) return
    for (const e of node.edges) visit(e.to)
    state.set(key, 'done')
    order.push(node)
  }
  visit(tree.rootKey)
  return order.reverse()
}

/**
 * Enumerates a course's lines (pure): one per leaf. Where move orders
 * transpose, each leaf appears once, reached by its most popular path. Lines
 * are ordered by how often you will meet them, most frequent first.
 */
export function enumerateLines(
  tree: RepertoireTree,
  userColor: Color,
  openings?: OpeningIndex,
): CourseLine[] {
  // Best path into each node: its frequency and the edge it came through.
  const best = new Map<PositionKey, { frequency: number; from?: PositionKey; san?: string }>()
  best.set(tree.rootKey, { frequency: 1 })
  for (const node of topoOrder(tree)) {
    const here = best.get(node.key)
    if (!here) continue
    const userMove = sideToMove(node.key) === userColor
    for (const edge of node.edges) {
      const frequency = here.frequency * (userMove ? 1 : edgeShare(node, totalGames(edge)))
      const prev = best.get(edge.to)
      if (!prev || frequency > prev.frequency)
        best.set(edge.to, { frequency, from: node.key, san: edge.san })
    }
  }

  const lines: CourseLine[] = []
  for (const [key, entry] of best) {
    const leaf = tree.nodes[key]
    if (!leaf || leaf.edges.length > 0 || key === tree.rootKey) continue
    const moves: string[] = []
    const positions: PositionKey[] = [key]
    let cur = entry
    while (cur.from !== undefined && cur.san !== undefined) {
      moves.push(cur.san)
      positions.push(cur.from)
      cur = best.get(cur.from) as typeof cur
    }
    moves.reverse()
    positions.reverse()
    lines.push({
      id: key,
      moves,
      positions,
      frequency: entry.frequency,
      name: openings ? lineName(positions, openings) : undefined,
    })
  }
  return lines.sort(
    (a, b) => b.frequency - a.frequency || a.moves.join(' ').localeCompare(b.moves.join(' ')),
  )
}

/** The deepest named position along a line. */
export function lineName(
  positions: readonly PositionKey[],
  openings: OpeningIndex,
): string | undefined {
  for (let i = positions.length - 1; i >= 0; i--) {
    const opening = openings.get(positions[i])
    if (opening) return opening.name
  }
  return undefined
}

/**
 * new: the line still has moves you have not been taught (cards never
 * studied). Lines share their first moves, so a line is new until all of its
 * own moves are taught. learned: every card studied and none lapsed (taught in
 * Learn mode or reviewed; FSRS schedules it from there). learning: every move
 * taught, but a card lapsed and is being relearned.
 */
export type LineStatus = 'new' | 'learning' | 'learned'

/** The live (not suspended) cards on a line, in move order. */
export function lineCards(
  line: Pick<CourseLine, 'positions'>,
  cards: ReadonlyMap<PositionKey, CardRow>,
): CardRow[] {
  return line.positions
    .map((k) => cards.get(k))
    .filter((c): c is CardRow => c !== undefined && !c.suspended)
}

export function lineStatus(lineCardsInOrder: readonly CardRow[]): LineStatus {
  if (lineCardsInOrder.length === 0 || lineCardsInOrder.some((c) => c.state === State.New))
    return 'new'
  return lineCardsInOrder.some((c) => c.state === State.Relearning) ? 'learning' : 'learned'
}

/** Cards by position key, for one repertoire's cards. */
export function cardsByPosition(cards: readonly CardRow[]): Map<PositionKey, CardRow> {
  return new Map(cards.map((c) => [c.positionKey, c]))
}

/** A group of a course's lines, like a chapter in a course library (T7.10). */
export interface Chapter<L extends CourseLine = CourseLine> {
  /** Display name, also the id within a course. */
  name: string
  /** Lines in frequency order. */
  lines: L[]
  /** Summed frequency of the chapter's lines: how often you will be in it. */
  frequency: number
}

/** Chapter for lines whose name gives no variation. */
export const OTHER_LINES = 'Other lines'

/** What a course calls itself, for naming its chapters. */
export interface ChapterRoot {
  /** TSV name of the course's start position, e.g. "Caro-Kann Defense". */
  startName: string
  /** Opening families that are the course itself, e.g. "Caro-Kann Defense". */
  families: ReadonlySet<string>
}

/** The family part of an opening name: "Caro-Kann Defense: Advance Variation" → "Caro-Kann Defense". */
export function openingFamily(name: string): string {
  return name.split(':')[0].trim()
}

/**
 * The chapter a line belongs in, from its (deepest) opening name:
 * - in the course's own family, the variation: "Caro-Kann Defense: Advance
 *   Variation, Short Variation" → "Advance Variation";
 * - in another family, the family: a 1…e5 course's "Ruy Lopez: Morphy
 *   Defense" → "Ruy Lopez";
 * - no name, or only the start position's name → "Other lines".
 */
export function chapterName(openingName: string | undefined, root: ChapterRoot): string {
  if (!openingName || openingName === root.startName) return OTHER_LINES
  const colon = openingName.indexOf(':')
  if (colon < 0) return openingName
  const family = openingFamily(openingName)
  if (!root.families.has(family)) return family
  return (
    openingName
      .slice(colon + 1)
      .split(',')[0]
      .trim() || OTHER_LINES
  )
}

/**
 * Groups lines into chapters by variation (pure). Chapters are ordered by how
 * often you meet them, "Other lines" last; lines keep their order inside.
 */
export function groupChapters<L extends CourseLine>(
  lines: readonly L[],
  chapterOf: (line: L) => string,
): Chapter<L>[] {
  const byName = new Map<string, Chapter<L>>()
  for (const line of lines) {
    const name = chapterOf(line)
    let chapter = byName.get(name)
    if (!chapter) {
      chapter = { name, lines: [], frequency: 0 }
      byName.set(name, chapter)
    }
    chapter.lines.push(line)
    chapter.frequency += line.frequency
  }
  return [...byName.values()].sort(
    (a, b) =>
      Number(a.name === OTHER_LINES) - Number(b.name === OTHER_LINES) ||
      b.frequency - a.frequency ||
      a.name.localeCompare(b.name),
  )
}
