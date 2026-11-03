import { Chess } from 'chess.js'
import type { Color, Dests, Key } from 'chessground/types'

/** Legal destination squares for each movable piece, in chessground's format. */
export function legalDests(fen: string): Dests {
  const chess = new Chess(fen)
  const dests: Dests = new Map()
  for (const move of chess.moves({ verbose: true })) {
    const from = move.from as Key
    const list = dests.get(from)
    if (list) {
      // Promotions yield one move per piece type; keep each target square once.
      if (!list.includes(move.to as Key)) list.push(move.to as Key)
    } else {
      dests.set(from, [move.to as Key])
    }
  }
  return dests
}

/** Side to move, as a chessground color. */
export function turnColor(fen: string): Color {
  return fen.split(' ')[1] === 'b' ? 'black' : 'white'
}

/** True when the side to move is in check. */
export function inCheck(fen: string): boolean {
  return new Chess(fen).inCheck()
}
