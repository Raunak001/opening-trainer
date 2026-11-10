import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { createEmptyCard, fsrs, Rating } from 'ts-fsrs'
import { afterEach, describe, expect, it } from 'vitest'
import { buildRepertoire, loadRepertoire, saveRepertoire } from '../../repertoire'
import { DEFAULT_PRUNE_SETTINGS } from '../../repertoire'
import { fakeClient, keyAfter, world } from '../../repertoire/__tests__/fakeWorld'
import { nodeId, TrainerDB, type CardRow } from '../db'
import { DEFAULT_SETTINGS, getSettings, mergeSettings, updateSettings } from '../settings'

const names: string[] = []
const dbName = () => {
  const name = `db-test-${names.length}`
  names.push(name)
  return name
}

afterEach(async () => {
  for (const name of names.splice(0)) await Dexie.delete(name)
})

const WORLD = world({
  '': [['e4', 60, 10, 30]],
  e4: [
    ['e5', 30, 10, 20],
    ['c5', 15, 5, 10],
  ],
  'e4 e5': [['Nf3', 60, 0, 40]],
  'e4 c5': [['Nf3', 50, 0, 50]],
})

async function sampleTree() {
  const { tree } = await buildRepertoire({
    color: 'white',
    startMoves: ['e4'],
    speeds: ['blitz'],
    ratings: [1600],
    settings: { ...DEFAULT_PRUNE_SETTINGS, maxPly: 3 },
    client: fakeClient(WORLD).client,
  })
  return tree
}

/** The v1 and v2 schemas exactly as earlier versions of the app declared them. */
function openV2(name: string) {
  const v2 = new Dexie(name)
  v2.version(1).stores({ explorerCache: 'key, positionKey' })
  v2.version(2).stores({ repertoires: 'id, name, updatedAt' })
  return v2
}

describe('schema', () => {
  it('has every table from the plan, with cards indexed on due', async () => {
    const db = new TrainerDB(dbName())
    await db.open()
    expect(db.verno).toBe(7)
    expect(db.tables.map((t) => t.name).sort()).toEqual(
      [
        'archives',
        'cards',
        'games',
        'evalCache',
        'explorerCache',
        'nodes',
        'puzzleAttempts',
        'puzzles',
        'analyses',
        'coordRuns',
        'coordStats',
        'repertoires',
        'reviewLogs',
        'settings',
      ].sort(),
    )
    expect(db.cards.schema.idxByName.due).toBeDefined()
    expect(db.cards.schema.idxByName['[repertoireId+due]']).toBeDefined()
    expect(db.nodes.schema.idxByName.repertoireId).toBeDefined()
    db.close()
  })
})

