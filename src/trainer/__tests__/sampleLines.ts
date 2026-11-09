import type { Line, Side } from '../drill'

// Test fixtures: hardcoded lines (the app's lines come from the explorer).
const moves = (san: string) => san.split(' ')

// Giuoco Piano: 1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5 4.c3 Nf6 5.d4 exd4 6.cxd4 Bb4+ 7.Bd2 Bxd2+ 8.Nbxd2 d5
const ITALIAN = moves('e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d4 exd4 cxd4 Bb4+ Bd2 Bxd2+ Nbxd2 d5')

export function italianLine(side: Side): Line {
  return { id: `italian-${side}`, name: 'Italian Game', side, moves: ITALIAN }
}

const both = (id: string, name: string, line: Omit<Line, 'id' | 'name' | 'side'>): Line[] =>
  (['white', 'black'] as const).map((side) => ({ ...line, id: `${id}-${side}`, name, side }))

/** Lines exercising castling, en passant and promotion (T1.5). */
export const SPECIAL_MOVE_LINES: Line[] = [
  // 4.O-O ... 5...O-O
  ...both('castle-short', 'Castling short', {
    moves: moves('e4 e5 Nf3 Nc6 Bc4 Bc5 O-O Nf6 d3 O-O'),
  }),
  // 5.O-O-O O-O-O
  ...both('castle-long', 'Castling long', {
    moves: moves('d4 d5 Nc3 Nc6 Bf4 Bf5 Qd2 Qd7 O-O-O O-O-O'),
  }),
  // Alekhine's Defence: 3.exd6 e.p.
  {
    id: 'ep-white',
    name: 'En passant',
    side: 'white',
    moves: moves('e4 Nf6 e5 d5 exd6'),
  },
  // 4...dxc3 e.p.
  {
    id: 'ep-black',
    name: 'En passant',
    side: 'black',
    moves: moves('Nc3 d5 e4 d4 Nce2 e5 c4 dxc3'),
  },
  // White queens with check; Black underpromotes to a knight with check.
  ...both('promotion', 'Promotion', {
    startFen: '4k3/P7/8/8/8/8/7p/4K3 w - - 0 1',
    moves: moves('a8=Q+ Kd7 Kf2 h1=N+'),
  }),
]

export const SAMPLE_LINES: Line[] = [
  italianLine('white'),
  italianLine('black'),
  ...SPECIAL_MOVE_LINES,
]
