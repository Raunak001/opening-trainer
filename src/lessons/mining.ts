// Position mining: concept positions from imported games and the Lichess explorer.
// Not React. Network goes through the (mockable, cached, sequential) explorer client.

import { Chess } from 'chess.js'
import type { GameRow } from '../db'
// Direct module imports: the repertoire index also re-exports React pages.
import { explorerQueryFor } from '../repertoire/builder'
import type { ExplorerClient, RatingBucket, Speed } from '../repertoire/explorer'
import { positionKey } from '../repertoire/positionKey'
import { START_FEN } from '../repertoire/tree'
import {
  DEFAULT_DETECT_OPTIONS,
  detectConcepts,
  developingMoves,
  occupiesCenter,
  prematureAttack,
  type ConceptHit,
  type DetectOptions,
} from './concepts'
import type { KnownConcept } from './lesson'

export type MineSource = 'games' | 'explorer'

/** A position worth a lesson: the concept moves exist there and players missed them. */
export interface MinedCandidate {
  /** `${concept}|${positionKey}` */
  id: string
  concept: KnownConcept
  fen: string
  /** Moves that carry out the concept (SAN), for the authoring tool to check. */
  moves: string[]
  source: MineSource
  /** Games that reached the position (yours, or explorer games). */
  reached: number
  /** Of those, games where a concept move was not played. */
  missed: number
  /** What was played instead, most frequent first: [SAN, games]. */
  playedInstead: [string, number][]
  /** SAN moves from the initial position to it (the first route found). */
  line: string[]
  /** Your games that missed it (games source only). */
  gameIds: string[]
}

interface Tally {
  candidate: Omit<MinedCandidate, 'playedInstead'>
  instead: Map<string, number>
}

function addHit(
  tallies: Map<string, Tally>,
  hit: ConceptHit,
  at: { fen: string; line: string[]; source: MineSource },
  counts: { reached: number; missed: number; instead: [string, number][]; gameId?: string },
) {
  const id = `${hit.concept}|${positionKey(at.fen)}`
  let tally = tallies.get(id)
  if (!tally) {
    tally = {
      candidate: {
        id,
        concept: hit.concept,
        fen: at.fen,
        moves: hit.moves,
        source: at.source,
        reached: 0,
        missed: 0,
        line: at.line,
        gameIds: [],
      },
      instead: new Map(),
    }
    tallies.set(id, tally)
  }
  tally.candidate.reached += counts.reached
  tally.candidate.missed += counts.missed
  if (counts.gameId && !tally.candidate.gameIds.includes(counts.gameId))
    tally.candidate.gameIds.push(counts.gameId)
  for (const [san, n] of counts.instead) tally.instead.set(san, (tally.instead.get(san) ?? 0) + n)
}

