// Repertoire sanity check: flag chosen moves that lose too much against the engine's best.

import { Chess } from 'chess.js'
import type { PositionKey } from '../repertoire/positionKey'
import type { Engine } from './engine'
import { evaluatePosition, type EvalCache } from './evalCache'
import { CP_CEILING, playMove } from './grading'
import type { Score } from './uci'

/** One of the user's repertoire moves to check. */
export interface RepertoireMove {
  positionKey: PositionKey
  /** Full FEN of the position (side to move = user). */
  fen: string
  /** The chosen move, SAN. */
  san: string
}

export interface SanityFlag {
  positionKey: PositionKey
  fen: string
  san: string
  bestSan: string
  /** Centipawns lost against the best move (mover's point of view, mates clamped). */
  cpLoss: number
  /** Mover's eval with best play and after the chosen move. */
  bestScore: Score
  playedScore: Score
}

export interface SanityOptions {
  depth: number
  /** Flag moves losing more than this many centipawns against the best move. */
  maxCpLoss: number
  onProgress?: (done: number, total: number) => void
  signal?: AbortSignal
}

/** Score as centipawns, mates clamped to ±CP_CEILING like the win% formula. */
export function clampedCp(score: Score): number {
  if (score.type === 'mate') return score.value > 0 ? CP_CEILING : -CP_CEILING
  return Math.max(-CP_CEILING, Math.min(CP_CEILING, score.value))
}

function negate(score: Score): Score {
  // `mate 0` after a move means the opponent is mated: best possible for the mover.
  if (score.type === 'mate') return { type: 'mate', value: score.value === 0 ? 1 : -score.value }
  return { type: 'cp', value: -score.value }
}

/**
 * Evaluates each chosen move against the engine's best, one search at a time (evals are
 * cached, so re-running is cheap). Returns the flagged moves, worst first.
 */
export async function checkRepertoireMoves(
  engine: Engine,
  cache: EvalCache,
  moves: readonly RepertoireMove[],
  { depth, maxCpLoss, onProgress, signal }: SanityOptions,
): Promise<SanityFlag[]> {
  const flags: SanityFlag[] = []
  onProgress?.(0, moves.length)
  for (const [i, move] of moves.entries()) {
    if (signal?.aborted) throw new DOMException('Sanity check cancelled', 'AbortError')
    const before = await evaluatePosition(engine, cache, move.fen, { depth, signal })
    const board = new Chess(move.fen)
    const played = playMove(board, move.san)
    const bestSan = before.bestMove ? playMove(new Chess(move.fen), before.bestMove).san : null

    if (bestSan !== null && bestSan !== played.san) {
      const after = await evaluatePosition(engine, cache, board.fen(), { depth, signal })
      const playedScore = negate(after.score)
      const cpLoss = clampedCp(before.score) - clampedCp(playedScore)
      if (cpLoss > maxCpLoss) {
        flags.push({
          positionKey: move.positionKey,
          fen: move.fen,
          san: played.san,
          bestSan,
          cpLoss,
          bestScore: before.score,
          playedScore,
        })
      }
    }
    onProgress?.(i + 1, moves.length)
  }
  return flags.sort((a, b) => b.cpLoss - a.cpLoss)
}
