import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { nodeId, TrainerDB, type GameRow } from '../../db'
import { buildAndSave, loadRepertoire, type Repertoire } from '../../repertoire/builder'
import { DEFAULT_PRUNE_SETTINGS } from '../../repertoire/prune'
import { fakeClient, keyAfter, world } from '../../repertoire/__tests__/fakeWorld'
import { syncCards } from '../../srs'
import { matchGame, type GameMatch } from '../deviation'
import { coverageGaps, extendTree, formatMoves, GapError } from '../gaps'

const names: string[] = []
const openDb = () => {
  const name = `gaps-test-${names.length}`
  names.push(name)
  return new TrainerDB(name)
}
afterEach(async () => {
  for (const n of names.splice(0)) await Dexie.delete(n)
})

// White 1.e4: only 1…e5 is kept; 1…c5 and 1…d5 are below the floor.
const DATA = world({
  '': [['e4', 50, 10, 40]],
  e4: [
    ['e5', 90, 10, 80],
    ['c5', 2, 1, 2],
    ['d5', 1, 1, 1],
  ],
  'e4 e5': [['Nf3', 50, 10, 40]],
  'e4 c5': [['Nf3', 50, 10, 40]],
})

async function setup() {
  const db = openDb()
  const explorer = fakeClient(DATA)
  const rep = await buildAndSave(db, {
    name: 'e4',
    color: 'white',
    startMoves: ['e4'],
    speeds: ['blitz'],
    ratings: [1600],
    settings: { ...DEFAULT_PRUNE_SETTINGS, maxPly: 2 },
    overrides: {},
    client: explorer.client,
  })
  await syncCards(db, rep.id)
  return { db, rep, explorer }
}

let n = 0
const gameRow = (sans: string, over: Partial<GameRow> = {}): GameRow => ({
  id: `g${++n}`,
  username: 'me',
  archiveId: 'me/2026/11',
  endTime: 1000 + n,
  timeClass: 'blitz',
  color: 'white',
  opponent: 'Rival',
  result: 'win',
  pgn: '',
  sans: sans.split(' '),
  ...over,
})

const matchesFor = (games: GameRow[], rep: Repertoire) =>
  new Map<string, GameMatch | undefined>(
    games.map((g) => [g.id, matchGame(g.sans, g.color, [rep])]),
  )

describe('coverageGaps', () => {
  it('groups opponent deviations by move, most frequent first, with the score', async () => {
    const { rep } = await setup()
    const games = [
      gameRow('e4 c5 Nf3', { result: 'loss' }),
      gameRow('e4 c5 Nc3 d6', { result: 'draw' }),
      gameRow('e4 c5 c3', { result: 'win', endTime: 9999 }),
      gameRow('e4 d5 exd5'),
      gameRow('e4 d5 Nc3'),
      gameRow('e4 Nf6 e5'), // seen once: below the minimum
      gameRow('e4 c5 Nf3', { timeClass: 'bullet' }), // filtered out
      gameRow('e4 e5 Bc4'), // the user's deviation, not a gap
    ]
    const gaps = coverageGaps(games, matchesFor(games, rep), {
      timeClasses: ['blitz'],
      minGames: 2,
    })
    expect(gaps).toEqual([
      {
        id: `${rep.id}|${keyAfter('e4')}|c5`,
        repertoireId: rep.id,
        positionKey: keyAfter('e4'),
        san: 'c5',
        line: ['e4', 'c5'],
        games: 3,
        lastPlayed: 9999,
        score: 0.5,
      },
      expect.objectContaining({ san: 'd5', games: 2, score: 1 }),
    ])
  })
})

describe('formatMoves', () => {
  it('numbers White moves', () => {
    expect(formatMoves(['e4', 'c5', 'Nf3'])).toBe('1.e4 c5 2.Nf3')
  })
})

describe('extendTree', () => {
  it('adds the reply for good, finds the answer below it and makes a card', async () => {
    const { db, rep, explorer } = await setup()
    const saved = await extendTree(
      db,
      { repertoireId: rep.id, positionKey: keyAfter('e4'), san: 'c5' },
      { client: explorer.client },
    )
    expect(saved.tree.nodes[keyAfter('e4 c5')].edges.map((e) => e.san)).toEqual(['Nf3'])
    expect((await db.repertoires.get(rep.id))?.extraMoves).toEqual({ [keyAfter('e4')]: ['c5'] })
    expect(await db.cards.get(nodeId(rep.id, keyAfter('e4 c5')))).toMatchObject({ answer: 'Nf3' })

    // Adding another keeps the first; the gap is gone for games that hit it.
    await extendTree(
      db,
      { repertoireId: rep.id, positionKey: keyAfter('e4'), san: 'd5' },
      { client: explorer.client },
    )
    const after = (await loadRepertoire(db, rep.id)) as Repertoire
    expect(after.tree.nodes[keyAfter('e4')].edges.map((e) => e.san)).toEqual(['e5', 'c5', 'd5'])
    expect(matchGame(['e4', 'c5', 'Nf3', 'd6'], 'white', [after])?.deviation.kind).toBe('endOfBook')
  })

  it('reports a position that is no longer reached', async () => {
    const { db, rep, explorer } = await setup()
    await expect(
      extendTree(
        db,
        { repertoireId: rep.id, positionKey: keyAfter('d4'), san: 'd5' },
        { client: explorer.client },
      ),
    ).rejects.toBeInstanceOf(GapError)
    await expect(
      extendTree(
        db,
        { repertoireId: 'nope', positionKey: keyAfter('e4'), san: 'c5' },
        { client: explorer.client },
      ),
    ).rejects.toThrow('That repertoire no longer exists.')
  })
})
