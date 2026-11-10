// Game review: every move of an analysed game gets a mark (Brilliant … Blunder) and each side
// an accuracy, from per-position Stockfish evals. Pure: chess.js + engine math only.

import { Chess, type Move } from 'chess.js'
import type { AnalysisEval } from '../db/db'
import { winPercent } from '../engine/grading'
import { hangingPieces, materialBalance, PIECE_VALUES } from '../engine/material'
import type { Score } from '../engine/uci'

export type MoveMark =
  | 'brilliant'
  | 'great'
  | 'best'
  | 'excellent'
  | 'good'
  | 'book'
  | 'inaccuracy'
  | 'mistake'
  | 'miss'
  | 'blunder'

/** Display order, best to worst. */
export const MARKS: readonly MoveMark[] = [
  'brilliant',
  'great',
  'best',
  'excellent',
  'good',
  'book',
  'inaccuracy',
  'mistake',
  'miss',
  'blunder',
]

/** Marks worth stopping at when stepping through key moments. */
export const KEY_MARKS: ReadonlySet<MoveMark> = new Set([
  'brilliant',
  'great',
  'inaccuracy',
  'mistake',
  'miss',
  'blunder',
])

export type Side = 'white' | 'black'

/** Same fields as `AppSettings['analysis']` minus depth. Losses in win% points. */
export interface MarkThresholds {
  excellent: number
  good: number
  inaccuracy: number
  mistake: number
  greatGap: number
  minSacrifice: number
}

export interface MoveReview {
  /** Index into the game's SAN list. */
  ply: number
  san: string
  uci: string
  color: Side
  mark: MoveMark
  /** Mover's win% before (with best play) and after the move, and the drop (≥ 0). */
  winBefore: number
  winAfter: number
  loss: number
  /** Engine's choice in the position before; null when it had none. */
  best: { uci: string; san: string } | null
  /** Material the move gives up (pawns), as judged for Brilliant; 0 if none. */
  sacrifice: number
  fenBefore: string
  fenAfter: string
  from: string
  to: string
}

export interface GameReview {
  moves: MoveReview[]
  /** White's win% at each position (index 0 = start). */
  whiteWin: number[]
  accuracy: Record<Side, number>
  counts: Record<Side, Record<MoveMark, number>>
}

const uciOf = (m: Pick<Move, 'from' | 'to' | 'promotion'>) => m.from + m.to + (m.promotion ?? '')

function sideToMove(fen: string): Side {
  return fen.split(' ')[1] === 'b' ? 'black' : 'white'
}

/** White's win% for a side-to-move score at `fen`. */
export function whiteWinPercent(score: Score, fen: string): number {
  const w = winPercent(score)
  return sideToMove(fen) === 'white' ? w : 100 - w
}

/** Lichess per-move accuracy from the mover's win% before and after. */
export function moveAccuracy(winBefore: number, winAfter: number): number {
  if (winAfter >= winBefore) return 100
  const raw =
    103.1668100711649 * Math.exp(-0.04354415386753951 * (winBefore - winAfter)) - 3.166924740191411
  return Math.max(0, Math.min(100, raw + 1))
}

function stdDev(xs: readonly number[]): number {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length
  return Math.sqrt(xs.reduce((a, x) => a + (x - mean) ** 2, 0) / xs.length)
}

/**
 * Lichess game accuracy for `color`: the mean of a volatility-weighted mean and a harmonic
 * mean of per-move accuracies. `whiteWin` holds White's win% per position from the start.
 * 100 when the side made no move.
 */
export function gameAccuracy(whiteWin: readonly number[], color: Side): number {
  if (whiteWin.length < 2) return 100
  const size = Math.max(2, Math.min(8, Math.floor(whiteWin.length / 10)))
  const head = whiteWin.slice(0, size)
  const windows: number[][] = []
  for (let i = 0; i < Math.min(size, whiteWin.length) - 2; i++) windows.push(head)
  for (let i = 0; i + size <= whiteWin.length; i++) windows.push(whiteWin.slice(i, i + size))
  const weights = windows.map((w) => Math.max(0.5, Math.min(12, stdDev(w))))

  const scored: { acc: number; weight: number }[] = []
  for (let i = 0; i + 1 < whiteWin.length; i++) {
    const mover: Side = i % 2 === 0 ? 'white' : 'black'
    if (mover !== color) continue
    const pov = (w: number) => (color === 'white' ? w : 100 - w)
    scored.push({
      acc: moveAccuracy(pov(whiteWin[i]), pov(whiteWin[i + 1])),
      weight: weights[i] ?? 1,
    })
  }
  if (scored.length === 0) return 100
  const totalWeight = scored.reduce((a, s) => a + s.weight, 0)
  const weighted = scored.reduce((a, s) => a + s.acc * s.weight, 0) / totalWeight
  const harmonic = scored.length / scored.reduce((a, s) => a + 1 / Math.max(1, s.acc), 0)
  return (weighted + harmonic) / 2
}

/**
 * Material (pawns) the mover gives up with `move`: a piece left en prise beyond what the move
 * captured, or material down after the opponent's reply and the mover's next move in the
 * engine line. 0 when nothing is given up.
 */
