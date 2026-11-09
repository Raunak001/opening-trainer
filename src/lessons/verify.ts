// Stockfish check for mined candidates: is a concept move actually close to best? Not React.

import { Chess } from 'chess.js'
import { evaluatePosition, type EvalCache } from '../engine/evalCache'
import type { Engine } from '../engine/engine'
import { playMove } from '../engine/grading'
import type { Score } from '../engine/uci'
import { scoreValue } from './authoring'
import type { MinedCandidate } from './mining'

export interface MoveCheck {
  san: string
  /** Centipawns lost against the engine's best (0 for the best move itself). */
  lossCp: number
}

export interface Verdict {
  /** The engine's move, in SAN (null if the position has none). */
  bestSan: string | null
  /** Side-to-move point of view. */
  bestScore: Score
  /** Concept moves, best first. */
  moves: MoveCheck[]
  /** At least one concept move is within the margin. */
  ok: boolean
}

export interface VerifyOptions {
  depth: number
  withinCp: number
  /** Concept moves checked per position, in the order given (the rest are skipped). */
  maxMoves?: number
  signal?: AbortSignal
}

const flip = (s: Score): Score =>
  s.type === 'mate'
    ? { type: 'mate', value: s.value === 0 ? 0 : -s.value }
    : { type: 'cp', value: -s.value }

/** How much a mate swing is worth when it is compared with centipawns. */
const MATE_LOSS_CAP = 2000

/** Evaluates the position and each concept move through the eval cache. */
export async function verifyCandidate(
  engine: Engine,
  cache: EvalCache,
  candidate: Pick<MinedCandidate, 'fen' | 'moves'>,
  { depth, withinCp, maxMoves = 6, signal }: VerifyOptions,
): Promise<Verdict> {
  const before = await evaluatePosition(engine, cache, candidate.fen, { depth, signal })
  const best = before.bestMove ? playMove(new Chess(candidate.fen), before.bestMove).san : null
  const moves: MoveCheck[] = []
  for (const san of candidate.moves.slice(0, maxMoves)) {
    if (san === best) {
      moves.push({ san, lossCp: 0 })
      continue
    }
    const chess = new Chess(candidate.fen)
    chess.move(san)
    const after = await evaluatePosition(engine, cache, chess.fen(), { depth, signal })
    const loss = scoreValue(before.score) - scoreValue(flip(after.score))
    moves.push({ san, lossCp: Math.min(MATE_LOSS_CAP, Math.max(0, loss)) })
  }
  moves.sort((a, b) => a.lossCp - b.lossCp)
  return {
    bestSan: best,
    bestScore: before.score,
    moves,
    ok: moves.some((m) => m.lossCp <= withinCp),
  }
}

export interface VerifyManyOptions extends VerifyOptions {
  /** Stop once this many candidates pass, per concept. */
  wantPerConcept: number
  /** Never check more than this many candidates per concept. */
  maxChecksPerConcept: number
  onProgress?: (checked: number) => void
}

export type VerifiedCandidate = MinedCandidate & { verdict: Verdict }

/**
 * Checks candidates in rank order, per concept, until enough pass. Returns the passing
 * ones (with their verdicts), still in rank order.
 */
export async function verifyCandidates(
  engine: Engine,
  cache: EvalCache,
  candidates: readonly MinedCandidate[],
  options: VerifyManyOptions,
): Promise<VerifiedCandidate[]> {
  const passed = new Map<string, number>()
  const checked = new Map<string, number>()
  const out: VerifiedCandidate[] = []
  let total = 0
  for (const candidate of candidates) {
    const concept = candidate.concept
    if ((passed.get(concept) ?? 0) >= options.wantPerConcept) continue
    if ((checked.get(concept) ?? 0) >= options.maxChecksPerConcept) continue
    checked.set(concept, (checked.get(concept) ?? 0) + 1)
    const verdict = await verifyCandidate(engine, cache, candidate, options)
    options.onProgress?.(++total)
    if (!verdict.ok) continue
    passed.set(concept, (passed.get(concept) ?? 0) + 1)
    out.push({ ...candidate, verdict })
  }
  return out
}
