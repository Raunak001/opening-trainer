import type { ExplorerResponse } from '../explorer'

export const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
export const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'

// Italian via two move orders: 1.e4 e5 2.Nf3 Nc6 3.Bc4 and 1.e4 e5 2.Bc4 Nc6 3.Nf3.
// Same position, different halfmove/fullmove clocks.
export const ITALIAN_VIA_NF3 = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3'
export const ITALIAN_VIA_BC4 = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 5 4'

/** Trimmed real-shaped explorer response for the start position. */
export const START_RESPONSE: ExplorerResponse = {
  white: 1_200_000,
  draws: 110_000,
  black: 1_100_000,
  moves: [
    {
      uci: 'e2e4',
      san: 'e4',
      white: 620_000,
      draws: 52_000,
      black: 580_000,
      averageRating: 1702,
      opening: null,
    },
    {
      uci: 'd2d4',
      san: 'd4',
      white: 380_000,
      draws: 36_000,
      black: 340_000,
      averageRating: 1715,
      opening: null,
    },
  ],
  opening: null,
}

export const AFTER_E4_RESPONSE: ExplorerResponse = {
  white: 620_000,
  draws: 52_000,
  black: 580_000,
  moves: [
    {
      uci: 'e7e5',
      san: 'e5',
      white: 260_000,
      draws: 22_000,
      black: 230_000,
      averageRating: 1698,
      opening: { eco: 'C20', name: "King's Pawn Game" },
    },
  ],
  opening: { eco: 'B00', name: "King's Pawn" },
}
