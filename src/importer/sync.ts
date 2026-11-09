// Sync a chess.com account's archives into IndexedDB.

import type { ArchiveRow, GameRow, TrainerDB } from '../db'
import type { ChesscomClient } from './chesscom'
import { toGameRow } from './games'

/** Months are only treated as final this long after they end (late-filed daily games). */
export const ARCHIVE_GRACE_MS = 24 * 60 * 60 * 1000

export function archiveId(username: string, month: string): string {
  return `${username.toLowerCase()}/${month}`
}

/** Start of the UTC month after `YYYY/MM`, in ms. */
export function monthEnd(month: string): number {
  const [y, m] = month.split('/').map(Number)
  return Date.UTC(y, m, 1) // Date.UTC months are 0-based, so `m` is the next month.
}

/** A month fetched at `fetchedAt` will not change any more. */
export function isMonthComplete(month: string, fetchedAt: number): boolean {
  return fetchedAt >= monthEnd(month) + ARCHIVE_GRACE_MS
}

/**
 * Months to fetch, in order: every listed month without a complete archive
 * row. Past months are fetched once; the current one every sync. Pure.
 */
export function monthsToFetch(
  listed: readonly string[],
  stored: readonly Pick<ArchiveRow, 'month' | 'complete'>[],
): string[] {
  const done = new Set(stored.filter((a) => a.complete).map((a) => a.month))
  return listed.filter((m) => !done.has(m))
}

export interface SyncProgress {
  /** Month being fetched, `YYYY/MM`. */
  month: string
  /** 1-based position among the months to fetch. */
  index: number
  total: number
}

export interface SyncResult {
  /** Months listed by chess.com. */
  months: number
  /** Months fetched this time. */
  fetched: number
  /** Games stored for the first time. */
  added: number
  /** Standard games now stored for the account. */
  games: number
}

export interface SyncOptions {
  now?: () => number
  onProgress?: (p: SyncProgress) => void
  signal?: AbortSignal
}

/**
 * Fetches the account's archive list, then each needed month one at a time,
 * storing games as each month arrives (a cancelled sync keeps what it got).
 * Games already stored keep their card-processing state.
 */
export async function syncGames(
  db: TrainerDB,
  client: ChesscomClient,
  username: string,
  { now = Date.now, onProgress, signal }: SyncOptions = {},
): Promise<SyncResult> {
  const user = username.trim().toLowerCase()
  if (!user) throw new Error('Enter a chess.com username first.')
  const listed = await client.archives(user, signal)
  const stored = await db.archives.where('username').equals(user).toArray()
  const todo = monthsToFetch(listed, stored)

  let added = 0
  for (const [i, month] of todo.entries()) {
    onProgress?.({ month, index: i + 1, total: todo.length })
    const games = await client.month(user, month, signal)
    const fetchedAt = now()
    const id = archiveId(user, month)
    const rows = games
      .map((g) => toGameRow(g, user, id))
      .filter((r): r is GameRow => r !== undefined)
    await db.transaction('rw', db.archives, db.games, async () => {
      const existing = new Map(
        (await db.games.bulkGet(rows.map((r) => r.id))).flatMap((g) => (g ? [[g.id, g]] : [])),
      )
      added += rows.filter((r) => !existing.has(r.id)).length
      await db.games.bulkPut(rows.map((r) => ({ ...r, cards: existing.get(r.id)?.cards })))
      await db.archives.put({
        id,
        username: user,
        month,
        fetchedAt,
        complete: isMonthComplete(month, fetchedAt),
        gameCount: rows.length,
      })
    })
  }

  return {
    months: listed.length,
    fetched: todo.length,
    added,
    games: await db.games.where('username').equals(user).count(),
  }
}
