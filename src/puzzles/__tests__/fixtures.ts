import type { Puzzle } from '../solution'

/** Real puzzles from the Lichess puzzle database (CC0). */

/** Mate in 1 for White after 18…Nc5: Qh7#. */
export const MATE_IN_1: Puzzle = {
  id: '1hk5P',
  fen: 'r1bq1rk1/1p1nbppp/4p3/p3P3/4Q3/PP1B1N2/1B3PPP/R3R1K1 b - - 2 18',
  moves: ['d7c5', 'e4h7'],
  rating: 500,
  themes: ['kingsideAttack', 'mate', 'mateIn1', 'middlegame', 'oneMove'],
}

/** Mate in 2 for White: Qxf7+ Kh8, Qe8#, where Qf8# and Qg8# also mate. */
export const MATE_IN_2: Puzzle = {
  id: '0boOL',
  fen: 'r1b3k1/ppp2ppp/8/b7/3n2P1/1B1Pr1B1/PP6/R2K1Q2 b - - 14 24',
  moves: ['e3g3', 'f1f7', 'g8h8', 'f7e8'],
  rating: 507,
  themes: ['mate', 'mateIn2', 'short'],
}

/** Promotion: g7+ Ke8, g8=Q# (g8=R# also mates). */
export const PROMOTION: Puzzle = {
  id: '22PsY',
  fen: '5k2/8/1r2BKP1/8/5P2/8/1p6/8 b - - 0 61',
  moves: ['b2b1q', 'g6g7', 'f8e8', 'g7g8q'],
  rating: 522,
  themes: ['advancedPawn', 'deflection', 'endgame', 'mate', 'mateIn2', 'promotion', 'short'],
}

/** Not a mate: Black wins material (Black to play after White's setup move). */
export const MATERIAL: Puzzle = {
  id: '0000D',
  fen: '5rk1/1p3ppp/pq3b2/8/8/1P1Q1N2/P4PPP/3R2K1 w - - 2 27',
  moves: ['d3d6', 'f8d8', 'd6d8', 'f6d8'],
  rating: 1433,
  themes: ['advantage', 'endgame', 'short'],
}
