// Runs Stockfish over every position of a game and stores the result.

import { Chess } from 'chess.js'
import type { AnalysisEval, GameAnalysisRow, TrainerDB } from '../db/db'
import type { Engine } from '../engine/engine'
import { terminalEval, type EvalCache } from '../engine/evalCache'
import { positionKey } from '../repertoire/positionKey'
import { gameAccuracy, whiteWinPercent } from './classify'

export interface AnalyzeOptions {
  depth: number
  signal?: AbortSignal
  /** Called after each position: `done` of `total` positions evaluated. */
  onProgress?: (done: number, total: number) => void
  /** Best lines are shared with the app's eval cache when given. */
  cache?: EvalCache
}

/** FEN of every position of the game, start position first. */
export function gameFens(sans: readonly string[]): string[] {
  const chess = new Chess()
  const fens = [chess.fen()]
  for (const san of sans) {
    chess.move(san)
    fens.push(chess.fen())
  }
  return fens
}

/** Two engine lines for each position: the best, and the runner-up for "Great" moves. */
export async function analyzeGame(
  engine: Engine,
  sans: readonly string[],
  { depth, signal, onProgress, cache }: AnalyzeOptions,
): Promise<AnalysisEval[]> {
  const fens = gameFens(sans)
  const evals: AnalysisEval[] = []
  for (const fen of fens) {
    const terminal = terminalEval(fen, depth)
    if (terminal) {
      evals.push({ score: terminal.score, best: null, pv: [] })
    } else {
      const result = await engine.search(fen, { depth, multiPv: 2 }, { signal })
      const [top, second] = result.lines
      if (!top || result.bestMove === null)
        throw new Error(`Engine returned no evaluation for ${fen}`)
      const entry: AnalysisEval = { score: top.score, best: result.bestMove, pv: top.pv }
      if (second?.pv[0]) entry.second = { move: second.pv[0], score: second.score }
      evals.push(entry)
      await cache?.put({
        positionKey: positionKey(fen),
        depth,
        score: top.score,
        bestMove: result.bestMove,
        pv: top.pv,
      })
    }
    onProgress?.(evals.length, fens.length)
  }
  return evals
}

/** The stored row for a finished analysis. */
export function analysisRow(
  gameId: string,
  sans: readonly string[],
  evals: AnalysisEval[],
  depth: number,
  now: number,
): GameAnalysisRow {
  const fens = gameFens(sans)
  const whiteWin = evals.map((e, i) => whiteWinPercent(e.score, fens[i]))
  return {
    gameId,
    depth,
    analyzedAt: now,
    evals,
    accuracy: { white: gameAccuracy(whiteWin, 'white'), black: gameAccuracy(whiteWin, 'black') },
  }
}

export async function saveAnalysis(db: TrainerDB, row: GameAnalysisRow): Promise<void> {
  await db.analyses.put(row)
}
