import type { Line, Side } from './drill'

// Hardcoded until the repertoire builder (Phase 2) generates lines.
// Giuoco Piano: 1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5 4.c3 Nf6 5.d4 exd4 6.cxd4 Bb4+ 7.Bd2 Bxd2+ 8.Nbxd2 d5
const ITALIAN_MOVES = 'e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d4 exd4 cxd4 Bb4+ Bd2 Bxd2+ Nbxd2 d5'.split(' ')

export function italianLine(side: Side): Line {
  return { id: `italian-${side}`, name: 'Italian Game', side, moves: ITALIAN_MOVES }
}
