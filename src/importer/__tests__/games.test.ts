import { describe, expect, it } from 'vitest'
import type { GameRow } from '../../db'
import { filterGames, parsePgnMoves, resultFor, toGameRow } from '../games'
import { chesscomPgn, game } from './fixtures'

/** A real chess.com export (headers trimmed), clocks and all. */
const REAL_PGN = `[Event "Live Chess"]
[Site "Chess.com"]
[Date "2026.10.30"]
[Round "-"]
[White "me"]
[Black "rival"]
[Result "0-1"]
[ECO "C50"]
[ECOUrl "https://www.chess.com/openings/Italian-Game-Two-Knights-Defense"]
[TimeControl "180+2"]
[Termination "rival won by checkmate"]

1. e4 {[%clk 0:03:01.1]} 1... e5 {[%clk 0:03:01.5]} 2. Nf3 {[%clk 0:03:02.4]} 2... Nc6 {[%clk 0:03:02.6]} 3. Bc4 {[%clk 0:03:03.2]} 3... Nf6 {[%clk 0:03:02.9]} 4. Ng5 {[%clk 0:03:04.0]} 4... d5 {[%clk 0:03:03.6]} 5. exd5 {[%clk 0:03:04.8]} 5... Nxd5 {[%clk 0:03:04.1]} 6. Nxf7 {[%clk 0:03:05.2]} 6... Kxf7 {[%clk 0:03:05.0]} 7. Qf3+ {[%clk 0:03:06.0]} 7... Ke6 {[%clk 0:03:05.3]} 8. Nc3 {[%clk 0:03:05.9]} 8... Nb4 {[%clk 0:03:04.4]} 9. O-O {[%clk 0:03:04.5]} 9... c6 {[%clk 0:03:03.1]} 0-1
`

describe('parsePgnMoves', () => {
  it('reads SAN moves from a chess.com PGN with clock comments', () => {
    expect(parsePgnMoves(REAL_PGN)).toEqual(
      'e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Nxd5 Nxf7 Kxf7 Qf3+ Ke6 Nc3 Nb4 O-O c6'.split(' '),
    )
  })

  it('rejects set-up positions and broken PGN', () => {
    const setUp = `[SetUp "1"]\n[FEN "4k3/8/8/8/8/8/8/4K2R w K - 0 1"]\n\n1. O-O *\n`
    expect(parsePgnMoves(setUp)).toBeUndefined()
    expect(parsePgnMoves(chesscomPgn('e4 e5 Ke3'))).toBeUndefined()
  })
})

describe('resultFor', () => {
  it.each([
    ['win', 'win'],
    ['checkmated', 'loss'],
    ['timeout', 'loss'],
    ['resigned', 'loss'],
    ['abandoned', 'loss'],
    ['agreed', 'draw'],
    ['repetition', 'draw'],
    ['stalemate', 'draw'],
    ['timevsinsufficient', 'draw'],
  ])('%s → %s', (code, result) => {
    expect(resultFor(code)).toBe(result)
  })
})

describe('toGameRow', () => {
  it("keeps the user's color, result, opponent and moves", () => {
    const row = toGameRow(
      game({ moves: 'd4 Nf6 c4', color: 'black', result: 'loss', timeClass: 'rapid', end: 100 }),
      'ME',
      'me/2026/10',
    )
    expect(row).toMatchObject({
      username: 'me',
      archiveId: 'me/2026/10',
      endTime: 100_000,
      timeClass: 'rapid',
      color: 'black',
      opponent: 'Rival',
      opponentRating: 1700,
      result: 'loss',
      sans: ['d4', 'Nf6', 'c4'],
    })
  })

  it('drops variants, set-up starts, unknown time classes and games of other players', () => {
    expect(toGameRow(game({ moves: 'e4', rules: 'chess960' }), 'me', 'a')).toBeUndefined()
    expect(
      toGameRow(
        { ...game({ moves: 'e4' }), initial_setup: '8/8/8/8/8/8/8/K1k5 w - - 0 1' },
        'me',
        'a',
      ),
    ).toBeUndefined()
    expect(toGameRow(game({ moves: 'e4', timeClass: 'classical' }), 'me', 'a')).toBeUndefined()
    expect(toGameRow(game({ moves: 'e4' }), 'someone', 'a')).toBeUndefined()
    expect(toGameRow({ ...game({ moves: 'e4' }), pgn: undefined }, 'me', 'a')).toBeUndefined()
  })
})

describe('filterGames', () => {
  const row = (
    id: string,
    timeClass: GameRow['timeClass'],
    color: GameRow['color'],
    endTime: number,
  ) => ({ id, timeClass, color, endTime }) as GameRow
  const games = [
    row('a', 'blitz', 'white', 1),
    row('b', 'bullet', 'white', 3),
    row('c', 'rapid', 'black', 2),
    row('d', 'blitz', 'black', 4),
  ]

  it('keeps the chosen time classes, newest first', () => {
    expect(filterGames(games, { timeClasses: ['blitz', 'rapid'] }).map((g) => g.id)).toEqual([
      'd',
      'c',
      'a',
    ])
  })

  it("optionally keeps one of the user's colors", () => {
    expect(
      filterGames(games, { timeClasses: ['blitz', 'rapid', 'bullet'], color: 'white' }).map(
        (g) => g.id,
      ),
    ).toEqual(['b', 'a'])
  })
})
