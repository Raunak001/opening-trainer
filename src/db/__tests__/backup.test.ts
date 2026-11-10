import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { Rating } from 'ts-fsrs'
import { afterEach, describe, expect, it } from 'vitest'
import { buildAndSave, loadRepertoire } from '../../repertoire/builder'
import { DEFAULT_PRUNE_SETTINGS } from '../../repertoire/prune'
import { fakeClient, keyAfter, world } from '../../repertoire/__tests__/fakeWorld'
import { reviewCard, syncCards } from '../../srs'
import {
  BACKUP_TABLES,
  backupCounts,
  BackupError,
  backupFileName,
  exportBackup,
  parseBackup,
  restoreBackup,
  serializeBackup,
  type Backup,
} from '../backup'
import { TrainerDB } from '../db'
import { getSettings, updateSettings } from '../settings'

const names: string[] = []
const openDb = () => {
  const name = `backup-test-${names.length}`
  names.push(name)
  return new TrainerDB(name)
}
afterEach(async () => {
  for (const n of names.splice(0)) await Dexie.delete(n)
})

const T0 = new Date('2026-11-08T10:00:00Z')

/** A database with something in every table. */
async function populated() {
  const db = openDb()
  const rep = await buildAndSave(db, {
    name: 'My 1.e4',
    color: 'white',
    startMoves: ['e4'],
    speeds: ['blitz'],
    ratings: [1600],
    settings: { ...DEFAULT_PRUNE_SETTINGS, maxPly: 2 },
    overrides: { [keyAfter('e4 e5')]: 'Nf3' },
    client: fakeClient(
      world({
        '': [['e4', 6, 1, 3]],
        e4: [['e5', 5, 1, 4]],
        'e4 e5': [['Nf3', 6, 0, 4]],
      }),
    ).client,
  })
  await syncCards(db, rep.id, T0)
  await reviewCard(db, `${rep.id}:${keyAfter('')}`, Rating.Good, T0, { durationMs: 4000 })
  await updateSettings(db, { daily: { newCards: 7 } })
  await db.explorerCache.put({
    key: 'k|speeds=blitz',
    positionKey: 'k',
    params: 'speeds=blitz',
    response: { white: 1, draws: 0, black: 0, moves: [], opening: null },
    fetchedAt: 123,
  })
  await db.evalCache.put({
    key: 'k|20',
    positionKey: 'k',
    depth: 20,
    scoreCp: 31,
    bestMove: 'e2e4',
    pv: ['e2e4', 'e7e5'],
    createdAt: 456,
  })
  await db.archives.put({
    id: 'me/2026/10',
    username: 'me',
    month: '2026/10',
    fetchedAt: 789,
    complete: true,
    gameCount: 1,
  })
  await db.games.put({
    id: 'https://www.chess.com/game/live/1',
    username: 'me',
    archiveId: 'me/2026/10',
    endTime: 1_790_000_000_000,
    timeClass: 'blitz',
    color: 'white',
    opponent: 'Rival',
    result: 'win',
    pgn: '1. e4 e5 1-0',
    sans: ['e4', 'e5'],
    cards: { processedAt: 1, outcome: 'none' },
  })
  await db.puzzleAttempts.add({
    puzzleId: '0000D',
    at: T0,
    solved: true,
    puzzleRating: 1433,
    themes: ['advantage', 'endgame'],
    ratingBefore: 1000,
    ratingAfter: 1290,
    rdAfter: 280,
    volAfter: 0.06,
    hintUsed: false,
    mistakes: 0,
    durationMs: 8000,
  })
  return { db, rep }
}

const roundTrip = async (backup: Backup, schema = 5) => parseBackup(serializeBackup(backup), schema)

