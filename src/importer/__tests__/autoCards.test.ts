import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { createEmptyCard, Rating, State } from 'ts-fsrs'
import { afterEach, describe, expect, it } from 'vitest'
import { nodeId, TrainerDB, type CardRow, type GameRow } from '../../db'
import { DEFAULT_SETTINGS } from '../../db/settings'
import { buildAndSave, type Repertoire } from '../../repertoire/builder'
import { DEFAULT_PRUNE_SETTINGS } from '../../repertoire/prune'
import { fakeClient, keyAfter, world } from '../../repertoire/__tests__/fakeWorld'
import { loadDueQueue, reviewCard, syncCards } from '../../srs'
import { applyAutoCards, lostEnough, planAutoCards, type ReplyGrading } from '../autoCards'
import { matchGame, type GameMatch } from '../deviation'

const names: string[] = []
const openDb = () => {
  const name = `autocards-test-${names.length}`
  names.push(name)
  return new TrainerDB(name)
}
afterEach(async () => {
  for (const n of names.splice(0)) await Dexie.delete(n)
})

const DAY = 86_400_000
const T0 = new Date('2026-11-01T12:00:00Z')
const NOW = new Date(T0.getTime() + 2 * DAY)

// White, 1.e4: only 1…e5 is covered (2.Nf3), so 1…c5 is the opponent leaving book.
const WORLD = world({
  '': [['e4', 50, 10, 40]],
  e4: [['e5', 90, 10, 80]],
  'e4 e5': [['Nf3', 50, 10, 40]],
})

let n = 0
function gameRow(sans: string, over: Partial<GameRow> = {}): GameRow {
  return {
    id: `https://www.chess.com/game/live/${++n}`,
    username: 'me',
    archiveId: 'me/2026/11',
    endTime: T0.getTime() + DAY,
    timeClass: 'blitz',
    color: 'white',
    opponent: 'Rival',
    result: 'loss',
    pgn: '',
    sans: sans.split(' '),
    ...over,
  }
}

async function setup() {
  const db = openDb()
  const rep = await buildAndSave(db, {
    name: 'e4',
    color: 'white',
    startMoves: ['e4'],
    speeds: ['blitz'],
    ratings: [1600],
    settings: { ...DEFAULT_PRUNE_SETTINGS, maxPly: 2 },
    client: fakeClient(WORLD).client,
  })
  await syncCards(db, rep.id, T0)
  return { db, rep }
}

const matchesFor = (games: GameRow[], rep: Repertoire) =>
  new Map<string, GameMatch | undefined>(
    games.map((g) => [g.id, matchGame(g.sans, g.color, [rep])]),
  )

/** Grader stub: grades by the reply played; best move is always Nf3. */
function grader(grades: Record<string, ReplyGrading['grade']>) {
  const calls: string[] = []
  const gradeReply = async (_fen: string, reply: string): Promise<ReplyGrading> => {
    calls.push(reply)
    return { grade: grades[reply] ?? 'good', best: { san: 'Nf3' } }
  }
  return { gradeReply, calls }
}

describe('lostEnough', () => {
  it('compares grades against the minimum', () => {
    const g = (grade: ReplyGrading['grade']) => ({ grade, best: null })
    expect(lostEnough(g('mistake'), 'mistake')).toBe(true)
    expect(lostEnough(g('blunder'), 'mistake')).toBe(true)
    expect(lostEnough(g('inaccuracy'), 'mistake')).toBe(false)
    expect(lostEnough(g('inaccuracy'), 'inaccuracy')).toBe(true)
    expect(lostEnough(g('book'), 'inaccuracy')).toBe(false)
  })
})

describe('planAutoCards', () => {
  it('skips processed, old, future and filtered-out games; oldest first', async () => {
    const { rep } = await setup()
    const games = [
      gameRow('e4 e5 Bc4', { endTime: T0.getTime() + DAY }),
      gameRow('e4 e5 d4', { endTime: T0.getTime() }),
      gameRow('e4 e5 Bc4', { cards: { processedAt: 1, outcome: 'none' } }),
      gameRow('e4 e5 Bc4', { endTime: NOW.getTime() - 31 * DAY }),
      gameRow('e4 e5 Bc4', { endTime: NOW.getTime() + DAY }),
      gameRow('e4 e5 Bc4', { timeClass: 'bullet' }),
    ]
    const steps = planAutoCards(games, matchesFor(games, rep), new Map(), {
      now: NOW,
      settings: { ...DEFAULT_SETTINGS.importer, timeClasses: ['blitz'] },
    })
    expect(steps.map((s) => s.game.id)).toEqual([games[1].id, games[0].id])
    // No card in the map: nothing to fail.
    expect(steps.map((s) => s.kind)).toEqual(['none', 'none'])
  })

  it('a user deviation fails the card unless it was reviewed after the game', async () => {
    const { rep } = await setup()
    const id = nodeId(rep.id, keyAfter('e4 e5'))
    const card: CardRow = {
      ...createEmptyCard(T0),
      id,
      repertoireId: rep.id,
      positionKey: keyAfter('e4 e5'),
      answer: 'Nf3',
    }
    const game = gameRow('e4 e5 Bc4')
    const plan = (c: CardRow) =>
      planAutoCards([game], matchesFor([game], rep), new Map([[id, c]]), {
        now: NOW,
        settings: DEFAULT_SETTINGS.importer,
      })
    expect(plan(card)[0]).toMatchObject({ kind: 'fail', cardId: id })
    expect(plan({ ...card, last_review: new Date(game.endTime + 1) })[0].kind).toBe('none')
    expect(plan({ ...card, suspended: true })[0].kind).toBe('none')
  })

  it('an opponent deviation with a reply checks the position after it', async () => {
    const { rep } = await setup()
    const games = [gameRow('e4 c5 Nc3 Nc6'), gameRow('e4 c5')]
    const steps = planAutoCards(games, matchesFor(games, rep), new Map(), {
      now: NOW,
      settings: DEFAULT_SETTINGS.importer,
    })
    const check = steps.find((s) => s.game === games[0])
    expect(check).toMatchObject({ kind: 'checkReply', line: ['e4', 'c5'], reply: 'Nc3' })
    expect(check?.kind === 'checkReply' && check.fen).toMatch(/^rnbqkbnr\/pp1ppppp\/8\/2p5\/4P3/)
    // The game ended right after the opponent's move: no reply to judge.
    expect(steps.find((s) => s.game === games[1])?.kind).toBe('none')
  })
})

