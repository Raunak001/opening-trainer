import { State } from 'ts-fsrs'
import type { AppSettings, CardRow } from '../db'
// Direct module imports: the repertoire index also re-exports React pages.
import type { PositionKey } from '../repertoire/positionKey'
import { pathTo, type RepertoireTree } from '../repertoire/tree'
import { startOfDay, type DailyUsage } from './queue'

const DAY_MS = 86_400_000

/** Start of the local day after the one containing `now`. */
export function endOfDay(now: Date): Date {
  const start = startOfDay(now)
  return new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1)
}

export interface TodayCounts {
  /** Started cards (learning or review) due before tonight's midnight. */
  due: number
  /** Of `due`: short learning/relearning steps. */
  learning: number
  /** Of `due`: review cards. */
  review: number
  /** Of the review cards, how many fit in what is left of today's review cap. */
  reviewWithinCap: number
  /** Cards never studied. */
  newTotal: number
}

/** Today's workload (pure). Suspended cards are ignored. */
export function todayCounts(
  cards: readonly CardRow[],
  now: Date,
  limits: AppSettings['daily'],
  usage: DailyUsage,
): TodayCounts {
  const end = endOfDay(now).getTime()
  let learning = 0
  let review = 0
  let newTotal = 0
  for (const c of cards) {
    if (c.suspended) continue
    if (c.state === State.New) newTotal++
    else if (c.due.getTime() < end) {
      if (c.state === State.Review) review++
      else learning++
    }
  }
  return {
    due: learning + review,
    learning,
    review,
    reviewWithinCap: Math.min(review, Math.max(0, limits.reviews - usage.reviews)),
    newTotal,
  }
}

export interface Streak {
  /** Consecutive days with a review, ending today (or yesterday if not studied yet today). */
  current: number
  longest: number
  studiedToday: boolean
}

/** Local calendar day number, robust to DST (counts days, not 24-hour blocks). */
function dayNumber(d: Date): number {
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS)
}

/** Study streak from review times (pure). Any order; future times are ignored. */
export function studyStreak(reviewTimes: readonly Date[], now: Date): Streak {
  const today = dayNumber(now)
  const days = [...new Set(reviewTimes.map(dayNumber).filter((d) => d <= today))].sort(
    (a, b) => a - b,
  )
  let longest = 0
  let run = 0
  for (let i = 0; i < days.length; i++) {
    run = i > 0 && days[i] === days[i - 1] + 1 ? run + 1 : 1
    longest = Math.max(longest, run)
  }
  const last = days.at(-1)
  const studiedToday = last === today
  // `run` is the streak ending on the last study day; it is alive if that was today or yesterday.
  const current = last !== undefined && last >= today - 1 ? run : 0
  return { current, longest, studiedToday }
}

/** 0–1: how close a card's stability is to "mastered". New cards are 0. */
export function cardMastery(card: CardRow, masteredAfterDays: number): number {
  if (card.state === State.New) return 0
  return Math.min(1, card.stability / masteredAfterDays)
}

export interface LineProgress {
  /** The leaf the line ends on. */
  leafKey: PositionKey
  /** SAN from the start position to the leaf. */
  moves: string[]
  /** Positions along the line: the start, then after each move. */
  positions: PositionKey[]
  /** User-to-move positions on the line that have a card. */
  cards: number
  /** Of those, cards studied at least once. */
  studied: number
  /** Mean FSRS stability in days over the line's cards (new cards count as 0). */
  meanStability: number
  /** Mean card mastery, 0–1. */
  mastery: number
}

/**
 * Mastery for every line of a repertoire (pure): one line per leaf, following
 * the shortest route from the start. Weakest lines first. Suspended cards and
 * lines without cards are left out.
 */
export function lineProgress(
  tree: RepertoireTree,
  cards: readonly CardRow[],
  masteredAfterDays: number,
): LineProgress[] {
  const byPosition = new Map(cards.filter((c) => !c.suspended).map((c) => [c.positionKey, c]))
  const lines: LineProgress[] = []
  for (const leaf of Object.values(tree.nodes)) {
    if (leaf.edges.length > 0) continue
    const moves = pathTo(tree, leaf.key)
    // Walk the line's positions: the root, then after each move.
    const keys: PositionKey[] = [tree.rootKey]
    let key = tree.rootKey
    for (const san of moves) {
      const edge = tree.nodes[key].edges.find((e) => e.san === san)
      if (!edge) break
      key = edge.to
      keys.push(key)
    }
    const onLine = keys.map((k) => byPosition.get(k)).filter((c) => c !== undefined)
    if (onLine.length === 0) continue
    const sum = (f: (c: CardRow) => number) => onLine.reduce((s, c) => s + f(c), 0)
    lines.push({
      leafKey: leaf.key,
      moves,
      positions: keys,
      cards: onLine.length,
      studied: onLine.filter((c) => c.state !== State.New).length,
      meanStability: sum((c) => (c.state === State.New ? 0 : c.stability)) / onLine.length,
      mastery: sum((c) => cardMastery(c, masteredAfterDays)) / onLine.length,
    })
  }
  return lines.sort(
    (a, b) => a.mastery - b.mastery || a.moves.join(' ').localeCompare(b.moves.join(' ')),
  )
}

/** Mean mastery over a set of cards (suspended ignored), 0–1; 0 if none. */
export function overallMastery(cards: readonly CardRow[], masteredAfterDays: number): number {
  const live = cards.filter((c) => !c.suspended)
  if (live.length === 0) return 0
  return live.reduce((s, c) => s + cardMastery(c, masteredAfterDays), 0) / live.length
}