describe('migrations', () => {
  it('upgrades v1 to v6 keeping the explorer cache', async () => {
    const name = dbName()
    const v1 = new Dexie(name)
    v1.version(1).stores({ explorerCache: 'key, positionKey' })
    await v1.table('explorerCache').put({
      key: 'k',
      positionKey: 'p',
      params: '',
      response: { white: 1 },
      fetchedAt: 1,
    })
    v1.close()

    const db = new TrainerDB(name)
    expect(await db.explorerCache.get('k')).toMatchObject({ positionKey: 'p', fetchedAt: 1 })
    expect(db.verno).toBe(7)
    db.close()
  })

  it('upgrades v3 to v4 keeping cards and adding the game tables', async () => {
    const name = dbName()
    const v3 = new Dexie(name)
    v3.version(3).stores({
      explorerCache: 'key, positionKey',
      repertoires: 'id, name, updatedAt',
      nodes: 'id, repertoireId',
      cards: 'id, repertoireId, due, [repertoireId+due]',
      reviewLogs: '++id, cardId, repertoireId, review',
      settings: 'id',
      evalCache: 'key, positionKey',
    })
    await v3
      .table('cards')
      .put({ id: 'r:k', repertoireId: 'r', positionKey: 'k', due: new Date(1) })
    v3.close()

    const db = new TrainerDB(name)
    expect(await db.cards.get('r:k')).toMatchObject({ positionKey: 'k' })
    expect(await db.games.count()).toBe(0)
    expect(db.games.schema.idxByName.endTime).toBeDefined()
    db.close()
  })

  it('upgrades v4 to v6 keeping games and adding the puzzle and review tables', async () => {
    const name = dbName()
    const v4 = new Dexie(name)
    v4.version(4).stores({
      explorerCache: 'key, positionKey',
      repertoires: 'id, name, updatedAt',
      nodes: 'id, repertoireId',
      cards: 'id, repertoireId, due, [repertoireId+due]',
      reviewLogs: '++id, cardId, repertoireId, review',
      settings: 'id',
      evalCache: 'key, positionKey',
      archives: 'id, username',
      games: 'id, username, endTime, archiveId',
    })
    await v4.table('games').put({ id: 'g1', username: 'me', endTime: 1, archiveId: 'a' })
    await v4
      .table('cards')
      .put({ id: 'r:k', repertoireId: 'r', positionKey: 'k', due: new Date(1) })
    v4.close()

    const db = new TrainerDB(name)
    expect(await db.games.get('g1')).toMatchObject({ username: 'me' })
    expect(await db.cards.get('r:k')).toMatchObject({ positionKey: 'k' })
    expect(await db.puzzles.count()).toBe(0)
    expect(await db.puzzleAttempts.count()).toBe(0)
    expect(db.puzzles.schema.idxByName.rating).toBeDefined()
    expect(db.puzzleAttempts.schema.idxByName.at).toBeDefined()
    expect(await db.analyses.count()).toBe(0)
    expect(await db.coordStats.count()).toBe(0)
    expect(await db.coordRuns.count()).toBe(0)
    expect(db.coordStats.schema.idxByName.mode).toBeDefined()
    expect(db.verno).toBe(7)
    db.close()
  })

  it('upgrades v2 to v3 moving each inline tree into nodes', async () => {
    const name = dbName()
    const tree = await sampleTree()
    const v2 = openV2(name)
    const v2Row = {
      id: 'rep-1',
      name: 'Old 1.e4',
      color: 'white',
      startMoves: ['e4'],
      speeds: ['blitz'],
      ratings: [1600],
      settings: DEFAULT_PRUNE_SETTINGS,
      overrides: { [keyAfter('e4 e5')]: 'Nf3' },
      tree,
      createdAt: 10,
      updatedAt: 20,
    }
    await v2.table('repertoires').put(v2Row)
    await v2.table('repertoires').put({ ...v2Row, id: 'rep-2', name: 'Second' })
    await v2.table('explorerCache').put({ key: 'k', positionKey: 'p', params: '', fetchedAt: 1 })
    v2.close()

    const db = new TrainerDB(name)
    const row = await db.repertoires.get('rep-1')
    expect(row).not.toHaveProperty('tree')
    expect(row).toMatchObject({
      name: 'Old 1.e4',
      rootKey: tree.rootKey,
      positionCount: Object.keys(tree.nodes).length,
      overrides: { [keyAfter('e4 e5')]: 'Nf3' },
      createdAt: 10,
      updatedAt: 20,
    })
    expect(await db.nodes.where('repertoireId').equals('rep-1').count()).toBe(
      Object.keys(tree.nodes).length,
    )
    expect(await db.nodes.get(nodeId('rep-1', keyAfter('e4 e5')))).toMatchObject({
      repertoireId: 'rep-1',
      key: keyAfter('e4 e5'),
      ply: 2,
    })
    // The reassembled tree is exactly the old inline one.
    expect((await loadRepertoire(db, 'rep-1'))?.tree).toEqual(tree)
    expect((await loadRepertoire(db, 'rep-2'))?.tree).toEqual(tree)
    expect(await db.explorerCache.count()).toBe(1)
    db.close()
  })
})

