// Cards from imported games: positions the user misplayed come back due now.

import { Chess } from 'chess.js'
import { createEmptyCard, Rating } from 'ts-fsrs'
import {
  getSettings,
  nodeId,
  type AppSettings,
  type CardRow,
  type GameRow,
  type TrainerDB,
} from '../db'
import { dexieEvalCache, getSharedEngine, gradeMove } from '../engine'
import { positionKey } from '../repertoire/positionKey'
import { reviewCard } from '../srs/scheduler'
import type { GameMatch } from './deviation'
import { filterGames } from './games'

const DAY_MS = 86_400_000

/** What to do with one game. */
export type AutoCardStep =
  /** The user left book: fail the repertoire card at that position. */
  | { kind: 'fail'; game: GameRow; cardId: string }
  /**
   * The opponent left book: grade the user's reply; if it lost enough, the
   * position after the opponent's move becomes a card answered by the engine.
   */
  | {
      kind: 'checkReply'
      game: GameRow
      repertoireId: string
      /** Position after the opponent's off-book move (user to move). */
      fen: string
      /** SAN moves from the start to `fen`. */
      line: string[]
      /** What the user played there. */
      reply: string
    }
  /** Nothing to learn from the game (stayed in book, other opening, card already reviewed since). */
  | { kind: 'none'; game: GameRow }

export interface PlanOptions {
  now: Date
  settings: AppSettings['importer']
}

/** A card the user has reviewed since the game already reflects what they know now. */
function reviewedSince(card: CardRow | undefined, game: GameRow): boolean {
  return card?.last_review !== undefined && card.last_review.getTime() > game.endTime
}

/**
 * Decides, per unprocessed game in the chosen time classes and the card window,
 * what the game means for the cards. Oldest game first. Pure.
 */
export function planAutoCards(
  games: readonly GameRow[],
  matches: ReadonlyMap<string, GameMatch | undefined>,
  cards: ReadonlyMap<string, CardRow>,
  { now, settings }: PlanOptions,
): AutoCardStep[] {
  const since = now.getTime() - settings.autoCardDays * DAY_MS
  return filterGames(games, { timeClasses: settings.timeClasses })
    .filter((g) => !g.cards && g.endTime >= since && g.endTime <= now.getTime())
    .reverse()
    .map((game): AutoCardStep => {
      const match = matches.get(game.id)
      const d = match?.deviation
      if (!match || !d) return { kind: 'none', game }
      if (d.kind === 'user') {
        const cardId = nodeId(match.repertoireId, d.positionKey)
        const card = cards.get(cardId)
        if (!card || card.suspended || reviewedSince(card, game)) return { kind: 'none', game }
        return { kind: 'fail', game, cardId }
      }
      if (d.kind === 'opponent' && d.ply + 1 < game.sans.length) {
        const chess = new Chess(d.fen)
        chess.move(game.sans[d.ply])
        return {
          kind: 'checkReply',
          game,
          repertoireId: match.repertoireId,
          fen: chess.fen(),
          line: game.sans.slice(0, d.ply + 1),
          reply: game.sans[d.ply + 1],
        }
      }
      return { kind: 'none', game }
    })
}

const GRADE_RANK = { book: 0, good: 0, inaccuracy: 1, mistake: 2, blunder: 3 } as const

/** The part of an engine grading this module needs (engine/grading.ts `MoveGrading`). */
export interface ReplyGrading {
  grade: keyof typeof GRADE_RANK
  best: { san: string } | null
}

/** Whether a graded reply is bad enough to become a card. */
export function lostEnough(
  grading: ReplyGrading,
  minGrade: AppSettings['importer']['cardMinGrade'],
): boolean {
  return GRADE_RANK[grading.grade] >= GRADE_RANK[minGrade]
}

export interface AutoCardSummary {
  /** Repertoire cards failed because the user left book. */
  failed: number
  /** New cards from positions after the opponent left book. */
  created: number
  /** Existing game cards failed again. */
  refailed: number
  /** Games checked (all outcomes). */
  games: number
}

