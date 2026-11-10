import { Chess } from 'chess.js'

/** What a move sounds like. Mirrors the usual chess-site set: plain, capture, castle, check, promote. */
export type MoveSound = 'move' | 'capture' | 'castle' | 'check' | 'promote'

/** Every sound the board can play: a move sound, or `wrong` for a rejected drill move. */
export type BoardSound = MoveSound | 'wrong'

/** Placement and side to move: enough to tell which legal move led from one FEN to the next. */
const placement = (fen: string) => fen.split(' ').slice(0, 2).join(' ')

/**
 * The sound for going from `prev` to `next`, or null when `next` is not one legal move
 * after `prev` (a reset, a step back, a jump through a line). Check wins over everything,
 * then promotion, castling and capture, as on the big chess sites.
 */
export function moveSound(prev: string, next: string): MoveSound | null {
  if (prev === next) return null
  let moves
  try {
    moves = new Chess(prev).moves({ verbose: true })
  } catch {
    return null
  }
  const target = placement(next)
  const move = moves.find((m) => placement(m.after) === target)
  if (!move) return null
  if (move.san.endsWith('+') || move.san.endsWith('#')) return 'check'
  if (move.isPromotion()) return 'promote'
  if (move.isKingsideCastle() || move.isQueensideCastle()) return 'castle'
  if (move.isCapture() || move.isEnPassant()) return 'capture'
  return 'move'
}
