// chess.com archive game → stored game row.

import { Chess } from 'chess.js'
import type { GameRow, TimeClass } from '../db'
import type { ChesscomGame } from './chesscom'

export const TIME_CLASSES: readonly TimeClass[] = ['bullet', 'blitz', 'rapid', 'daily']

const STANDARD_START = new Chess().fen()

/** chess.com result codes that mean a draw for both players. */
const DRAW_RESULTS = new Set([
  'agreed',
  'repetition',
  'stalemate',
  'insufficient',
  '50move',
  'timevsinsufficient',
])

export function resultFor(code: string): GameRow['result'] {
  if (code === 'win') return 'win'
  return DRAW_RESULTS.has(code) ? 'draw' : 'loss'
}

/**
 * SAN moves of a standard-chess PGN, or undefined if the PGN does not parse or
 * starts from a set-up position. Clock comments and other annotations are ignored.
 */
export function parsePgnMoves(pgn: string): string[] | undefined {
  const chess = new Chess()
  try {
    chess.loadPgn(pgn)
  } catch {
    return undefined
  }
  const fen = chess.getHeaders()['FEN']
  if (fen && fen !== STANDARD_START) return undefined
  return chess.history()
}

function isTimeClass(s: string): s is TimeClass {
  return (TIME_CLASSES as readonly string[]).includes(s)
}

/**
 * The row stored for one archive game, or undefined for games this app cannot
 * use: variants, set-up positions, games the user did not play, unparsable PGN.
 * Keeps the user's color (T5.2); time-class filtering happens when games are read.
 */
export function toGameRow(
  game: ChesscomGame,
  username: string,
  archiveId: string,
): GameRow | undefined {
  if (game.rules !== 'chess' || !game.pgn || !isTimeClass(game.time_class)) return undefined
  if (game.initial_setup && game.initial_setup !== STANDARD_START) return undefined
  const me = username.toLowerCase()
  const color =
    game.white.username.toLowerCase() === me
      ? 'white'
      : game.black.username.toLowerCase() === me
        ? 'black'
        : undefined
  if (!color) return undefined
  const sans = parsePgnMoves(game.pgn)
  if (!sans) return undefined
  const mine = game[color]
  const theirs = game[color === 'white' ? 'black' : 'white']
  return {
    id: game.url,
    username: me,
    archiveId,
    endTime: game.end_time * 1000,
    timeClass: game.time_class,
    color,
    opponent: theirs.username,
    opponentRating: theirs.rating,
    result: resultFor(mine.result),
    pgn: game.pgn,
    sans,
  }
}

export interface GameFilter {
  timeClasses: readonly TimeClass[]
  color?: GameRow['color']
}

/** Games in the chosen time classes (and color, if given), newest first. */
export function filterGames(games: readonly GameRow[], filter: GameFilter): GameRow[] {
  return games
    .filter(
      (g) =>
        filter.timeClasses.includes(g.timeClass) && (!filter.color || g.color === filter.color),
    )
    .sort((a, b) => b.endTime - a.endTime || a.id.localeCompare(b.id))
}
