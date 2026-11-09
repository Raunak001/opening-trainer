// Opening-principle rules: early queen, same piece twice, no castle by move 10, no central
// pawn, undeveloped minors. Each judges the last move of a game. Pure: chess.js only.

import { Chess, type Color, type Move, type PieceSymbol, type Square } from 'chess.js'

export interface PrincipleOptions {
  /** Queen moves up to this move number count as early. */
  earlyQueenUntilMove: number
  /** Moving a piece a second time is flagged up to this move number. */
  samePieceUntilMove: number
  /** Not castled by this move number (with castling still available) is flagged. */
  castleByMove: number
  /** From this move number, having moved neither the d- nor the e-pawn is flagged. */
  centralPawnByMove: number
  /** From this move number, two or more minors still at home is flagged. */
  developMinorsByMove: number
}

export const DEFAULT_PRINCIPLE_OPTIONS: PrincipleOptions = {
  earlyQueenUntilMove: 6,
  samePieceUntilMove: 10,
  castleByMove: 10,
  centralPawnByMove: 3,
  developMinorsByMove: 6,
}

export type PrincipleFinding =
  | { type: 'early-queen'; san: string; moveNumber: number }
  | { type: 'same-piece-twice'; san: string; piece: PieceSymbol; moveNumber: number }
  | { type: 'no-castle'; moveNumber: number }
  | { type: 'no-central-pawn'; moveNumber: number }
  | { type: 'undeveloped-minors'; moveNumber: number; squares: Square[] }

const MINOR_HOMES: Record<Color, Square[]> = {
  w: ['b1', 'c1', 'f1', 'g1'],
  b: ['b8', 'c8', 'f8', 'g8'],
}
const CENTRAL_PAWN_HOMES: Record<Color, Square[]> = { w: ['d2', 'e2'], b: ['d7', 'e7'] }

interface Replay {
  moves: Move[]
  /** For each move: the square the moving piece started the game on. */
  origins: Square[]
  final: Chess
}

/** Plays the game, tracking each piece by its starting square. */
function replay(startFen: string, sans: readonly string[]): Replay {
  const chess = new Chess(startFen)
  const originAt = new Map<Square, Square>()
  for (const row of chess.board()) for (const p of row) if (p) originAt.set(p.square, p.square)

  const moves: Move[] = []
  const origins: Square[] = []
  for (const san of sans) {
    const move = chess.move(san)
    const origin = originAt.get(move.from) ?? move.from
    originAt.delete(move.from)
    originAt.set(move.to, origin)
    if (move.isKingsideCastle() || move.isQueensideCastle()) {
      const rank = move.color === 'w' ? '1' : '8'
      const [rookFrom, rookTo] = move.isKingsideCastle() ? ['h', 'f'] : ['a', 'd']
      const from = `${rookFrom}${rank}` as Square
      const to = `${rookTo}${rank}` as Square
      originAt.set(to, originAt.get(from) ?? from)
      originAt.delete(from)
    }
    moves.push(move)
    origins.push(origin)
  }
  return { moves, origins, final: chess }
}

function fullMoveOf(startFen: string, plyIndex: number): number {
  const fields = startFen.trim().split(/\s+/)
  const startMove = Number(fields[5] ?? '1') || 1
  const blackFirst = fields[1] === 'b'
  return startMove + Math.floor((plyIndex + (blackFirst ? 1 : 0)) / 2)
}

/**
 * Findings about the last move of `sans` (the move being judged), played from `startFen`.
 * Rules look at the mover's whole game so far, so pass the full history.
 */
export function principleFindings(
  startFen: string,
  sans: readonly string[],
  options: Partial<PrincipleOptions> = {},
): PrincipleFinding[] {
  if (sans.length === 0) return []
  const opts = { ...DEFAULT_PRINCIPLE_OPTIONS, ...options }
  const { moves, origins, final } = replay(startFen, sans)
  const last = moves.length - 1
  const move = moves[last]
  const mover = move.color
  const moveNumber = fullMoveOf(startFen, last)
  const mine = moves.map((m, i) => ({ m, origin: origins[i] })).filter(({ m }) => m.color === mover)
  const castled = (m: Move) => m.isKingsideCastle() || m.isQueensideCastle()
  const isCastle = castled(move)
  const findings: PrincipleFinding[] = []

  const minorsHome = MINOR_HOMES[mover].filter((sq) => {
    const p = final.get(sq)
    return p?.color === mover && (p.type === 'n' || p.type === 'b')
  })

  // Early queen: a quiet queen sortie while the minor pieces are still at home.
  if (
    move.piece === 'q' &&
    !move.captured &&
    moveNumber <= opts.earlyQueenUntilMove &&
    minorsHome.length >= 2
  ) {
    findings.push({ type: 'early-queen', san: move.san, moveNumber })
  }

  // Same piece twice: a non-pawn, non-king piece moves again before development is done,
  // unless it captures or runs from an attack.
  if (move.piece !== 'p' && move.piece !== 'k' && !isCastle && !move.captured) {
    const movedBefore = mine.slice(0, -1).some(({ origin }) => origin === origins[last])
    const before = new Chess(move.before)
    const wasAttacked = before.isAttacked(move.from, mover === 'w' ? 'b' : 'w')
    if (
      movedBefore &&
      !wasAttacked &&
      moveNumber <= opts.samePieceUntilMove &&
      minorsHome.length >= 1
    ) {
      findings.push({ type: 'same-piece-twice', san: move.san, piece: move.piece, moveNumber })
    }
  }

  // No castle: by move N, still uncastled with castling still possible, and not castling now.
  const hasCastled = mine.some(({ m }) => castled(m))
  const rights = final.getCastlingRights(mover)
  if (
    moveNumber >= opts.castleByMove &&
    !hasCastled &&
    (rights.k || rights.q) &&
    move.piece !== 'k'
  ) {
    findings.push({ type: 'no-castle', moveNumber })
  }

  // No central pawn: neither the d- nor the e-pawn has moved.
  const centralHome = CENTRAL_PAWN_HOMES[mover].every((sq) => {
    const p = final.get(sq)
    return p?.color === mover && p.type === 'p'
  })
  if (moveNumber >= opts.centralPawnByMove && centralHome && moveNumber <= opts.castleByMove) {
    findings.push({ type: 'no-central-pawn', moveNumber })
  }

  // Undeveloped minors: two or more minors at home and this move doesn't develop one.
  const developsMinor =
    (move.piece === 'n' || move.piece === 'b') && MINOR_HOMES[mover].includes(move.from)
  if (
    moveNumber >= opts.developMinorsByMove &&
    minorsHome.length >= 2 &&
    !developsMinor &&
    !isCastle &&
    !move.captured
  ) {
    findings.push({ type: 'undeveloped-minors', moveNumber, squares: minorsHome })
  }

  return findings
}
