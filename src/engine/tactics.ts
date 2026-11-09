// Fork and mate checks for move explanations. Fork rule ported from the idea in
// lichess-puzzler's tagger (cook.py `fork`): the moved piece (not a king) stands on a safe
// square and attacks at least two non-pawn enemy pieces that are each either worth more than
// it (the king counts as most valuable) or undefended. Pure: chess.js only.

import { Chess, type Color, type PieceSymbol, type Square } from 'chess.js'
import type { MoveGrading } from './grading'
import { lineMaterial, PIECE_VALUES, staticExchange } from './material'
import type { Score } from './uci'

const UCI_MOVE = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/
const KING_VALUE = 99

function value(piece: PieceSymbol): number {
  return piece === 'k' ? KING_VALUE : PIECE_VALUES[piece]
}

function play(chess: Chess, move: string) {
  const uci = UCI_MOVE.exec(move)
  return uci ? chess.move({ from: uci[1], to: uci[2], promotion: uci[3] }) : chess.move(move)
}

function tryPlay(chess: Chess, move: string) {
  try {
    return play(chess, move)
  } catch {
    return undefined
  }
}

export interface ForkTarget {
  square: Square
  piece: PieceSymbol
}

export interface Fork {
  /** 0-based ply within the line where the forking move is played. */
  ply: number
  san: string
  /** Side that forks. */
  color: Color
  piece: PieceSymbol
  square: Square
  targets: ForkTarget[]
}

/** Is the move just played (landing on `square`) a fork? `fen` is the position after it. */
export function forkAt(fen: string, square: Square): ForkTarget[] | null {
  const chess = new Chess(fen, { skipValidation: true })
  const forker = chess.get(square)
  if (!forker || forker.type === 'k' || forker.color === chess.turn()) return null
  // Bad spot: the opponent (to move) wins material by taking the forking piece.
  const exchange = staticExchange(fen, square)
  if (exchange !== null && exchange > 0) return null

  const enemy = chess.turn()
  const targets: ForkTarget[] = []
  for (const row of chess.board()) {
    for (const piece of row) {
      if (!piece || piece.color !== enemy || piece.type === 'p') continue
      if (!chess.attackers(piece.square, forker.color).includes(square)) continue
      const worthMore = value(piece.type) > value(forker.type)
      const undefended =
        chess.attackers(piece.square, enemy).length === 0 &&
        !chess.attackers(square, enemy).includes(piece.square)
      if (worthMore || undefended) targets.push({ square: piece.square, piece: piece.type })
    }
  }
  return targets.length >= 2 ? targets.sort((a, b) => value(b.piece) - value(a.piece)) : null
}

/**
 * Forks played by `side` within the first `maxPlies` plies of `moves` (UCI or SAN) from `fen`.
 */
export function findForks(
  fen: string,
  moves: readonly string[],
  side: Color,
  maxPlies = 4,
): Fork[] {
  const chess = new Chess(fen)
  const forks: Fork[] = []
  for (const [ply, move] of moves.slice(0, maxPlies).entries()) {
    const played = tryPlay(chess, move)
    if (!played) break
    if (played.color !== side) continue
    const targets = forkAt(chess.fen(), played.to)
    if (targets) {
      forks.push({
        ply,
        san: played.san,
        color: side,
        piece: played.piece,
        square: played.to,
        targets,
      })
    }
  }
  return forks
}

export type TacticFinding =
  /** The engine line forks within the mover's first two moves; the played move doesn't. */
  | { type: 'missed-fork'; fork: Fork }
  /** After the played move, the opponent's best line forks within their first two moves. */
  | { type: 'allows-fork'; fork: Fork }
  /** The mover had a forced mate and the played move lets it go. */
  | { type: 'missed-mate'; mateIn: number; sans: string[] }
  /** The played move walks into a forced mate that wasn't there before. */
  | { type: 'allows-mate'; mateIn: number; sans: string[] }

export interface TacticCheckInput {
  fen: string
  played: string
  bestPv: readonly string[]
  replyPv: readonly string[]
  /** Eval before the move, mover's point of view. */
  before: Score
  /** Eval after the move, opponent's point of view. */
  after: Score
}

/** Plies of each line searched for forks: the forking side's first two moves. */
const FORK_PLIES = 4

export function tacticFindings(input: TacticCheckInput): TacticFinding[] {
  const { fen, played, bestPv, replyPv, before, after } = input
  const board = new Chess(fen)
  const mover = board.turn()
  const opponent: Color = mover === 'w' ? 'b' : 'w'
  const move = play(board, played)
  const fenAfter = board.fen()
  const bestFirst = bestPv.length > 0 ? tryPlay(new Chess(fen), bestPv[0]) : undefined
  const isBest = bestFirst?.san === move.san
  const findings: TacticFinding[] = []
  if (isBest) return findings

  const moverMatesBefore = before.type === 'mate' && before.value > 0
  const moverMatesAfter = after.type === 'mate' && after.value <= 0
  if (moverMatesBefore && !moverMatesAfter) {
    findings.push({
      type: 'missed-mate',
      mateIn: before.value,
      sans: lineMaterial(fen, bestPv).sans,
    })
  }

  const opponentMatesAfter = after.type === 'mate' && after.value > 0
  const opponentMatedBefore = before.type === 'mate' && before.value < 0
  if (opponentMatesAfter && !opponentMatedBefore) {
    findings.push({
      type: 'allows-mate',
      mateIn: after.value,
      sans: lineMaterial(fenAfter, replyPv).sans,
    })
  }

  // A mate outranks a fork; don't bury it under one.
  if (findings.length > 0) return findings

  const missed = findForks(fen, bestPv, mover, FORK_PLIES)[0]
  const playedForks = forkAt(fenAfter, move.to)
  if (missed && !playedForks) findings.push({ type: 'missed-fork', fork: missed })

  const allowed = findForks(fenAfter, replyPv, opponent, FORK_PLIES)[0]
  if (allowed) findings.push({ type: 'allows-fork', fork: allowed })

  return findings
}

/** Convenience: tactic findings for a graded move. */
export function tacticFindingsForGrading(fen: string, grading: MoveGrading): TacticFinding[] {
  return tacticFindings({
    fen,
    played: grading.played.uci,
    bestPv: grading.before.pv,
    replyPv: grading.after.pv,
    before: grading.before.score,
    after: grading.after.score,
  })
}
