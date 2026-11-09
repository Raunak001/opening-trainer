import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { TrainerDB } from '../../db'
import type { ChesscomClient, ChesscomGame } from '../chesscom'
import { isMonthComplete, monthsToFetch, syncGames } from '../sync'
import { game } from './fixtures'

const names: string[] = []
const openDb = () => {
  const name = `sync-test-${names.length}`
  names.push(name)
  return new TrainerDB(name)
}
afterEach(async () => {
  for (const n of names.splice(0)) await Dexie.delete(n)
})

/** Fake chess.com: months → games; records every request. */
function fakeChesscom(months: Record<string, ChesscomGame[]>) {
  const requests: string[] = []
  const client: ChesscomClient = {
    archives: async (user) => {
      requests.push(`${user}/archives`)
      return Object.keys(months).sort()
    },
    month: async (user, month) => {
      requests.push(`${user}/${month}`)
      return months[month]
    },
  }
  return { client, requests, months }
}

const NOV_10 = Date.UTC(2026, 10, 10)

describe('isMonthComplete', () => {
  it('a month is final a day after it ends (UTC)', () => {
    expect(isMonthComplete('2026/10', Date.UTC(2026, 10, 1, 12))).toBe(false)
    expect(isMonthComplete('2026/10', Date.UTC(2026, 10, 2, 1))).toBe(true)
    expect(isMonthComplete('2026/12', Date.UTC(2027, 0, 3))).toBe(true)
    expect(isMonthComplete('2026/11', NOV_10)).toBe(false)
  })
})

describe('monthsToFetch', () => {
  it('skips complete months only', () => {
    expect(
      monthsToFetch(
        ['2026/09', '2026/10', '2026/11'],
        [
          { month: '2026/09', complete: true },
          { month: '2026/10', complete: false },
        ],
      ),
    ).toEqual(['2026/10', '2026/11'])
  })
})

describe('syncGames', () => {
  it('stores past months once and refetches only the current month', async () => {
    const db = openDb()
    const fake = fakeChesscom({
      '2026/09': [game({ moves: 'e4 e5' })],
      '2026/10': [
        game({ moves: 'd4 d5', color: 'black' }),
        game({ moves: 'e4', rules: 'chess960' }),
      ],
      '2026/11': [game({ moves: 'c4' })],
    })
    const progress: string[] = []
    const first = await syncGames(db, fake.client, 'Me', {
      now: () => NOV_10,
      onProgress: (p) => progress.push(`${p.index}/${p.total} ${p.month}`),
    })
    expect(first).toEqual({ months: 3, fetched: 3, added: 3, games: 3 })
    expect(progress).toEqual(['1/3 2026/09', '2/3 2026/10', '3/3 2026/11'])

    fake.months['2026/11'].push(game({ moves: 'Nf3' }))
    fake.requests.length = 0
    const second = await syncGames(db, fake.client, 'me', { now: () => NOV_10 + 1000 })
    expect(fake.requests).toEqual(['me/archives', 'me/2026/11'])
    expect(second).toEqual({ months: 3, fetched: 1, added: 1, games: 4 })
    expect((await db.archives.get('me/2026/11'))?.complete).toBe(false)
    expect((await db.archives.get('me/2026/10'))?.gameCount).toBe(1)
  })

  it('keeps card-processing state when a month is refetched', async () => {
    const db = openDb()
    const g = game({ moves: 'e4 e5', url: 'https://www.chess.com/game/live/1' })
    const fake = fakeChesscom({ '2026/11': [g] })
    await syncGames(db, fake.client, 'me', { now: () => NOV_10 })
    await db.games.update(g.url, { cards: { processedAt: 1, outcome: 'none' } })
    await syncGames(db, fake.client, 'me', { now: () => NOV_10 })
    expect((await db.games.get(g.url))?.cards).toEqual({ processedAt: 1, outcome: 'none' })
  })

  it('keeps months stored before a cancel', async () => {
    const db = openDb()
    const controller = new AbortController()
    const fake = fakeChesscom({ '2026/09': [game({ moves: 'e4' })], '2026/10': [] })
    fake.client.month = async (_u, month) => {
      if (month === '2026/10') {
        controller.abort()
        throw new DOMException('cancelled', 'AbortError')
      }
      return fake.months[month]
    }
    await expect(
      syncGames(db, fake.client, 'me', { now: () => NOV_10, signal: controller.signal }),
    ).rejects.toThrow('cancelled')
    expect(await db.games.count()).toBe(1)
    expect((await db.archives.get('me/2026/09'))?.complete).toBe(true)
  })

  it('needs a username', async () => {
    await expect(syncGames(openDb(), fakeChesscom({}).client, '  ')).rejects.toThrow(
      'Enter a chess.com username',
    )
  })
})