/** Most missed first; ties by how often the position came up, then shallowest. */
function finish(tallies: Map<string, Tally>, concepts?: readonly KnownConcept[]): MinedCandidate[] {
  return [...tallies.values()]
    .filter((t) => t.candidate.missed > 0 && (!concepts || concepts.includes(t.candidate.concept)))
    .map((t) => ({
      ...t.candidate,
      playedInstead: [...t.instead.entries()].sort(
        (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
      ),
    }))
    .sort(
      (a, b) =>
        b.missed - a.missed ||
        b.reached - a.reached ||
        a.line.length - b.line.length ||
        a.id.localeCompare(b.id),
    )
}

/** Every concept hit at one position, given the moves played there with their game counts. */
function hitsAt(
  line: readonly string[],
  fen: string,
  played: readonly { san: string; games: number }[],
  detect: Partial<DetectOptions>,
  minAttackGames = 1,
): { hit: ConceptHit; missed: number; instead: [string, number][] }[] {
  const out: { hit: ConceptHit; missed: number; instead: [string, number][] }[] = []
  for (const hit of detectConcepts(fen, detect)) {
    // Taking the center with a pawn is central play too: not a miss.
    const instead = played.filter(
      (p) =>
        !hit.moves.includes(p.san) &&
        !(hit.concept === 'strike-center' && occupiesCenter(fen, p.san)),
    )
    const missed = instead.reduce((n, p) => n + p.games, 0)
    out.push({ hit, missed, instead: instead.map((p) => [p.san, p.games]) })
  }
  // Develop-before-attacking: someone played a premature attack here.
  const maxMove = detect.maxMove ?? DEFAULT_DETECT_OPTIONS.maxMove
  if (Number(fen.split(' ')[5]) <= maxMove) {
    const attacks = played.filter((p) => prematureAttack(START_FEN, line, p.san))
    const games = attacks.reduce((n, p) => n + p.games, 0)
    if (games >= minAttackGames) {
      const moves = developingMoves(fen)
      if (moves.length > 0)
        out.push({
          hit: { concept: 'develop-before-attacking', moves },
          missed: games,
          instead: attacks.map((p) => [p.san, p.games]),
        })
    }
  }
  return out
}

export interface MineGamesOptions {
  concepts?: readonly KnownConcept[]
  /** Only look at the user's moves up to this ply. */
  maxPly?: number
  detect?: Partial<DetectOptions>
}

/**
 * Positions from the user's own games where a concept move was available and the user
 * played something else. Pure.
 */
export function mineGames(
  games: readonly GameRow[],
  options: MineGamesOptions = {},
): MinedCandidate[] {
  const maxPly = options.maxPly ?? 24
  const detect = options.detect ?? {}
  const tallies = new Map<string, Tally>()
  for (const game of games) {
    const chess = new Chess()
    const userTurn = game.color === 'white' ? 'w' : 'b'
    for (let ply = 0; ply < Math.min(maxPly, game.sans.length); ply++) {
      const san = game.sans[ply]
      if (chess.turn() === userTurn) {
        const line = game.sans.slice(0, ply)
        const fen = chess.fen()
        let played: string
        try {
          played = new Chess(fen).move(san).san
        } catch {
          break
        }
        for (const { hit, missed } of hitsAt(line, fen, [{ san: played, games: 1 }], detect)) {
          // Games that found the move count towards `reached` only.
          addHit(
            tallies,
            hit,
            { fen, line, source: 'games' },
            missed > 0
              ? { reached: 1, missed, instead: [[played, 1]], gameId: game.id }
              : { reached: 1, missed: 0, instead: [] },
          )
        }
      }
      try {
        chess.move(san)
      } catch {
        break
      }
    }
  }
  return finish(tallies, options.concepts)
}

export interface MineExplorerOptions {
  concepts?: readonly KnownConcept[]
  speeds: readonly Speed[]
  ratings: readonly RatingBucket[]
  /** SAN moves from the initial position to start the walk from. */
  startMoves?: readonly string[]
  /** Walk this many plies deep. */
  maxPly: number
  /** Follow moves played in at least this share of the position's games (0–1). */
  minShare: number
  /** Stop after this many explorer positions. */
  maxPositions: number
  /** Ignore candidates where fewer than this share of games missed the concept (0–1). */
  minMissShare: number
  detect?: Partial<DetectOptions>
  signal?: AbortSignal
  onProgress?: (progress: { positions: number; found: number }) => void
}

export const DEFAULT_MINE_EXPLORER = {
  maxPly: 12,
  minShare: 0.1,
  maxPositions: 80,
  minMissShare: 0.3,
} as const

function abortError(): DOMException {
  return new DOMException('Mining was cancelled.', 'AbortError')
}

/**
 * Breadth-first walk over popular explorer moves (most common positions first), reporting
 * positions where a concept move exists but most players at that level miss it. Requests
 * go one at a time through the client, which caches them.
 */
export async function mineExplorer(
  client: ExplorerClient,
  options: MineExplorerOptions,
): Promise<MinedCandidate[]> {
  const { signal, onProgress } = options
  const detect = options.detect ?? {}
  const tallies = new Map<string, Tally>()
  const seen = new Set<string>()
  const start = new Chess()
  for (const san of options.startMoves ?? []) start.move(san)
  const queue: { line: string[]; fen: string }[] = [{ line: start.history(), fen: start.fen() }]
  let positions = 0

  for (let next = queue.shift(); next && positions < options.maxPositions; next = queue.shift()) {
    if (signal?.aborted) throw abortError()
    const { line, fen } = next
    const key = positionKey(fen)
    if (seen.has(key)) continue
    seen.add(key)

    const response = await client.get(explorerQueryFor(options, fen), signal)
    positions++
    const total = response.white + response.draws + response.black
    if (total === 0) {
      onProgress?.({ positions, found: finish(tallies, options.concepts).length })
      continue
    }
    const played = response.moves.map((m) => ({ san: m.san, games: m.white + m.draws + m.black }))

    const minAttack = Math.max(1, Math.ceil(total * options.minShare))
    for (const { hit, missed, instead } of hitsAt(line, fen, played, detect, minAttack)) {
      // A premature attack only has to be popular (minShare), not the majority.
      if (hit.concept !== 'develop-before-attacking' && missed / total < options.minMissShare)
        continue
      addHit(tallies, hit, { fen, line, source: 'explorer' }, { reached: total, missed, instead })
    }
    onProgress?.({ positions, found: finish(tallies, options.concepts).length })

    if (line.length >= options.maxPly) continue
    for (const m of played) {
      if (m.games / total < options.minShare) continue
      const next = new Chess(fen)
      try {
        next.move(m.san)
      } catch {
        continue
      }
      queue.push({ line: [...line, m.san], fen: next.fen() })
    }
  }
  return finish(tallies, options.concepts)
}
