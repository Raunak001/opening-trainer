import type { Key, Piece, Pieces } from 'chessground/types'

/** One piece sliding from `from` to `to`. */
export interface Slide {
  from: Key
  to: Key
}

/** A piece that left the board without moving anywhere (a capture): fade it out. */
export interface Fade {
  key: Key
  piece: Piece
}

export interface AnimPlan {
  slides: Slide[]
  fades: Fade[]
}

const FILES = 'abcdefgh'

/** File and rank, 0–7, of a square. */
export function squarePos(key: Key): [number, number] {
  return [FILES.indexOf(key[0]), Number(key[1]) - 1]
}

const samePiece = (a: Piece, b: Piece) => a.role === b.role && a.color === b.color

function distanceSq(a: Key, b: Key) {
  const [ax, ay] = squarePos(a)
  const [bx, by] = squarePos(b)
  return (ax - bx) ** 2 + (ay - by) ** 2
}

/**
 * What to animate between two positions, the way chessground plans it: each piece that
 * appears on a square slides from the nearest square where the same piece disappeared;
 * pieces that disappeared with nothing to slide to fade out. Works for one move (castling
 * slides king and rook), a take-back, or a jump through several moves.
 */
export function animPlan(prev: Pieces, next: Pieces): AnimPlan {
  const appeared: [Key, Piece][] = []
  const gone: [Key, Piece][] = []
  for (const [key, piece] of next) {
    const before = prev.get(key)
    if (!before || !samePiece(before, piece)) appeared.push([key, piece])
  }
  for (const [key, piece] of prev) {
    const after = next.get(key)
    if (!after || !samePiece(after, piece)) gone.push([key, piece])
  }

  const used = new Set<Key>()
  const slides: Slide[] = []
  for (const [to, piece] of appeared) {
    let best: Key | undefined
    for (const [from, p] of gone) {
      if (used.has(from) || !samePiece(p, piece)) continue
      if (best === undefined || distanceSq(from, to) < distanceSq(best, to)) best = from
    }
    if (best !== undefined) {
      used.add(best)
      slides.push({ from: best, to })
    }
  }
  const fades = gone.filter(([key]) => !used.has(key)).map(([key, piece]) => ({ key, piece }))
  return { slides, fades }
}