describe('export and restore', () => {
  it('round-trips every table exactly, Dates included', async () => {
    const { db: source, rep } = await populated()
    const backup = await exportBackup(source, T0)
    expect(backupCounts(backup)).toEqual({
      repertoires: 1,
      nodes: 4,
      cards: 2,
      reviewLogs: 1,
      settings: 1,
      explorerCache: 1,
      evalCache: 1,
      archives: 1,
      games: 1,
      puzzleAttempts: 1,
    })

    const target = openDb()
    expect(await restoreBackup(target, await roundTrip(backup))).toEqual(backupCounts(backup))

    for (const t of BACKUP_TABLES)
      expect(await target.table(t).toArray(), t).toEqual(await source.table(t).toArray())

    const card = await target.cards.get(`${rep.id}:${keyAfter('')}`)
    expect(card?.due).toBeInstanceOf(Date)
    expect(card?.last_review).toEqual(T0)
    expect((await target.reviewLogs.toArray())[0].review).toBeInstanceOf(Date)
    // Indexes work on restored data.
    expect(await target.cards.where('due').above(T0).count()).toBe(1)
    expect((await loadRepertoire(target, rep.id))?.tree).toEqual(rep.tree)
    expect((await getSettings(target)).daily.newCards).toBe(7)
  })

  it('replaces whatever was there before', async () => {
    const { db: source } = await populated()
    const backup = await roundTrip(await exportBackup(source, T0))

    const target = openDb()
    await target.cards.put({ ...(await source.cards.toArray())[0], id: 'old:card' })
    await target.explorerCache.put({
      key: 'old',
      positionKey: 'o',
      params: '',
      response: {},
      fetchedAt: 1,
    })
    await restoreBackup(target, backup)

    expect(await target.cards.get('old:card')).toBeUndefined()
    expect(await target.explorerCache.get('old')).toBeUndefined()
    expect(await target.cards.count()).toBe(2)
  })

  it('changes nothing when a restore fails part-way', async () => {
    const { db: source } = await populated()
    const backup = await roundTrip(await exportBackup(source, T0))
    // Duplicate primary key in a later table: bulkAdd fails after earlier tables were cleared.
    backup.tables.evalCache = [backup.tables.evalCache[0], backup.tables.evalCache[0]]

    const { db: target } = await populated()
    const before = await exportBackup(target, T0)
    await expect(restoreBackup(target, backup)).rejects.toThrow()
    const after = await exportBackup(target, T0)
    expect(after.tables).toEqual(before.tables)
  })

  it('round-trips an empty database', async () => {
    const backup = await roundTrip(await exportBackup(openDb(), T0))
    expect(Object.values(backupCounts(backup)).every((n) => n === 0)).toBe(true)
    const target = openDb()
    await restoreBackup(target, backup)
    expect(await target.cards.count()).toBe(0)
  })
})

describe('serializeBackup', () => {
  it('tags dates so they parse back as Dates', async () => {
    const backup = await exportBackup(openDb(), T0)
    const text = serializeBackup(backup)
    expect(JSON.parse(text).exportedAt).toEqual({ $date: '2026-11-08T10:00:00.000Z' })
    expect((await roundTrip(backup)).exportedAt).toEqual(T0)
  })
})

describe('parseBackup rejects files it cannot restore', () => {
  const valid = async () => JSON.parse(serializeBackup(await exportBackup(openDb(), T0)))
  const reason = (text: string) => {
    try {
      parseBackup(text, 5)
      return 'accepted'
    } catch (err) {
      expect(err).toBeInstanceOf(BackupError)
      return (err as Error).message
    }
  }

  it('accepts a real backup', async () => {
    expect(reason(JSON.stringify(await valid()))).toBe('accepted')
  })

  it.each([
    ['not JSON', () => 'nope {', 'This file is not valid JSON.'],
    ['another JSON file', () => '{"hello": 1}', 'This is not an Opening Trainer backup.'],
    ['an array', () => '[]', 'This is not an Opening Trainer backup.'],
  ])('%s', (_label, text, message) => {
    expect(reason(text())).toBe(message)
  })

  it('a different format or schema version', async () => {
    expect(reason(JSON.stringify({ ...(await valid()), version: 2 }))).toBe(
      'Unsupported backup format version 2.',
    )
    expect(reason(JSON.stringify({ ...(await valid()), schemaVersion: 2 }))).toBe(
      'This backup is from database version 2; this app uses version 5.',
    )
    expect(reason(JSON.stringify({ ...(await valid()), schemaVersion: 6 }))).toBe(
      'This backup is from database version 6; this app uses version 5.',
    )
  })

  it('missing parts', async () => {
    const v = await valid()
    expect(reason(JSON.stringify({ ...v, exportedAt: '2026-11-08' }))).toBe(
      'The backup has no export date.',
    )
    const noCards = { ...v, tables: { ...v.tables } }
    delete noCards.tables.cards
    expect(reason(JSON.stringify(noCards))).toBe('The backup is missing the "cards" table.')
    const badRow = { ...v, tables: { ...v.tables, cards: [{ due: 1 }] } }
    expect(reason(JSON.stringify(badRow))).toBe('Row 1 of "cards" has no "id".')
  })

  it('restores a version 3 backup, which has no game tables', async () => {
    const { db: source } = await populated()
    const v = JSON.parse(serializeBackup(await exportBackup(source, T0)))
    v.schemaVersion = 3
    delete v.tables.archives
    delete v.tables.games
    delete v.tables.puzzleAttempts
    const backup = parseBackup(JSON.stringify(v), 5)
    expect(backup.tables.games).toEqual([])
    const target = openDb()
    const counts = await restoreBackup(target, backup)
    expect(counts.cards).toBe(2)
    expect(await target.games.count()).toBe(0)
    // A table the old schema had is still required.
    delete v.tables.cards
    expect(reason(JSON.stringify(v))).toBe('The backup is missing the "cards" table.')
  })

  it('restoreBackup refuses a schema mismatch', async () => {
    const backup = { ...(await exportBackup(openDb(), T0)), schemaVersion: 99 }
    await expect(restoreBackup(openDb(), backup)).rejects.toBeInstanceOf(BackupError)
  })
})

describe('backupFileName', () => {
  it('uses the local date', () => {
    expect(backupFileName(new Date(2026, 10, 8, 23, 30))).toBe(
      'opening-trainer-backup-2026-11-08.json',
    )
  })
})
