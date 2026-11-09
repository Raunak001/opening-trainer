import { describe, expect, it } from 'vitest'
import type { GameRow } from '../../db'
import { fakeClient, keyAfter, world } from '../../repertoire/__tests__/fakeWorld'
import { DEFAULT_MINE_EXPLORER, mineExplorer, mineGames } from '../mining'
import { fenAfter } from './fixtures'

function gameRow(id: string, moves: string, color: GameRow['color'] = 'white'): GameRow {
  return {
    id: `https://www.chess.com/game/live/${id}`,
    username: 'me',
    archiveId: 'me/2026/11',
    endTime: Date.UTC(2026, 10, 1),
    timeClass: 'blitz',
    color,
    opponent: 'Rival',
    result: 'win',
    pgn: '',
    sans: moves.split(' '),
  }
}

describe('mineGames', () => {
  it('finds concept moves the user missed, tallied over games', () => {
    const games = [
      gameRow('1', 'e4 e5 Qh5 Nc6 Bc4 g6'),
      gameRow('2', 'e4 e5 Qh5 Nf6 Qxe5+'),
      gameRow('3', 'e4 e5 d4 exd4'),
    ]
    const found = mineGames(games, {
      concepts: ['strike-center', 'develop-before-attacking'],
      detect: { strikeFromMove: 1 },
    })

    const strike = found.find((c) => c.concept === 'strike-center' && c.line.join(' ') === 'e4 e5')
    expect(strike).toMatchObject({
      fen: fenAfter('e4 e5'),
      source: 'games',
      reached: 3,
      missed: 2, // game 3 found d4
      playedInstead: [['Qh5', 2]],
      gameIds: [games[0].id, games[1].id],
    })
    expect(strike?.moves.sort()).toEqual(['d4', 'f4'])

    const develop = found.find((c) => c.concept === 'develop-before-attacking')
    expect(develop).toMatchObject({ line: ['e4', 'e5'], reached: 2, missed: 2 })
    expect(develop?.moves).toContain('Nf3')
    expect(found.every((c) => c.concept !== 'castle-early')).toBe(true)
  })

  it("only judges the user's own moves", () => {
    // As Black: 2.Qh5 is the opponent's early queen, and 2...Nc6 missed the chance to hit it.
    const found = mineGames([gameRow('1', 'e4 e5 Qh5 Nc6', 'black')])
    expect(found.map((c) => [c.concept, c.line.join(' ')])).toEqual([
      ['punish-early-queen', 'e4 e5 Qh5'],
    ])
  })

  it('does not count taking the center as missing a strike', () => {
    const found = mineGames([gameRow('1', 'e4 e5', 'black')], { detect: { strikeFromMove: 1 } })
    expect(found).toEqual([])
  })

  it('stops at maxPly and skips games it cannot replay', () => {
    expect(mineGames([gameRow('1', 'e4 e5 Qh5')], { maxPly: 2 })).toEqual([])
    expect(mineGames([gameRow('1', 'e4 e5 Qh9')])).toEqual([])
  })

  it('ranks the most missed positions first', () => {
    const found = mineGames(
      [gameRow('1', 'e4 e5 Qh5'), gameRow('2', 'e4 e5 Qh5'), gameRow('3', 'd4 d5 Bf4 c5 h4')],
      { concepts: ['strike-center'], detect: { strikeFromMove: 1 } },
    )
    expect(found.map((c) => [c.missed, c.line.join(' ')])).toEqual([
      [2, 'e4 e5'],
      [1, 'd4 d5'],
      [1, 'd4 d5 Bf4 c5'],
    ])
  })
})

// 1600 blitz-ish: after 1.e4 e5, 30% play the Wayward Queen; most players miss 2...g6/Nf6 after it.
const WORLD = world({
  '': [['e4', 50, 10, 40]],
  e4: [['e5', 50, 10, 40]],
  'e4 e5': [
    ['Nf3', 40, 5, 25],
    ['Qh5', 15, 0, 15],
    ['a3', 2, 0, 1],
  ],
  'e4 e5 Qh5': [
    ['Nc6', 20, 5, 15],
    ['g6', 5, 0, 5],
  ],
  'e4 e5 Nf3': [['Nc6', 50, 10, 40]],
})

const OPTIONS = {
  ...DEFAULT_MINE_EXPLORER,
  speeds: ['blitz'] as const,
  ratings: [1600] as const,
}

describe('mineExplorer', () => {
  it('walks popular moves breadth-first and reports missed concepts', async () => {
    const { client, calls, queries } = fakeClient(WORLD)
    const progress: number[] = []
    const found = await mineExplorer(client, {
      ...OPTIONS,
      speeds: ['blitz'],
      ratings: [1600],
      maxPly: 3,
      onProgress: (p) => progress.push(p.positions),
    })
    // a3 (3%) is under the 10% share floor; plies stop at 3.
    expect(calls).toEqual([
      keyAfter(''),
      keyAfter('e4'),
      keyAfter('e4 e5'),
      keyAfter('e4 e5 Nf3'),
      keyAfter('e4 e5 Qh5'),
    ])
    expect(queries[0]).toMatchObject({ speeds: ['blitz'], ratings: [1600], topGames: 0 })
    expect(progress).toEqual([1, 2, 3, 4, 5])

    const queen = found.find((c) => c.concept === 'punish-early-queen')
    expect(queen).toMatchObject({
      source: 'explorer',
      line: ['e4', 'e5', 'Qh5'],
      reached: 50,
      missed: 40,
      playedInstead: [['Nc6', 40]],
      gameIds: [],
    })
    expect(queen?.moves.sort()).toEqual(['Nf6', 'g6'])

    const develop = found.find((c) => c.concept === 'develop-before-attacking')
    expect(develop).toMatchObject({ line: ['e4', 'e5'], missed: 30, playedInstead: [['Qh5', 30]] })
  })

  it('drops positions most players get right', async () => {
    const { client } = fakeClient(WORLD)
    const found = await mineExplorer(client, {
      ...OPTIONS,
      speeds: ['blitz'],
      ratings: [1600],
      minMissShare: 0.9,
    })
    expect(found.find((c) => c.concept === 'punish-early-queen')).toBeUndefined()
    // Premature attacks only need to be popular.
    expect(found.find((c) => c.concept === 'develop-before-attacking')).toBeDefined()
  })

  it('starts from given moves, caps positions and filters concepts', async () => {
    const { client, calls } = fakeClient(WORLD)
    const found = await mineExplorer(client, {
      ...OPTIONS,
      speeds: ['blitz'],
      ratings: [1600],
      startMoves: ['e4', 'e5'],
      maxPositions: 2,
      concepts: ['strike-center'],
      detect: { strikeFromMove: 1 },
    })
    expect(calls).toEqual([keyAfter('e4 e5'), keyAfter('e4 e5 Nf3')])
    expect(found.map((c) => [c.concept, c.line.join(' ')])).toEqual([
      ['strike-center', 'e4 e5'],
      ['strike-center', 'e4 e5 Nf3'],
    ])
  })

  it('can be cancelled', async () => {
    const { client } = fakeClient(WORLD)
    const controller = new AbortController()
    const run = mineExplorer(client, {
      ...OPTIONS,
      speeds: ['blitz'],
      ratings: [1600],
      signal: controller.signal,
      onProgress: () => controller.abort(),
    })
    await expect(run).rejects.toMatchObject({ name: 'AbortError' })
  })
})
