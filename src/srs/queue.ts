import { Rating, State, type Grade } from 'ts-fsrs'
import type { AppSettings, CardRow, ReviewLogRow } from '../db'

export type QueueKind = 'learning' | 'review' | 'new'

/** Start of the local day containing `now` (midnight). */
export function startOfDay(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

export function queueKind(card: CardRow): QueueKind {
  if (card.state === State.New) return 'new'
  if (card.state === State.Review) return 'review'
  return 'learning' // Learning or Relearning
}

export interface DailyUsage {
  /** Different Review-state cards reviewed today. */
  reviews: number
}

/** How much of today's caps earlier sessions used, from today's review logs. */
export function dailyUsage(logs: readonly ReviewLogRow[], now: Date): DailyUsage {
  const from = startOfDay(now).getTime()
  const reviewed = new Set<string>()
  for (const log of logs) {
    const t = log.review.getTime()
    if (t < from || t > now.getTime()) continue
    // `log.state` is the card's state before that review.
    if (log.state === State.Review) reviewed.add(log.cardId)
  }
  return { reviews: reviewed.size }
}

export interface QueueOptions {
  limits: AppSettings['daily']
  usage: DailyUsage
  /**
   * Order for new cards, lowest first (e.g. ply in the tree, so lines are
   * learned from the first move down). Missing → after ranked cards.
   */
  newRank?: ReadonlyMap<string, number>
}

export interface DueQueue {
  cards: CardRow[]
  counts: Record<QueueKind, number>
  /** Due reviews left out by today's review cap. */
  heldBack: { reviews: number }
}

const byDue = (a: CardRow, b: CardRow) =>
  a.due.getTime() - b.due.getTime() || a.id.localeCompare(b.id)

/**
 * Today's study queue (pure): due learning cards, then due reviews oldest
 * first, then new cards in rank order. Suspended cards never appear. Reviews
 * are capped by what is left of today's review limit; learning steps and new
 * cards are not capped.
 */
export function buildDueQueue(cards: readonly CardRow[], now: Date, opts: QueueOptions): DueQueue {
  const learning: CardRow[] = []
  const reviews: CardRow[] = []
  const fresh: CardRow[] = []
  for (const card of cards) {
    if (card.suspended) continue
    const kind = queueKind(card)
    if (kind === 'new') fresh.push(card)
    else if (card.due.getTime() <= now.getTime())
      (kind === 'review' ? reviews : learning).push(card)
  }

  const rank = (c: CardRow) => opts.newRank?.get(c.positionKey) ?? Number.POSITIVE_INFINITY
  fresh.sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id))
  learning.sort(byDue)
  reviews.sort(byDue)

  const reviewRoom = Math.max(0, opts.limits.reviews - opts.usage.reviews)
  const takenReviews = reviews.slice(0, reviewRoom)

  return {
    cards: [...learning, ...takenReviews, ...fresh],
    counts: { learning: learning.length, review: takenReviews.length, new: fresh.length },
    heldBack: { reviews: reviews.length - takenReviews.length },
  }
}

/** Default number of other cards before a failed card comes back. */
export const REQUEUE_GAP = 3

/** One study session over a fixed queue (pure, immutable). */
export interface Session {
  /** Card ids still to answer, in order. The head is the current card. */
  pending: string[]
  /** Latest state of every card in the session. */
  cards: Record<string, CardRow>
  /** Answers given so far, by rating. */
  answered: Record<Grade, number>
  /** Times a failed card was put back. */
  requeued: number
  requeueGap: number
}

export function createSession(queue: DueQueue, requeueGap: number = REQUEUE_GAP): Session {
  return {
    pending: queue.cards.map((c) => c.id),
    cards: Object.fromEntries(queue.cards.map((c) => [c.id, c])),
    answered: { [Rating.Again]: 0, [Rating.Hard]: 0, [Rating.Good]: 0, [Rating.Easy]: 0 },
    requeued: 0,
    requeueGap,
  }
}

export function currentCard(session: Session): CardRow | undefined {
  const id = session.pending[0]
  return id === undefined ? undefined : session.cards[id]
}

export function isFinished(session: Session): boolean {
  return session.pending.length === 0
}

/**
 * Records the answer to the current card. `updated` is the card after
 * scheduling (from `reviewCard`). Again puts the card back `requeueGap`
 * cards later (or last, if fewer remain) so it is retried this session.
 */
export function answerCurrent(session: Session, updated: CardRow, rating: Grade): Session {
  const [head, ...rest] = session.pending
  if (head === undefined) throw new Error('The session is already finished')
  if (updated.id !== head)
    throw new Error(`Answered "${updated.id}" but the current card is "${head}"`)

  const pending = [...rest]
  if (rating === Rating.Again) pending.splice(Math.min(session.requeueGap, pending.length), 0, head)
  return {
    ...session,
    pending,
    cards: { ...session.cards, [head]: updated },
    answered: { ...session.answered, [rating]: session.answered[rating] + 1 },
    requeued: session.requeued + (rating === Rating.Again ? 1 : 0),
  }
}

/** Cards answered so far (retries count again). */
export function answeredCount(session: Session): number {
  return Object.values(session.answered).reduce((a, b) => a + b, 0)
}
