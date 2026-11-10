import type { Square } from 'chess.js'

export type { Square }

/** Which side of the board is at the bottom. */
export type View = 'white' | 'black'

export const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const
export const RANKS = ['1', '2', '3', '4', '5', '6', '7', '8'] as const

/** All 64 squares, a1 … h8 (file-major within each rank). */
export const ALL_SQUARES: readonly Square[] = RANKS.flatMap((r) =>
  FILES.map((f) => `${f}${r}` as Square),
)

export function isSquare(text: string): text is Square {
  return /^[a-h][1-8]$/.test(text)
}

export function fileIndex(square: Square): number {
  return square.charCodeAt(0) - 97
}

export function rankIndex(square: Square): number {
  return Number(square[1]) - 1
}

/** a1 is dark; squares alternate from there. */
export function squareColor(square: Square): 'light' | 'dark' {
  return (fileIndex(square) + rankIndex(square)) % 2 === 0 ? 'dark' : 'light'
}

export function sameDiagonal(a: Square, b: Square): boolean {
  if (a === b) return false
  const df = Math.abs(fileIndex(a) - fileIndex(b))
  const dr = Math.abs(rankIndex(a) - rankIndex(b))
  return df === dr
}

/** Squares in display order for a view: top-left first, row by row. */
export function squaresForView(view: View): Square[] {
  const rows: Square[] = []
  for (let r = 7; r >= 0; r--)
    for (let f = 0; f < 8; f++) rows.push(`${FILES[f]}${RANKS[r]}` as Square)
  return view === 'white' ? rows : rows.reverse()
}
