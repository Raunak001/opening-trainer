import { describe, expect, it } from 'vitest'
import { ChesscomError, createChesscomClient, monthFromArchiveUrl, type FetchFn } from '../chesscom'
import { jsonResponse } from './fixtures'

const ARCHIVES = {
  archives: [
    'https://api.chess.com/pub/player/me/games/2026/10',
    'https://api.chess.com/pub/player/me/games/2025/12',
    'https://api.chess.com/pub/player/me/games/2026/11',
  ],
}

describe('monthFromArchiveUrl', () => {
  it('reads YYYY/MM from an archive URL', () => {
    expect(monthFromArchiveUrl(ARCHIVES.archives[0])).toBe('2026/10')
    expect(monthFromArchiveUrl('https://api.chess.com/pub/player/me')).toBeUndefined()
  })
})

describe('createChesscomClient', () => {
  it('lists months oldest first, from a lowercased username', async () => {
    const urls: string[] = []
    const client = createChesscomClient({
      fetch: async (url) => {
        urls.push(url)
        return jsonResponse(200, ARCHIVES)
      },
    })
    expect(await client.archives('MeHere')).toEqual(['2025/12', '2026/10', '2026/11'])
    expect(urls).toEqual(['https://api.chess.com/pub/player/mehere/games/archives'])
  })

  it('runs requests one at a time even when called together', async () => {
    let active = 0
    let maxActive = 0
    const order: string[] = []
    const fetch: FetchFn = async (url) => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise((r) => setTimeout(r, 5))
      order.push(url.slice(-7))
      active--
      return jsonResponse(200, { games: [] })
    }
    const client = createChesscomClient({ fetch })
    await Promise.all([
      client.month('me', '2026/09'),
      client.month('me', '2026/10'),
      client.month('me', '2026/11'),
    ])
    expect(maxActive).toBe(1)
    expect(order).toEqual(['2026/09', '2026/10', '2026/11'])
  })

  it('waits the backoff after a 429, then retries', async () => {
    const statuses = [429, 429, 200]
    const slept: number[] = []
    const client = createChesscomClient({
      fetch: async () => jsonResponse(statuses.shift() as number, { games: [{ url: 'x' }] }),
      sleep: async (ms) => {
        slept.push(ms)
      },
    })
    expect(await client.month('me', '2026/11')).toHaveLength(1)
    expect(slept).toEqual([60_000, 60_000])
  })

  it('gives up after the retry limit', async () => {
    const client = createChesscomClient({
      fetch: async () => jsonResponse(429),
      sleep: async () => {},
      maxRetries: 2,
    })
    await expect(client.month('me', '2026/11')).rejects.toMatchObject({ status: 429 })
  })

  it('reports an unknown player', async () => {
    const client = createChesscomClient({ fetch: async () => jsonResponse(404) })
    await expect(client.archives('nobody')).rejects.toBeInstanceOf(ChesscomError)
    await expect(client.archives('nobody')).rejects.toThrow('No such chess.com player.')
  })

  it('a failed request does not block the queue', async () => {
    const statuses = [500, 200]
    const client = createChesscomClient({
      fetch: async () => jsonResponse(statuses.shift() as number, { games: [] }),
    })
    await expect(client.month('me', '2026/10')).rejects.toThrow('HTTP 500')
    await expect(client.month('me', '2026/11')).resolves.toEqual([])
  })
})
