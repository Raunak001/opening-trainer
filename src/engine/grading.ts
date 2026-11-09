// cp → win% (Lichess formula) → move grade.

import { Chess, type Move } from 'chess.js'
import type { AppSettings } from '../db/settings'
import type { Engine } from './engine'
import { evaluatePosition, type EvalCache, type PositionEval } from './evalCache'
import type { Score } from './uci'

export type MoveGrade = 'book' | 'good' | 'inaccuracy' | 'mistake' | 'blunder'

export type GradeThresholds = Pick<AppSettings['moveGrading'], 'inaccuracy' | 'mistake' | 'blunder'>

/** Lichess clamps evals to ±1000 cp; a forced mate counts as the clamp. */
export const CP_CEILING = 1000
/** Lichess's win% coefficient (lila `WinPercent`). */
export const WIN_PERCENT_K = 0.00368208

/** Win chance (0–100) for the side the score belongs to. `mate 0` means that side is mated. */
export function winPercent(score: Score): number {
  const cp =
    score.type === 'mate'
      ? score.value > 0
        ? CP_CEILING
        : -CP_CEILING
      : Math.max(-CP_CEILING, Math.min(CP_CEILING, score.value))
  return 50 + 50 * (2 / (1 + Math.exp(-WIN_PERCENT_K * cp)) - 1)
}

/** Grade for a win% loss (0–100 points). */
export function gradeForLoss(loss: number, thresholds: GradeThresholds): MoveGrade {
  if (loss >= thresholds.blunder) return 'blunder'
  if (loss >= thresholds.mistake) return 'mistake'
  if (loss >= thresholds.inaccuracy) return 'inaccuracy'
  return 'good'
}

export interface MoveGrading {
  grade: MoveGrade
  /** The move as played. */
  played: { uci: string; san: string }
  /** Engine's best move in the position before; null only if there was no legal move. */
  best: { uci: string; san: string } | null
  /** Eval of the position before the move (mover's point of view). */
  before: PositionEval
  /** Eval of the position after the move (opponent's point of view). */
  after: PositionEval
  /** Mover's win% before and after the move, and the drop between them (≥ 0). */
  winBefore: number
  winAfter: number
  loss: number
}

export interface GradeMoveOptions {
  depth: number
  thresholds: GradeThresholds
  /** The move is in the repertoire/explorer: graded `book` regardless of the engine. */
  isBook?: boolean
  signal?: AbortSignal
}

const UCI_MOVE = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/

function uciOf(move: Move): string {
  return move.from + move.to + (move.promotion ?? '')
}

/** Plays a SAN or UCI move; throws if it is illegal. */
export function playMove(chess: Chess, move: string): Move {
  const uci = UCI_MOVE.exec(move)
  return uci ? chess.move({ from: uci[1], to: uci[2], promotion: uci[3] }) : chess.move(move)
}

/**
 * Evaluates the position before and after `move` (SAN or UCI) and grades the move by the
 * mover's win% lost. Both evals go through the cache.
 */
export async function gradeMove(
  engine: Engine,
  cache: EvalCache,
  fen: string,
  move: string,
  { depth, thresholds, isBook = false, signal }: GradeMoveOptions,
): Promise<MoveGrading> {
  const chess = new Chess(fen)
  const played = playMove(chess, move)
  const fenAfter = chess.fen()

  const before = await evaluatePosition(engine, cache, fen, { depth, signal })
  const after = await evaluatePosition(engine, cache, fenAfter, { depth, signal })

  let best: MoveGrading['best'] = null
  if (before.bestMove) {
    const bestMove = playMove(new Chess(fen), before.bestMove)
    best = { uci: uciOf(bestMove), san: bestMove.san }
  }

  const isBest = best !== null && best.uci === uciOf(played)
  const winBefore = winPercent(before.score)
  const winAfter = 100 - winPercent(after.score)
  // The engine's own move loses nothing by definition; differing depths can make it look otherwise.
  const loss = isBest ? 0 : Math.max(0, winBefore - winAfter)

  return {
    grade: isBook ? 'book' : gradeForLoss(loss, thresholds),
    played: { uci: uciOf(played), san: played.san },
    best,
    before,
    after,
    winBefore,
    winAfter,
    loss,
  }
}
