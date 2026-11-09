// Stockfish evaluations cached in IndexedDB by position key + depth.

import { Chess } from 'chess.js'
import type { EvalCacheRow, TrainerDB } from '../db'
import { positionKey, type PositionKey } from '../repertoire/positionKey'
import type { Engine } from './engine'
import type { Score } from './uci'

/** One position's evaluation. Scores are from the side to move's point of view. */
export interface PositionEval {
  positionKey: PositionKey
  depth: number
  score: Score
  /** UCI; null when the side to move has no legal move. */
  bestMove: string | null
  /** Principal variation in UCI, starting with `bestMove`. */
  pv: string[]
}

export interface EvalCache {
  /** Deepest stored eval for the position with depth ≥ `minDepth`. */
  get(pk: PositionKey, minDepth: number): Promise<PositionEval | undefined>
  put(evaluation: PositionEval): Promise<void>
}

export function evalCacheKey(pk: PositionKey, depth: number): string {
  return `${pk}|${depth}`
}

export function rowToEval(row: EvalCacheRow): PositionEval {
  const score: Score =
    row.mate !== undefined
      ? { type: 'mate', value: row.mate }
      : { type: 'cp', value: row.scoreCp ?? 0 }
  return {
    positionKey: row.positionKey,
    depth: row.depth,
    score,
    bestMove: row.bestMove,
    pv: row.pv,
  }
}

export function evalToRow(evaluation: PositionEval, now: number): EvalCacheRow | undefined {
  // Positions without a legal move are scored from the board, never by the engine.
  if (evaluation.bestMove === null) return undefined
  const row: EvalCacheRow = {
    key: evalCacheKey(evaluation.positionKey, evaluation.depth),
    positionKey: evaluation.positionKey,
    depth: evaluation.depth,
    bestMove: evaluation.bestMove,
    pv: evaluation.pv,
    createdAt: now,
  }
  if (evaluation.score.type === 'mate') row.mate = evaluation.score.value
  else row.scoreCp = evaluation.score.value
  return row
}

export function dexieEvalCache(db: TrainerDB, now: () => number = Date.now): EvalCache {
  return {
    async get(pk, minDepth) {
      const rows = await db.evalCache.where('positionKey').equals(pk).toArray()
      let best: EvalCacheRow | undefined
      for (const row of rows) {
        if (row.depth >= minDepth && (!best || row.depth > best.depth)) best = row
      }
      return best && rowToEval(best)
    },
    async put(evaluation) {
      const row = evalToRow(evaluation, now())
      if (row) await db.evalCache.put(row)
    },
  }
}

/**
 * Eval for a position with no legal move: checkmate is `mate 0` (side to move is mated),
 * stalemate is 0. Returns undefined when the game is not over by lack of moves.
 */
export function terminalEval(fen: string, depth: number): PositionEval | undefined {
  const chess = new Chess(fen)
  const pk = positionKey(fen)
  if (chess.isCheckmate()) {
    return { positionKey: pk, depth, score: { type: 'mate', value: 0 }, bestMove: null, pv: [] }
  }
  if (chess.isStalemate()) {
    return { positionKey: pk, depth, score: { type: 'cp', value: 0 }, bestMove: null, pv: [] }
  }
  return undefined
}

export interface EvaluateOptions {
  depth: number
  signal?: AbortSignal
}

/** Cached eval if one is deep enough, else a Stockfish search whose result is cached. */
export async function evaluatePosition(
  engine: Engine,
  cache: EvalCache,
  fen: string,
  { depth, signal }: EvaluateOptions,
): Promise<PositionEval> {
  const terminal = terminalEval(fen, depth)
  if (terminal) return terminal

  const pk = positionKey(fen)
  const cached = await cache.get(pk, depth)
  if (cached) return cached

  const result = await engine.search(fen, { depth }, { signal })
  const line = result.lines[0]
  if (!line || result.bestMove === null) {
    throw new Error(`Engine returned no evaluation for ${fen}`)
  }
  const evaluation: PositionEval = {
    positionKey: pk,
    depth,
    score: line.score,
    bestMove: result.bestMove,
    pv: line.pv,
  }
  await cache.put(evaluation)
  return evaluation
}
