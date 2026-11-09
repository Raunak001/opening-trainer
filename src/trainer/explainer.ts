// Engine feedback for wrong drill moves: grade + template sentences. Not React.

import { Chess } from 'chess.js'
import { getSettings, type TrainerDB } from '../db'
import {
  dexieEvalCache,
  explainMove,
  getSharedEngine,
  gradeMove,
  SearchCancelledError,
  type Engine,
  type Explanation,
} from '../engine'
import type { MoveInput } from './drill'

export interface ExplainRequest {
  /** Position before the move. */
  fen: string
  move: MoveInput
  /** Start of the line and the SAN moves played before this one, for the opening rules. */
  startFen: string
  previous: readonly string[]
}

/** Resolves to undefined when no engine is available or the search was superseded. */
export type MoveExplainer = (request: ExplainRequest) => Promise<Explanation | undefined>

export function createMoveExplainer(db: TrainerDB, engine?: () => Engine): MoveExplainer {
  const cache = dexieEvalCache(db)
  return async ({ fen, move, startFen, previous }) => {
    let instance: Engine
    try {
      instance = (engine ?? getSharedEngine)()
    } catch {
      return undefined
    }
    const { moveGrading } = await getSettings(db)
    const san = new Chess(fen).move(move).san
    try {
      const grading = await gradeMove(instance, cache, fen, san, {
        depth: moveGrading.depth,
        thresholds: moveGrading,
      })
      return explainMove({ fen, grading, history: { startFen, sans: [...previous, san] } })
    } catch (error) {
      if (error instanceof SearchCancelledError) return undefined
      throw error
    }
  }
}

function article(label: string): string {
  return /^[aeiou]/.test(label) ? 'an' : 'a'
}

/**
 * Coach text for a wrong drill move. `revealBest` adds the sentence naming the better move;
 * only pass it once the answer is on the board anyway (the hint arrow).
 */
export function drillFeedback(san: string, explanation: Explanation, revealBest: boolean): string {
  const parts: string[] = []
  if (explanation.grade === 'good' || explanation.grade === 'book') {
    parts.push(`${san} is playable (${explanation.evalPlayed}), but it isn't your repertoire move.`)
  } else {
    parts.push(`${san} is ${article(explanation.label)} ${explanation.label}.`)
    if (explanation.reason) parts.push(explanation.reason)
  }
  if (revealBest && explanation.best) parts.push(explanation.best)
  return parts.join(' ')
}
