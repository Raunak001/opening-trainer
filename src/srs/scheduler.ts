import { fsrs, State, type FSRS, type Grade } from 'ts-fsrs'
import {
  DEFAULT_SETTINGS,
  getSettings,
  type AppSettings,
  type CardRow,
  type ReviewDetails,
  type ReviewLogRow,
  type TrainerDB,
} from '../db'
import { listRepertoires, loadRepertoire } from '../repertoire/builder'
import { cardTargets, planCardSync, type CardSyncPlan } from './cards'
import {
  lineProgress,
  overallMastery,
  studyStreak,
  todayCounts,
  type LineProgress,
  type Streak,
  type TodayCounts,
} from './progress'
import { buildDueQueue, dailyUsage, startOfDay, type DueQueue } from './queue'

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

/**
 * Today's due queue from the database. Pass a repertoire id to study one
 * repertoire, or omit it for all. Daily caps are app-wide: reviews done in
 * any repertoire today count against them.
 */
export async function loadDueQueue(
  db: TrainerDB,
  now: Date = new Date(),
  repertoireId?: string,
): Promise<DueQueue> {
  return db.transaction('r', db.cards, db.reviewLogs, db.nodes, db.settings, async () => {
    const cards = repertoireId
      ? await db.cards.where('repertoireId').equals(repertoireId).toArray()
      : await db.cards.toArray()
    const logs = await db.reviewLogs
      .where('review')
      .between(startOfDay(now), now, true, true)
      .toArray()
    const nodes = repertoireId
      ? await db.nodes.where('repertoireId').equals(repertoireId).toArray()
      : await db.nodes.toArray()
    // New cards are learned shallowest first, so lines build from the first move.
    const newRank = new Map<string, number>()
    for (const n of nodes) newRank.set(n.key, Math.min(newRank.get(n.key) ?? Infinity, n.ply))
    const settings = await getSettings(db)
    return buildDueQueue(cards, now, {
      limits: settings.daily,
      usage: dailyUsage(logs, now),
      newRank,
    })
  })
}

export interface RepertoireProgress {
  id: string
  name: string
  color: 'white' | 'black'
  cards: number
  studied: number
  /** Mean card mastery, 0–1. */
  mastery: number
  /** Weakest first. */
  lines: LineProgress[]
}

export interface Progress {
  today: TodayCounts
  streak: Streak
  /** Mean card mastery over all repertoires, 0–1. */
  mastery: number
  masteredAfterDays: number
  repertoires: RepertoireProgress[]
}

/** Everything the progress view shows, read in one transaction. */
export async function loadProgress(db: TrainerDB, now: Date = new Date()): Promise<Progress> {
  return db.transaction(
    'r',
    [db.cards, db.reviewLogs, db.repertoires, db.nodes, db.settings],
    async () => {
      const settings = await getSettings(db)
      const days = settings.progress.masteredAfterDays
      const cards = await db.cards.toArray()
      const todayLogs = await db.reviewLogs
        .where('review')
        .between(startOfDay(now), now, true, true)
        .toArray()
      const reviewTimes = (await db.reviewLogs.orderBy('review').keys()) as Date[]

      const repertoires: RepertoireProgress[] = []
      for (const row of await listRepertoires(db)) {
        const rep = await loadRepertoire(db, row.id)
        if (!rep) continue
        const own = cards.filter((c) => c.repertoireId === row.id && !c.suspended)
        repertoires.push({
          id: row.id,
          name: row.name,
          color: row.color,
          cards: own.length,
          studied: own.filter((c) => c.state !== State.New).length,
          mastery: overallMastery(own, days),
          lines: lineProgress(rep.tree, own, days),
        })
      }

      return {
        today: todayCounts(cards, now, settings.daily, dailyUsage(todayLogs, now)),
        streak: studyStreak(reviewTimes, now),
        mastery: overallMastery(cards, days),
        masteredAfterDays: days,
        repertoires,
      }
    },
  )
}
