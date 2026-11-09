import { Chess } from 'chess.js'

/** One numbered row of a move list: White's move and Black's reply. */
export interface MoveRow {
  /** Full-move number. */
  number: number
  /** Index into the SAN list, or undefined when the row starts with Black ("12…"). */
  white?: { san: string; ply: number }
  black?: { san: string; ply: number }
}

/** Full-move number and side to move from a FEN (defaults: 1, White). */
function fenStart(fen: string | undefined): { number: number; blackFirst: boolean } {
  if (!fen) return { number: 1, blackFirst: false }
  const fields = fen.trim().split(/\s+/)
  return { number: Number(fields[5]) || 1, blackFirst: fields[1] === 'b' }
}

/**
 * Groups SAN moves into numbered rows, starting from `startFen`'s move number
 * and side to move. `ply` is the move's index in `sans`.
 */
export function moveRows(sans: readonly string[], startFen?: string): MoveRow[] {
  const { number, blackFirst } = fenStart(startFen)
  const rows: MoveRow[] = []
  let row: MoveRow | undefined
  sans.forEach((san, ply) => {
    const black = (ply + (blackFirst ? 1 : 0)) % 2 === 1
    if (!black || !row) {
      row = { number: number + Math.floor((ply + (blackFirst ? 1 : 0)) / 2) }
      rows.push(row)
    }
    if (black) row.black = { san, ply }
    else row.white = { san, ply }
  })
  return rows
}

/** FEN after each move of a line: index 0 is the start, index i after `sans[i - 1]`. */
export function fensAlong(sans: readonly string[], startFen?: string): string[] {
  const chess = startFen ? new Chess(startFen) : new Chess()
  const fens = [chess.fen()]
  for (const san of sans) {
    chess.move(san)
    fens.push(chess.fen())
  }
  return fens
}
