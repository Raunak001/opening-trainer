import type { Color } from './prune'

/**
 * Broad opening families, for grouping and filters. Open: 1.e4 e5. Semi-open:
 * 1.e4 without 1…e5. Closed: 1.d4 d5. Indian: 1.d4 Nf6. Flank: anything else.
 */
export type OpeningFamily = 'open' | 'semi-open' | 'closed' | 'indian' | 'flank'

/** One opening the library offers as a course. */
export interface CatalogEntry {
  /** Stable id, used as the course id. Never rename once courses exist. */
  id: string
  /** Display name. */
  name: string
  /** The side the user learns. */
  color: Color
  /** SAN from the initial position. Lines are built from the explorer after these. */
  startMoves: string[]
  /** One or two sentences on what the opening is about. */
  blurb: string
  family: OpeningFamily
  /**
   * The Lichess openings TSV name of the position after `startMoves` (or of its
   * nearest named ancestor), when it differs from `name`.
   */
  tsvName?: string
}

/**
 * The first library (T7.1). Lines still come from the explorer (CLAUDE.md):
 * an entry only fixes where its course starts. Every entry stops on the user's
 * move, so the opponent is to move when the course begins.
 */
export const CATALOG: readonly CatalogEntry[] = [
  // White
  {
    id: 'italian',
    name: 'Italian Game',
    color: 'white',
    startMoves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'],
    blurb:
      'The bishop eyes f7 and White builds a quiet centre with c3 and d4. Easy to learn, rich to play.',
    family: 'open',
  },
  {
    id: 'ruy-lopez',
    name: 'Ruy Lopez',
    color: 'white',
    startMoves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'],
    blurb: 'Pressure on the knight that guards e5. A classical opening of slow, lasting squeeze.',
    family: 'open',
  },
  {
    id: 'scotch',
    name: 'Scotch Game',
    color: 'white',
    startMoves: ['e4', 'e5', 'Nf3', 'Nc6', 'd4'],
    blurb: 'White opens the centre at once with d4. Direct, open play with few traps to memorise.',
    family: 'open',
  },
  {
    id: 'vienna',
    name: 'Vienna Game',
    color: 'white',
    startMoves: ['e4', 'e5', 'Nc3'],
    blurb: 'Knight first, then f4 or Bc4. Flexible and full of attacking chances.',
    family: 'open',
  },
  {
    id: 'queens-gambit',
    name: "Queen's Gambit",
    color: 'white',
    startMoves: ['d4', 'd5', 'c4'],
    blurb: 'White offers the c-pawn to pull Black away from the centre. Solid and principled.',
    family: 'closed',
  },
  {
    id: 'english',
    name: 'English Opening',
    color: 'white',
    startMoves: ['c4'],
    blurb: 'Control d5 from the flank. Positional, and it often transposes to other openings.',
    family: 'flank',
  },
  // Black
  {
    id: 'open-game-black',
    name: '1…e5 for Black',
    tsvName: "King's Pawn Game",
    color: 'black',
    startMoves: ['e4', 'e5'],
    blurb:
      'Meet 1.e4 symmetrically and fight for the centre. Covers the Italian, Ruy Lopez and more from Black’s side.',
    family: 'open',
  },
  {
    id: 'sicilian',
    name: 'Sicilian Defense',
    color: 'black',
    startMoves: ['e4', 'c5'],
    blurb:
      'An unbalanced reply to 1.e4: Black trades a wing pawn for a central one. Sharp and combative.',
    family: 'semi-open',
  },
  {
    id: 'caro-kann',
    name: 'Caro-Kann Defense',
    color: 'black',
    startMoves: ['e4', 'c6'],
    blurb:
      'Prepare …d5 with c6 and keep the light-squared bishop free. Solid with a sound pawn structure.',
    family: 'semi-open',
  },
  {
    id: 'french',
    name: 'French Defense',
    color: 'black',
    startMoves: ['e4', 'e6'],
    blurb: 'Prepare …d5 with e6 and counter-attack White’s centre with …c5 and …f6.',
    family: 'semi-open',
  },
  {
    id: 'scandinavian',
    name: 'Scandinavian Defense',
    color: 'black',
    startMoves: ['e4', 'd5'],
    blurb: 'Challenge e4 on move one. Simple plans and few lines to learn.',
    family: 'semi-open',
  },
  {
    id: 'qgd',
    name: "Queen's Gambit Declined",
    color: 'black',
    startMoves: ['d4', 'd5', 'c4', 'e6'],
    blurb: 'Hold d5 with e6. One of the most solid answers to the Queen’s Gambit.',
    family: 'closed',
  },
  {
    id: 'slav',
    name: 'Slav Defense',
    color: 'black',
    startMoves: ['d4', 'd5', 'c4', 'c6'],
    blurb: 'Hold d5 with c6 and keep the c8 bishop free to develop outside the pawn chain.',
    family: 'closed',
  },
  {
    id: 'kings-indian',
    name: "King's Indian Defense",
    // The TSVs only call it the King's Indian once White commits with 3.Nc3.
    tsvName: 'Indian Defense: West Indian Defense',
    color: 'black',
    startMoves: ['d4', 'Nf6', 'c4', 'g6'],
    blurb:
      'Let White take the centre, fianchetto, then strike back with …e5 or …c5. Dynamic and double-edged.',
    family: 'indian',
  },
  {
    id: 'nimzo-indian',
    name: 'Nimzo-Indian Defense',
    color: 'black',
    startMoves: ['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4'],
    blurb: 'Pin the c3 knight to control e4. Flexible, respected at every level.',
    family: 'indian',
  },
]

export function catalogEntry(id: string): CatalogEntry | undefined {
  return CATALOG.find((e) => e.id === id)
}

/** The first move of an entry ("e4", "d4", "c4"), for filters. */
export function firstMove(entry: CatalogEntry): string {
  return entry.startMoves[0] ?? ''
}
