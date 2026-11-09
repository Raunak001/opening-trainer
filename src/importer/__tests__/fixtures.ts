import type { ChesscomGame } from '../chesscom'

// Test helpers: chess.com-shaped games. Not a test file itself.

/** A chess.com PGN with its usual headers and clock comments. */
export function chesscomPgn(moves: string, white = 'me', black = 'rival', result = '1-0'): string {
  const tokens = moves.split(' ').filter(Boolean)
  const body = tokens
    .map((san, i) => {
      const n = Math.floor(i / 2) + 1
      const clk = `{[%clk 0:0${4 - (i % 3)}:5${i % 10}.${i % 7}]}`
      return i % 2 === 0 ? `${n}. ${san} ${clk}` : `${n}... ${san} ${clk}`
    })
    .join(' ')
  return [
    '[Event "Live Chess"]',
    '[Site "Chess.com"]',
    '[Date "2026.11.01"]',
    '[Round "-"]',
    `[White "${white}"]`,
    `[Black "${black}"]`,
    `[Result "${result}"]`,
    '[CurrentPosition "irrelevant"]',
    '[TimeControl "300"]',
    '[Termination "me won by resignation"]',
    '',
    `${body} ${result}`,
    '',
  ].join('\n')
}

let n = 0

export interface GameSpec {
  moves: string
  color?: 'white' | 'black'
  timeClass?: string
  /** Seconds since epoch. */
  end?: number
  result?: 'win' | 'loss' | 'draw'
  rules?: string
  url?: string
  me?: string
}

/** One archive game. The user is `me` unless overridden. */
export function game(spec: GameSpec): ChesscomGame {
  const me = spec.me ?? 'Me'
  const color = spec.color ?? 'white'
  const mine = spec.result === 'loss' ? 'resigned' : spec.result === 'draw' ? 'agreed' : 'win'
  const theirs = spec.result === 'loss' ? 'win' : spec.result === 'draw' ? 'agreed' : 'resigned'
  const white = color === 'white' ? me : 'Rival'
  const black = color === 'white' ? 'Rival' : me
  return {
    url: spec.url ?? `https://www.chess.com/game/live/${++n}`,
    pgn: chesscomPgn(spec.moves, white, black),
    time_class: spec.timeClass ?? 'blitz',
    rules: spec.rules ?? 'chess',
    end_time: spec.end ?? 1_793_000_000,
    initial_setup: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    white: { username: white, rating: 1700, result: color === 'white' ? mine : theirs },
    black: { username: black, rating: 1650, result: color === 'black' ? mine : theirs },
  }
}

/** A Response-like object for a fake fetch. */
export function jsonResponse(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