describe('repertoire storage', () => {
  it('replaces the node rows on rebuild without touching other repertoires', async () => {
    const db = new TrainerDB(dbName())
    const tree = await sampleTree()
    const base = {
      color: 'white' as const,
      startMoves: ['e4'],
      speeds: ['blitz' as const],
      ratings: [1600 as const],
      settings: DEFAULT_PRUNE_SETTINGS,
    }
    const a = await saveRepertoire(db, { ...base, name: 'A', tree })
    const b = await saveRepertoire(db, { ...base, name: 'B', tree })

    // Rebuild A with a smaller tree (just the start move).
    const small = {
      rootKey: tree.rootKey,
      nodes: {
        [tree.rootKey]: tree.nodes[tree.rootKey],
        [keyAfter('e4')]: { ...tree.nodes[keyAfter('e4')], edges: [] },
      },
    }
    await saveRepertoire(db, { ...base, id: a, name: 'A', tree: small })

    expect(await db.nodes.where('repertoireId').equals(a).count()).toBe(2)
    expect((await db.repertoires.get(a))?.positionCount).toBe(2)
    expect((await loadRepertoire(db, b))?.tree).toEqual(tree)
    expect(await loadRepertoire(db, 'missing')).toBeUndefined()
    db.close()
  })
})

describe('cards and review logs', () => {
  it('stores ts-fsrs cards and finds due ones through the index', async () => {
    const db = new TrainerDB(dbName())
    const now = new Date('2026-11-06T12:00:00Z')
    const card = (pos: string, due: Date): CardRow => ({
      ...createEmptyCard(due),
      id: nodeId('rep', pos),
      repertoireId: 'rep',
      positionKey: pos,
      answer: 'e4',
    })
    await db.cards.bulkPut([
      card('a', new Date('2026-11-05T00:00:00Z')),
      card('b', new Date('2026-11-06T11:59:00Z')),
      card('c', new Date('2026-11-07T00:00:00Z')),
      { ...card('d', new Date('2026-11-01T00:00:00Z')), repertoireId: 'other', id: 'other:d' },
    ])

    const due = await db.cards
      .where('[repertoireId+due]')
      .between(['rep', Dexie.minKey], ['rep', now], true, true)
      .toArray()
    expect(due.map((c) => c.positionKey)).toEqual(['a', 'b'])
    expect(due[0].due).toBeInstanceOf(Date)
    expect(await db.cards.where('due').below(now).count()).toBe(3)

    // A review round-trips through ts-fsrs and the log table.
    const { card: next, log } = fsrs().next(due[0], now, Rating.Good)
    await db.cards.put({ ...due[0], ...next })
    const logId = await db.reviewLogs.add({ ...log, cardId: due[0].id, repertoireId: 'rep' })
    expect((await db.cards.get(due[0].id))?.reps).toBe(1)
    expect(await db.reviewLogs.get(logId)).toMatchObject({ cardId: 'rep:a', rating: Rating.Good })
    expect(await db.reviewLogs.where('cardId').equals('rep:a').count()).toBe(1)
    db.close()
  })
})

describe('settings', () => {
  it('returns defaults until something is saved', async () => {
    const db = new TrainerDB(dbName())
    expect(await getSettings(db)).toEqual(DEFAULT_SETTINGS)
    expect(DEFAULT_SETTINGS.fsrs.requestRetention).toBe(0.9)
    db.close()
  })

  it('saves partial changes and keeps the rest at their defaults', async () => {
    const db = new TrainerDB(dbName())
    const after = await updateSettings(db, { grading: { hardAfterMs: 20_000 } })
    expect(after.grading).toEqual({ hardAfterMs: 20_000, easyUnderMs: 2_000 })
    await updateSettings(db, { daily: { reviews: 5 } })
    expect(await getSettings(db)).toEqual({
      ...DEFAULT_SETTINGS,
      grading: { hardAfterMs: 20_000, easyUnderMs: 2_000 },
      daily: { reviews: 5 },
    })
    db.close()
  })

  it('fills fields added after a row was saved', () => {
    const stored = { grading: { hardAfterMs: 9_000 } } // e.g. saved before `daily` existed
    expect(mergeSettings(DEFAULT_SETTINGS, stored)).toEqual({
      ...DEFAULT_SETTINGS,
      grading: { hardAfterMs: 9_000, easyUnderMs: 2_000 },
    })
  })
})