export function sacrificeValue(fenBefore: string, move: Move, replyPv: readonly string[]): number {
  const color = move.color
  const sign = color === 'w' ? 1 : -1
  const captured = move.captured ? PIECE_VALUES[move.captured] : 0
  // Pieces hanging only because of this move (the moved piece always counts as new).
  const before = new Set(hangingPieces(fenBefore, color).map((h) => h.square))
  const newly = hangingPieces(move.after, color).filter(
    (h) => h.square === move.to || !before.has(h.square),
  )
  const hanging = Math.max(0, ...newly.map((h) => h.gain)) - captured

  // Checkpoints after the mover's own moves, so ordinary trades (offer, take, retake) net out.
  const start = materialBalance(fenBefore)
  let worst = sign * (materialBalance(move.after) - start)
  const chess = new Chess(move.after)
  for (let i = 0; i < Math.min(4, replyPv.length); i++) {
    const uci = replyPv[i]
    try {
      chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })
    } catch {
      break
    }
    if (i % 2 === 1) worst = Math.min(worst, sign * (materialBalance(chess.fen()) - start))
  }
  return Math.max(0, hanging, -worst)
}

/**
 * Plies of `sans` that are opening theory: every move up to the last position the opening
 * index names, scanning until `gap` unnamed plies in a row.
 */
export function bookPlies(
  sans: readonly string[],
  isNamed: (fen: string) => boolean,
  gap = 4,
): number {
  const chess = new Chess()
  let last = 0
  for (let i = 0; i < sans.length && i - last < gap; i++) {
    try {
      chess.move(sans[i])
    } catch {
      break
    }
    if (isNamed(chess.fen())) last = i + 1
  }
  return last
}

function baseMark(isBest: boolean, loss: number, t: MarkThresholds): MoveMark {
  if (isBest) return 'best'
  if (loss < t.excellent) return 'excellent'
  if (loss < t.good) return 'good'
  if (loss < t.inaccuracy) return 'inaccuracy'
  if (loss < t.mistake) return 'mistake'
  return 'blunder'
}

function emptyCounts(): Record<MoveMark, number> {
  return Object.fromEntries(MARKS.map((m) => [m, 0])) as Record<MoveMark, number>
}

export interface ReviewOptions {
  thresholds: MarkThresholds
  /** Number of opening plies marked Book (see `bookPlies`). */
  book: number
}

/** Marks every move of a game from its evals (`evals.length === sans.length + 1`). */
export function reviewGame(
  sans: readonly string[],
  evals: readonly AnalysisEval[],
  { thresholds: t, book }: ReviewOptions,
): GameReview {
  if (evals.length !== sans.length + 1) {
    throw new Error(`Expected ${sans.length + 1} evals, got ${evals.length}`)
  }
  const chess = new Chess()
  const fens = [chess.fen()]
  const moves: MoveReview[] = []

  for (let ply = 0; ply < sans.length; ply++) {
    const fenBefore = chess.fen()
    const legalCount = chess.moves().length
    const move = chess.move(sans[ply])
    const fenAfter = chess.fen()
    fens.push(fenAfter)

    const before = evals[ply]
    const after = evals[ply + 1]
    const uci = uciOf(move)
    const isBest = before.best === uci
    const winBefore = winPercent(before.score)
    const winAfter = 100 - winPercent(after.score)
    const loss = isBest ? 0 : Math.max(0, winBefore - winAfter)

    let best: MoveReview['best'] = null
    if (before.best) {
      const b = new Chess(fenBefore).move({
        from: before.best.slice(0, 2),
        to: before.best.slice(2, 4),
        promotion: before.best[4],
      })
      best = { uci: before.best, san: b.san }
    }

    const sacrifice = sacrificeValue(fenBefore, move, after.pv)
    let mark = baseMark(isBest, loss, t)
    const prev = moves[ply - 1]

    if (ply < book) {
      mark = 'book'
    } else if (
      loss < t.excellent &&
      sacrifice >= t.minSacrifice &&
      winBefore < 95 &&
      winAfter >= 50
    ) {
      mark = 'brilliant'
    } else if (isBest && legalCount > 1 && before.second && !isRecapture(move, prev)) {
      // Only move: the runner-up throws away the edge (or the game), not just some of it.
      const second = winPercent(before.second.score)
      if (winBefore - second >= t.greatGap && second <= 50 && winAfter >= 30) mark = 'great'
    } else if (
      (mark === 'mistake' || mark === 'blunder') &&
      prev &&
      prev.loss >= t.inaccuracy &&
      // Back to about where the mover stood before the opponent's error: a chance missed,
      // not a position thrown away.
      winAfter >= 100 - prev.winBefore - t.good
    ) {
      mark = 'miss'
    }

    moves.push({
      ply,
      san: move.san,
      uci,
      color: move.color === 'w' ? 'white' : 'black',
      mark,
      winBefore,
      winAfter,
      loss,
      best,
      sacrifice,
      fenBefore,
      fenAfter,
      from: move.from,
      to: move.to,
    })
  }

  const whiteWin = evals.map((e, i) => whiteWinPercent(e.score, fens[i]))
  const counts = { white: emptyCounts(), black: emptyCounts() }
  for (const m of moves) counts[m.color][m.mark]++
  return {
    moves,
    whiteWin,
    accuracy: { white: gameAccuracy(whiteWin, 'white'), black: gameAccuracy(whiteWin, 'black') },
    counts,
  }
}

/** Takes back on the square the opponent just captured on: obvious, never "Great". */
function isRecapture(move: Move, prev: MoveReview | undefined): boolean {
  if (!prev || !move.captured) return false
  return prev.to === move.to && /x/.test(prev.san)
}
