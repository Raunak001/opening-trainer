// Course data for the library, course page and Learn mode. Database reads only; no React.

import { State } from 'ts-fsrs'
import { getSettings, type CardRow, type RepertoireRow, type TrainerDB } from '../db'
// Direct module imports: the repertoire index also re-exports React pages.
import { loadRepertoire, type Repertoire } from '../repertoire/builder'
import { CATALOG, type CatalogEntry } from '../repertoire/catalog'
import { courseRepertoireId } from '../repertoire/courses'
import {
  cardsByPosition,
  enumerateLines,
  lineCards,
  lineStatus,
  openingFamily,
  type ChapterRoot,
  type CourseLine,
  type LineStatus,
} from '../repertoire/lines'
import type { PositionKey } from '../repertoire/positionKey'
import { dailyUsage, startOfDay } from '../srs/queue'
import { nextLineToLearn, type NextLine } from './learn'

export interface LineWithStatus extends CourseLine {
  status: LineStatus
  /** Live cards on the line. */
  cards: number
}

/** Started cards (not new, not suspended) due by `now`. */
export function dueCount(cards: readonly CardRow[], now: Date): number {
  return cards.filter(
    (c) => !c.suspended && c.state !== State.New && c.due.getTime() <= now.getTime(),
  ).length
}

/** Lines of a course tree with their status (pure). */
export function linesWithStatus(
  repertoire: Pick<Repertoire, 'tree' | 'color'>,
  cards: readonly CardRow[],
): LineWithStatus[] {
  const byKey = cardsByPosition(cards)
  return enumerateLines(repertoire.tree, repertoire.color).map((line) => {
    const own = lineCards(line, byKey)
    return { ...line, status: lineStatus(own), cards: own.length }
  })
}

export interface CourseCounts {
  lines: number
  learned: number
  learning: number
  /** Cards due now in the course's Practice. */
  due: number
}

export function courseCounts(lines: readonly LineWithStatus[], due: number): CourseCounts {
  return {
    lines: lines.length,
    learned: lines.filter((l) => l.status === 'learned').length,
    learning: lines.filter((l) => l.status === 'learning').length,
    due,
  }
}

export interface LibraryItem {
  entry: CatalogEntry
  /** Set once the course has been started. */
  course?: RepertoireRow
  counts?: CourseCounts
}

/** Every catalog entry, with progress for the started ones. */
export async function loadLibrary(db: TrainerDB, now: Date = new Date()): Promise<LibraryItem[]> {
  return db.transaction('r', db.repertoires, db.nodes, db.cards, async () => {
    const items: LibraryItem[] = []
    for (const entry of CATALOG) {
      const repertoire = await loadRepertoire(db, courseRepertoireId(entry.id))
      if (!repertoire) {
        items.push({ entry })
        continue
      }
      const cards = await db.cards.where('repertoireId').equals(repertoire.id).toArray()
      items.push({
        entry,
        course: await db.repertoires.get(repertoire.id),
        counts: courseCounts(linesWithStatus(repertoire, cards), dueCount(cards, now)),
      })
    }
    return items
  })
}

export interface CourseDetail {
  repertoire: Repertoire
  lines: LineWithStatus[]
  cards: Map<PositionKey, CardRow>
  counts: CourseCounts
  /** The line Learn would teach next, or why there is none. */
  next: NextLine
  /** New cards today's cap still allows. */
  newCardsLeft: number
  /** Today's whole new-card cap. */
  newCardsTotal: number
}

/** Everything the course page and Learn mode need; undefined if not started. */
export async function loadCourse(
  db: TrainerDB,
  entryId: string,
  now: Date = new Date(),
): Promise<CourseDetail | undefined> {
  return db.transaction(
    'r',
    [db.repertoires, db.nodes, db.cards, db.reviewLogs, db.settings],
    async () => {
      const repertoire = await loadRepertoire(db, courseRepertoireId(entryId))
      if (!repertoire) return undefined
      const cardRows = await db.cards.where('repertoireId').equals(repertoire.id).toArray()
      const settings = await getSettings(db)
      const logs = await db.reviewLogs
        .where('review')
        .between(startOfDay(now), now, true, true)
        .toArray()
      const total = settings.daily.newCards
      const left = Math.max(0, total - dailyUsage(logs, now).newCards)
      const lines = linesWithStatus(repertoire, cardRows)
      const cards = cardsByPosition(cardRows)
      return {
        repertoire,
        lines,
        cards,
        counts: courseCounts(lines, dueCount(cardRows, now)),
        next: nextLineToLearn(lines, cards, { left, total }),
        newCardsLeft: left,
        newCardsTotal: total,
      }
    },
  )
}

/** How a catalog entry names its chapters (see `chapterName`). */
export function chapterRoot(entry: CatalogEntry): ChapterRoot {
  const startName = entry.tsvName ?? entry.name
  return { startName, families: new Set([openingFamily(entry.name), openingFamily(startName)]) }
}
