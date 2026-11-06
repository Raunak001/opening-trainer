import { Chess } from 'chess.js'
import type { ExplorerClient, ExplorerQuery, ExplorerResponse } from '../explorer'
import { positionKey } from '../positionKey'

// Test helpers: a fake Lichess explorer defined by SAN paths. Not a test file itself.

export type Row = [san: string, white: number, draws: number, black: number]

/** Fake explorer data: SAN path from the start (space-separated) → listed moves. */
export function world(spec: Record<string, Row[]>): Map<string, ExplorerResponse> {
  const map = new Map<string, ExplorerResponse>()
  for (const [path, rows] of Object.entries(spec)) {
    const chess = new Chess()
    for (const san of path.split(' ').filter(Boolean)) chess.move(san)
    const moves = rows.map(([san, white, draws, black]) => ({
      uci: new Chess(chess.fen()).move(san).lan,
      san,
      white,
      draws,
      black,
      averageRating: 1700,
      opening: null,
    }))
    const sum = (k: 'white' | 'draws' | 'black') => moves.reduce((s, m) => s + m[k], 0)
    map.set(positionKey(chess.fen()), {
      white: sum('white'),
      draws: sum('draws'),
      black: sum('black'),
      moves,
      opening: null,
    })
  }
  return map
}

export const EMPTY: ExplorerResponse = { white: 0, draws: 0, black: 0, moves: [], opening: null }

/** In-memory client over a fake world, counting lookups per position. */
export function fakeClient(data: Map<string, ExplorerResponse>) {
  const calls: string[] = []
  const queries: ExplorerQuery[] = []
  const client: ExplorerClient = {
    get: async (query) => {
      const key = positionKey(query.fen)
      calls.push(key)
      queries.push(query)
      return data.get(key) ?? EMPTY
    },
  }
  return { client, calls, queries }
}

/** Position key after a space-separated SAN line from the start. */
export function keyAfter(line: string): string {
  const chess = new Chess()
  for (const san of line.split(' ').filter(Boolean)) chess.move(san)
  return positionKey(chess.fen())
}