describe('applyAutoCards', () => {
  it('fails left-book cards and creates cards from bad replies, all due now', async () => {
    const { db, rep } = await setup()
    const games = [
      gameRow('e4 e5 Bc4 Nf6'), // user left book at 2.Bc4
      gameRow('e4 e5 d4', { endTime: T0.getTime() + DAY / 2 }), // same card, older game: fails it
      gameRow('e4 c5 Nc3 Nc6'), // opponent left book, then a mistake
      gameRow('e4 d5 exd5'), // opponent left book, good reply
      gameRow('e4 e5 Nf3 Nc6'), // in book to the end
    ]
    await db.games.bulkPut(games)
    const { gradeReply, calls } = grader({ Nc3: 'mistake' })
    const summary = await applyAutoCards(db, games, {
      now: NOW,
      gradeReply,
      matches: matchesFor(games, rep),
    })
    expect(summary).toEqual({ failed: 1, created: 1, refailed: 0, games: 5 })
    expect(calls.sort()).toEqual(['Nc3', 'exd5'])

    const failed = await db.cards.get(nodeId(rep.id, keyAfter('e4 e5')))
    expect(failed?.due).toEqual(NOW)
    expect(failed?.state).toBe(State.Learning)
    const created = await db.cards.get(nodeId(rep.id, keyAfter('e4 c5')))
    expect(created).toMatchObject({
      origin: 'game',
      answer: 'Nf3',
      line: ['e4', 'c5'],
      gameId: games[2].id,
      due: NOW,
      state: State.Learning,
    })

    const logs = await db.reviewLogs.toArray()
    expect(logs.map((l) => [l.rating, l.gameId]).sort()).toEqual(
      [
        [Rating.Again, games[1].id],
        [Rating.Again, games[2].id],
      ].sort(),
    )
    // Oldest game first: it fails the card; the newer game finds it already failed since.
    expect((await db.games.get(games[1].id))?.cards?.outcome).toBe('failed')
    expect((await db.games.get(games[0].id))?.cards?.outcome).toBe('none')
    expect((await db.games.get(games[2].id))?.cards).toMatchObject({
      outcome: 'created',
      cardId: created?.id,
    })

    // Both show up as due cards straight away.
    const queue = await loadDueQueue(db, NOW, rep.id)
    expect(queue.cards.map((c) => c.id)).toEqual(expect.arrayContaining([failed?.id, created?.id]))
  })

  it('processes each game once, and fails an existing game card again on a new game', async () => {
    const { db, rep } = await setup()
    const first = gameRow('e4 c5 Nc3')
    await db.games.put(first)
    const { gradeReply } = grader({ Nc3: 'blunder', Bc4: 'mistake' })
    const opts = (games: GameRow[], now: Date) => ({
      now,
      gradeReply,
      matches: matchesFor(games, rep),
    })
    await applyAutoCards(db, [first], opts([first], NOW))
    const again = await applyAutoCards(db, await db.games.toArray(), opts([first], NOW))
    expect(again.games).toBe(0)

    // Reviewed since, then misplayed in a newer game.
    const id = nodeId(rep.id, keyAfter('e4 c5'))
    await reviewCard(db, id, Rating.Good, new Date(NOW.getTime() + 1000))
    const later = gameRow('e4 c5 Bc4', { endTime: NOW.getTime() + DAY })
    await db.games.put(later)
    const now2 = new Date(NOW.getTime() + 2 * DAY)
    const r = await applyAutoCards(db, await db.games.toArray(), opts([first, later], now2))
    expect(r).toEqual({ failed: 0, created: 0, refailed: 1, games: 1 })
    expect((await db.cards.get(id))?.due).toEqual(now2)
  })

  it('game cards survive a card sync after a rebuild', async () => {
    const { db, rep } = await setup()
    const g = gameRow('e4 c5 Nc3')
    await db.games.put(g)
    await applyAutoCards(db, [g], {
      now: NOW,
      gradeReply: grader({ Nc3: 'mistake' }).gradeReply,
      matches: matchesFor([g], rep),
    })
    const summary = await syncCards(db, rep.id, NOW)
    expect(summary.suspended).toBe(0)
    expect((await db.cards.get(nodeId(rep.id, keyAfter('e4 c5'))))?.suspended).toBeUndefined()
  })
})
