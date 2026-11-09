// Concept detectors: which moves in a position express a lesson concept. Pure: chess.js only.
// They only find candidates; the authoring tool checks them with Stockfish.

import { Chess, type Color, type Move, type Square } from 'chess.js'
import { hangingPieces } from '../engine/material'
import { principleFindings } from '../engine/principles'
import type { KnownConcept } from './lesson'

export interface DetectOptions {
  /** Positions after this full move number are not opening lessons. */
  maxMove: number
  /** Strike-the-center starts at this move (first-move choices are no lesson). */
  strikeFromMove: number
  /** Castle-early starts at this move (castling on move 2 is no lesson). */
  castleFromMove: number
  /** Punish-early-queen: the enemy queen must be out by this move. */
  queenByMove: number
}

export const DEFAULT_DETECT_OPTIONS: DetectOptions = {
  maxMove: 12,
  strikeFromMove: 3,
  castleFromMove: 4,
  queenByMove: 10,
}

/** A concept the position offers, and the moves that carry it out (SAN). */
export interface ConceptHit {
  concept: KnownConcept
  moves: string[]
}

const CENTER: Square[] = ['d4', 'e4', 'd5', 'e5']
const MINOR_HOMES: Record<Color, Square[]> = {
  w: ['b1', 'c1', 'f1', 'g1'],
  b: ['b8', 'c8', 'f8', 'g8'],
}
const QUEEN_HOME: Record<Color, Square> = { w: 'd1', b: 'd8' }

const other = (c: Color): Color => (c === 'w' ? 'b' : 'w')
const fileOf = (sq: Square) => sq.charCodeAt(0) - 97
const rankOf = (sq: Square) => Number(sq[1])

function moveNumber(fen: string): number {
  return Number(fen.split(' ')[5] ?? '1') || 1
}

function square(file: number, rank: number): Square | undefined {
  if (file < 0 || file > 7 || rank < 1 || rank > 8) return undefined
  return `${String.fromCharCode(97 + file)}${rank}` as Square
}

/** Squares a pawn of `color` on `sq` attacks. */
function pawnAttacks(sq: Square, color: Color): Square[] {
  const dir = color === 'w' ? 1 : -1
  return [
    square(fileOf(sq) - 1, rankOf(sq) + dir),
    square(fileOf(sq) + 1, rankOf(sq) + dir),
  ].filter((s): s is Square => s !== undefined)
}

function isPawn(chess: Chess, sq: Square, color: Color): boolean {
  const p = chess.get(sq)
  return p?.type === 'p' && p.color === color
}

/** Whether the piece that just moved to `m.to` can be won by the opponent. */
function leavesHanging(m: Move): boolean {
  return hangingPieces(m.after, m.color).some((h) => h.square === m.to)
}

function minorsHome(chess: Chess, color: Color): Square[] {
  return MINOR_HOMES[color].filter((sq) => {
    const p = chess.get(sq)
    return p?.color === color && (p.type === 'n' || p.type === 'b')
  })
}

/** Pawn moves on the c–f files that hit (or take) an enemy central pawn. */
function strikeCenter(chess: Chess, moves: Move[]): string[] {
  const me = chess.turn()
  const them = other(me)
  if (!CENTER.some((sq) => isPawn(chess, sq, them))) return []
  return moves
    .filter((m) => {
      if (m.piece !== 'p' || fileOf(m.to) < 2 || fileOf(m.to) > 5) return false
      if (m.captured === 'p' && CENTER.includes(m.to)) return true
      if (m.captured) return false
      return pawnAttacks(m.to, me).some((sq) => CENTER.includes(sq) && isPawn(chess, sq, them))
    })
    .map((m) => m.san)
}

function castleEarly(moves: Move[]): string[] {
  return moves.filter((m) => m.isKingsideCastle() || m.isQueensideCastle()).map((m) => m.san)
}

/** Developing or pawn moves that attack an early enemy queen without losing the piece. */
function punishQueen(chess: Chess, moves: Move[]): string[] {
  const them = other(chess.turn())
  const queens = chess.findPiece({ type: 'q', color: them })
  if (queens.length !== 1 || queens[0] === QUEEN_HOME[them]) return []
  const queen = queens[0]
  const home = MINOR_HOMES[chess.turn()]
  return moves
    .filter((m) => {
      if (m.captured === 'q') return true
      const develops = (m.piece === 'n' || m.piece === 'b') && home.includes(m.from)
      if (!develops && m.piece !== 'p') return false
      const after = new Chess(m.after)
      return after.attackers(queen, m.color).includes(m.to) && !leavesHanging(m)
    })
    .map((m) => m.san)
}

/** Whether `san` puts a pawn on d4, e4, d5 or e5: central play, though not a strike. */
export function occupiesCenter(fen: string, san: string): boolean {
  try {
    const m = new Chess(fen).move(san)
    return m.piece === 'p' && CENTER.includes(m.to)
  } catch {
    return false
  }
}

/** Minor pieces leaving home to a square where they are not simply lost. */
export function developingMoves(fen: string): string[] {
  const chess = new Chess(fen)
  const home = MINOR_HOMES[chess.turn()]
  return chess
    .moves({ verbose: true })
    .filter((m) => (m.piece === 'n' || m.piece === 'b') && home.includes(m.from) && !m.captured)
    .filter((m) => !leavesHanging(m))
    .map((m) => m.san)
}

/**
 * Concepts the position offers on its own: strike the center, castle early, punish the
 * early queen. (Develop-before-attacking needs the move actually played: see
 * `prematureAttack`.)
 */
export function detectConcepts(fen: string, options: Partial<DetectOptions> = {}): ConceptHit[] {
  const opts = { ...DEFAULT_DETECT_OPTIONS, ...options }
  const chess = new Chess(fen)
  const n = moveNumber(fen)
  if (n > opts.maxMove || chess.isGameOver()) return []
  const moves = chess.moves({ verbose: true })
  const hits: ConceptHit[] = []

  if (n >= opts.strikeFromMove) {
    const strike = strikeCenter(chess, moves)
    if (strike.length > 0) hits.push({ concept: 'strike-center', moves: strike })
  }

  if (n >= opts.castleFromMove && !chess.inCheck()) {
    const castles = castleEarly(moves)
    if (castles.length > 0) hits.push({ concept: 'castle-early', moves: castles })
  }

  if (n <= opts.queenByMove) {
    const punish = punishQueen(chess, moves)
    if (punish.length > 0) hits.push({ concept: 'punish-early-queen', moves: punish })
  }
  return hits
}

/**
 * Whether `san`, played after `sans` from `startFen`, attacks before development is done:
 * an early queen sortie, the same piece moving twice, or a flank pawn lunge (a/b/g/h pawn
 * to the fourth or fifth rank) with two or more minor pieces still at home.
 */
export function prematureAttack(startFen: string, sans: readonly string[], san: string): boolean {
  const chess = new Chess(startFen)
  for (const s of sans) chess.move(s)
  if (minorsHome(chess, chess.turn()).length < 2) return false
  const move = chess.move(san)
  const findings = principleFindings(startFen, [...sans, move.san])
  if (findings.some((f) => f.type === 'early-queen' || f.type === 'same-piece-twice')) return true
  if (move.piece !== 'p' || move.captured) return false
  const file = fileOf(move.to)
  const rank = move.color === 'w' ? rankOf(move.to) : 9 - rankOf(move.to)
  return (file <= 1 || file >= 6) && rank >= 4
}