export interface ApplyOptions {
  now?: Date
  /** Grades the user's reply (SAN) in `fen`; engine-backed in the app, stubbed in tests. */
  gradeReply: (fen: string, reply: string, signal?: AbortSignal) => Promise<ReplyGrading>
  matches: ReadonlyMap<string, GameMatch | undefined>
  onProgress?: (done: number, total: number) => void
  signal?: AbortSignal
}

/** Fails a card as of `now` and makes it due immediately. */
async function failCard(db: TrainerDB, cardId: string, now: Date, gameId: string) {
  await reviewCard(db, cardId, Rating.Again, now, { gameId })
  await db.cards.update(cardId, { due: now })
}

/**
 * Applies the plan for every unprocessed game: user deviations fail their card,
 * opponent deviations followed by a bad reply create (or fail) a game card.
 * Each game is marked processed as it is done, so a cancelled or failed run
 * resumes where it stopped and no game counts twice.
 */
export async function applyAutoCards(
  db: TrainerDB,
  games: readonly GameRow[],
  { now = new Date(), gradeReply, matches, onProgress, signal }: ApplyOptions,
): Promise<AutoCardSummary> {
  const { importer } = await getSettings(db)
  const cards = new Map((await db.cards.toArray()).map((c) => [c.id, c]))
  const steps = planAutoCards(games, matches, cards, { now, settings: importer })
  const summary: AutoCardSummary = { failed: 0, created: 0, refailed: 0, games: 0 }

  for (const [i, step] of steps.entries()) {
    if (signal?.aborted) throw new DOMException('Cancelled.', 'AbortError')
    const mark = (outcome: NonNullable<GameRow['cards']>['outcome'], cardId?: string) =>
      db.games.update(step.game.id, {
        cards: { processedAt: now.getTime(), outcome, ...(cardId ? { cardId } : {}) },
      })

    if (step.kind === 'fail') {
      // Re-read: another game in this run may have failed it already (then it counts as reviewed since).
      const card = await db.cards.get(step.cardId)
      if (card && !reviewedSince(card, step.game)) {
        await failCard(db, step.cardId, now, step.game.id)
        summary.failed++
        await mark('failed', step.cardId)
      } else await mark('none')
    } else if (step.kind === 'checkReply') {
      const grading = await gradeReply(step.fen, step.reply, signal)
      const best = grading.best
      if (!best || best.san === step.reply || !lostEnough(grading, importer.cardMinGrade)) {
        await mark('none')
      } else {
        const pk = positionKey(step.fen)
        const cardId = nodeId(step.repertoireId, pk)
        const existing = await db.cards.get(cardId)
        if (existing) {
          if (reviewedSince(existing, step.game)) {
            await mark('none')
          } else {
            await failCard(db, cardId, now, step.game.id)
            summary.refailed++
            await mark('failed', cardId)
          }
        } else {
          const card: CardRow = {
            ...createEmptyCard(now),
            id: cardId,
            repertoireId: step.repertoireId,
            positionKey: pk,
            answer: best.san,
            origin: 'game',
            line: step.line,
            gameId: step.game.id,
          }
          await db.cards.put(card)
          await failCard(db, cardId, now, step.game.id)
          summary.created++
          await mark('created', cardId)
        }
      }
    } else {
      await mark('none')
    }
    summary.games++
    onProgress?.(i + 1, steps.length)
  }
  return summary
}

/**
 * Reply grader backed by the app's Stockfish and eval cache (grading settings
 * from the db). The engine starts on the first reply that needs grading.
 */
export function engineReplyGrader(db: TrainerDB): ApplyOptions['gradeReply'] {
  const cache = dexieEvalCache(db)
  return async (fen, reply, signal) => {
    const { depth, inaccuracy, mistake, blunder } = (await getSettings(db)).moveGrading
    return gradeMove(getSharedEngine(), cache, fen, reply, {
      depth,
      thresholds: { inaccuracy, mistake, blunder },
      signal,
    })
  }
}
