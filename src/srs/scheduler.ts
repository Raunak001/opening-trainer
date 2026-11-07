import { fsrs, type FSRS, type Grade } from 'ts-fsrs'
import {
  DEFAULT_SETTINGS,
  getSettings,
  type AppSettings,
  type CardRow,
  type ReviewDetails,
  type ReviewLogRow,
  type TrainerDB,
} from '../db'
import { loadRepertoire } from '../repertoire/builder'
import { cardTargets, planCardSync, type CardSyncPlan } from './cards'

/**
 * The FSRS scheduler for the given settings. The only place ts-fsrs's
 * scheduling API is touched (it marks `fsrs()`/`next` deprecated in v6 in
 * favour of a new scheduler API; swapping happens here).
 */
export function createScheduler(settings: AppSettings = DEFAULT_SETTINGS): FSRS {
  return fsrs({ request_retention: settings.fsrs.requestRetention })
}

export interface ReviewResult {
  card: CardRow
  log: ReviewLogRow
}

/** Applies one rating to a card (pure): next FSRS state plus the log entry. */
export function applyReview(
  scheduler: FSRS,
  card: CardRow,
  rating: Grade,
  now: Date,
  details: ReviewDetails = {},
): ReviewResult {
  const { card: next, log } = scheduler.next(card, now, rating)
  return {
    card: { ...card, ...next },
    log: { ...log, ...details, cardId: card.id, repertoireId: card.repertoireId },
  }
}

export class CardNotFoundError extends Error {
  constructor(id: string) {
    super(`No card "${id}"`)
    this.name = 'CardNotFoundError'
  }
}

/** Rates a stored card: updates it and appends a review log, atomically. */
export async function reviewCard(
  db: TrainerDB,
  cardId: string,
  rating: Grade,
  now: Date = new Date(),
  details: ReviewDetails = {},
): Promise<ReviewResult> {
  return db.transaction('rw', db.cards, db.reviewLogs, db.settings, async () => {
    const card = await db.cards.get(cardId)
    if (!card) throw new CardNotFoundError(cardId)
    const result = applyReview(createScheduler(await getSettings(db)), card, rating, now, details)
    await db.cards.put(result.card)
    const id = await db.reviewLogs.add(result.log)
    return { card: result.card, log: { ...result.log, id } }
  })
}

export type CardSyncSummary = Omit<CardSyncPlan, 'add' | 'reset' | 'suspend' | 'resume'> & {
  added: number
  reset: number
  suspended: number
  resumed: number
}

/**
 * Brings a repertoire's cards in line with its current tree. Call after every
 * build or rebuild. Idempotent.
 */
export async function syncCards(
  db: TrainerDB,
  repertoireId: string,
  now: Date = new Date(),
): Promise<CardSyncSummary> {
  return db.transaction('rw', db.repertoires, db.nodes, db.cards, async () => {
    const repertoire = await loadRepertoire(db, repertoireId)
    if (!repertoire) throw new Error(`No repertoire "${repertoireId}"`)
    const existing = await db.cards.where('repertoireId').equals(repertoireId).toArray()
    const plan = planCardSync(
      repertoireId,
      cardTargets(repertoire.tree, repertoire.color),
      existing,
      now,
    )
    await db.cards.bulkPut([...plan.add, ...plan.reset, ...plan.suspend, ...plan.resume])
    return {
      added: plan.add.length,
      reset: plan.reset.length,
      suspended: plan.suspend.length,
      resumed: plan.resume.length,
      unchanged: plan.unchanged,
    }
  })
}
