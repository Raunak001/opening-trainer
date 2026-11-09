// Learn-mode narration (T7.6b): rule templates over tree stats, concept checks
// and cached engine evals. No LLM (CLAUDE.md).

import type { Score } from '../engine/uci'
import type { OpeningIndex } from '../repertoire/openings'
import { positionKey, type PositionKey } from '../repertoire/positionKey'
import { formatScore } from '../engine/explain'
// Direct module imports: the lessons and repertoire indexes also re-export React pages.
import { detectConcepts, developingMoves, occupiesCenter } from '../lessons/concepts'
import { scoreFor } from '../repertoire/prune'
import { totalGames, type RepertoireTree, type TreeNode } from '../repertoire/tree'
import type { Side } from './drill'

const sideName = (side: Side) => (side === 'white' ? 'White' : 'Black')
const pct = (x: number) => `${Math.round(x * 100)}%`

/** "3.e5" or "3…Bf5", from the FEN before the move. */
export function numberedSan(fenBefore: string, san: string): string {
  const [, turn, , , , full] = fenBefore.split(' ')
  return `${full ?? '1'}${turn === 'b' ? '…' : '.'}${san}`
}

/**
 * Plain-language ideas behind a move, from the lesson concept checks: strikes
 * the centre, takes the centre, develops a piece, castles, hits the queen.
 */
export function conceptTags(fenBefore: string, san: string): string[] {
  const tags: string[] = []
  // No move-number limits here: in Learn mode even move one gets its idea.
  const hits = detectConcepts(fenBefore, {
    maxMove: 99,
    strikeFromMove: 1,
    castleFromMove: 1,
    queenByMove: 99,
  })
  const hit = (concept: string) => hits.some((h) => h.concept === concept && h.moves.includes(san))
  if (hit('strike-center')) tags.push('strikes at the centre')
  else if (occupiesCenter(fenBefore, san)) tags.push('takes a central square')
  if (developingMoves(fenBefore).includes(san)) tags.push('develops a piece')
  if (hit('castle-early')) tags.push('castles the king to safety')
  if (hit('punish-early-queen')) tags.push('hits the queen')
  return tags
}

function joinWords(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

export interface NarrationInput {
  san: string
  fenBefore: string
  /** Whose move it is: yours or the opponent's. */
  byUser: boolean
  /** The side you play. */
  side: Side
  /** The tree position before the move (explorer stats on it and its edges). */
  node?: TreeNode
  /** Set when the move reaches a position with a new opening name. */
  newOpening?: string
  /** Cached engine eval of the position after the move, side to move's view. */
  evalAfter?: Score
}

const ORDINALS = ['most common', 'second most common', 'third most common']

/** Opponent move: how common it is here. */
function opponentText(input: NarrationInput, mover: string): string {
  const move = numberedSan(input.fenBefore, input.san)
  const node = input.node
  const edge = node?.edges.find((e) => e.san === input.san)
  const total = node ? totalGames(node) || node.edges.reduce((s, e) => s + totalGames(e), 0) : 0
  if (!node || !edge || total === 0) return `${move}: ${mover} plays ${input.san}.`
  const share = totalGames(edge) / total
  const rank = [...node.edges]
    .sort((a, b) => totalGames(b) - totalGames(a))
    .findIndex((e) => e.san === input.san)
  const games = `${pct(share)} of games`
  const what =
    rank < ORDINALS.length && share >= 0.05
      ? `${mover}'s ${ORDINALS[rank]} reply here (${games})`
      : `a rarer try for ${mover} (${games})`
  return `${move}: ${what[0].toUpperCase()}${what.slice(1)}.`
}

/** Your move: its score and share, the ideas behind it, and the engine's view. */
function userText(input: NarrationInput, you: string): string {
  const move = numberedSan(input.fenBefore, input.san)
  const parts = [`${move} is your move.`]
  const node = input.node
  const edge = node?.edges.find((e) => e.san === input.san)
  const total = node ? totalGames(node) : 0
  if (edge && totalGames(edge) > 0) {
    const share = total > 0 ? ` and is played in ${pct(totalGames(edge) / total)} of games` : ''
    parts.push(`It scores ${pct(scoreFor(edge, input.side))} for ${you}${share}.`)
  }
  const tags = conceptTags(input.fenBefore, input.san)
  if (tags.length) parts.push(`It ${joinWords(tags)}.`)
  if (input.evalAfter) {
    // Engine scores are from the side to move after the move: flip to White's view.
    const whiteToMove = input.fenBefore.split(' ')[1] === 'b'
    const s = input.evalAfter
    const white: Score = whiteToMove
      ? s
      : { type: s.type, value: s.type === 'mate' && s.value === 0 ? 0 : -s.value }
    parts.push(`Engine: ${formatScore(white)}.`)
  }
  return parts.join(' ')
}

/** One move's narration. */
export function narrateMove(input: NarrationInput): string {
  const mover = sideName(input.byUser ? input.side : input.side === 'white' ? 'black' : 'white')
  const text = input.byUser ? userText(input, mover) : opponentText(input, mover)
  return input.newOpening ? `${text} This is the ${input.newOpening}.` : text
}

/** Narration for every move of a line, naming each opening the first time it is reached. */
export function lineNarration(
  steps: readonly { san: string; fenBefore: string; fenAfter: string; byUser: boolean }[],
  side: Side,
  context: {
    tree?: RepertoireTree
    openings?: OpeningIndex
    evals?: ReadonlyMap<PositionKey, Score>
  } = {},
): string[] {
  const texts: string[] = []
  let current: string | undefined
  for (const step of steps) {
    const after = positionKey(step.fenAfter)
    const name = context.openings?.get(after)?.name
    texts.push(
      narrateMove({
        san: step.san,
        fenBefore: step.fenBefore,
        byUser: step.byUser,
        side,
        node: context.tree?.nodes[positionKey(step.fenBefore)],
        newOpening: name && name !== current ? name : undefined,
        evalAfter: context.evals?.get(after),
      }),
    )
    if (name) current = name
  }
  return texts
}
