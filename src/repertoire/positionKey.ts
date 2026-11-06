/** A FEN's first four fields: placement, side to move, castling, en passant. */
export type PositionKey = string

/**
 * Position key used for tree nodes, cards and caches. Drops the move clocks so
 * transpositions reaching the same position share one key.
 */
export function positionKey(fen: string): PositionKey {
  const fields = fen.trim().split(/\s+/)
  if (fields.length < 4) throw new Error(`Invalid FEN: "${fen}"`)
  return fields.slice(0, 4).join(' ')
}
