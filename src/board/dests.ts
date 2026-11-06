import { Chess, type Square } from 'chess.js'
import type { Color, Dests, Key } from 'chessground/types'

export type PromotionPiece = 'q' | 'r' | 'b' | 'n'

/**
 * Legal destination squares for each movable piece, in chessground's format.
 * Castling is listed both as the king's real target (g1/c1) and as the rook's
 * square (h1/a1), so the king can also be dropped onto its rook, like on Lichess.
 */
export function legalDests(fen: string): Dests {
  const chess = new Chess(fen)
  const dests: Dests = new Map()
  const add = (from: Key, to: Key) => {
    const list = dests.get(from)
    // Promotions yield one move per piece type; keep each target square once.
    if (!list) dests.set(from, [to])
    else if (!list.includes(to)) list.push(to)
  }
  for (const move of chess.moves({ verbose: true })) {
    add(move.from as Key, move.to as Key)
    if (move.isKingsideCastle()) add(move.from as Key, `h${move.from[1]}` as Key)
    if (move.isQueensideCastle()) add(move.from as Key, `a${move.from[1]}` as Key)
  }
  return dests
}

/** Maps a king dropped onto its own rook to the castling move chess.js expects (e1h1 → e1g1). */
export function normalizeCastle(fen: string, orig: Key, dest: Key): Key {
  const board = new Chess(fen)
  const king = board.get(orig as Square)
  const rook = board.get(dest as Square)
  if (
    king?.type !== 'k' ||
    rook?.type !== 'r' ||
    rook.color !== king.color ||
    orig[0] !== 'e' ||
    orig[1] !== dest[1]
  ) {
    return dest
  }
  if (dest[0] === 'h') return `g${dest[1]}` as Key
  if (dest[0] === 'a') return `c${dest[1]}` as Key
  return dest
}

/** True when moving from `orig` to `dest` is a pawn promotion. */
export function isPromotion(fen: string, orig: Key, dest: Key): boolean {
  return new Chess(fen)
    .moves({ square: orig as Square, verbose: true })
    .some((m) => m.to === dest && m.isPromotion())
}

/** Side to move, as a chessground color. */
export function turnColor(fen: string): Color {
  return fen.split(' ')[1] === 'b' ? 'black' : 'white'
}

/** True when the side to move is in check. */
export function inCheck(fen: string): boolean {
  return new Chess(fen).inCheck()
}
