import type { CoordDrill, CoordRunRow, CoordStatRow, TrainerDB } from '../db'
// Direct module import: the repertoire index also re-exports React pages.
import { CATALOG } from '../repertoire/catalog'
import { makePrompt, promptsFromLine, type MovePrompt } from './movePrompts'
import { recordAnswers, type Answer } from './stats'
import type { View } from './squares'

/** Saves a finished round: per-square stats (find/name answers) and the run itself. */
export async function saveRound(
  db: TrainerDB,
  run: Omit<CoordRunRow, 'id'>,
  answers: readonly Answer[],
): Promise<void> {
  await db.transaction('rw', db.coordStats, db.coordRuns, async () => {
    if (answers.length > 0) {
      const keys = [...new Set(answers.map((a) => `${a.mode}:${a.view}:${a.square}`))]
      const stored = await db.coordStats.bulkGet(keys)
      const map = new Map<string, CoordStatRow>()
      stored.forEach((row) => row && map.set(row.key, row))
      await db.coordStats.bulkPut(recordAnswers(map, answers))
    }
    await db.coordRuns.add(run)
  })
}

/** The best run per drill and view: most correct, then fewest wrong, then fastest. */
export function bestRuns(runs: readonly CoordRunRow[]): Map<string, CoordRunRow> {
  const best = new Map<string, CoordRunRow>()
  for (const run of runs) {
    const key = `${run.drill}:${run.view}`
    const cur = best.get(key)
    if (
      !cur ||
      run.correct > cur.correct ||
      (run.correct === cur.correct && run.wrong < cur.wrong) ||
      (run.correct === cur.correct && run.wrong === cur.wrong && run.durationMs < cur.durationMs)
    )
      best.set(key, run)
  }
  return best
}

export const runKey = (drill: CoordDrill, view: View) => `${drill}:${view}`

/** Your moves from your course cards (tree cards only), named by course. */
export async function loadCardPrompts(db: TrainerDB): Promise<MovePrompt[]> {
  const cards = (await db.cards.toArray()).filter((c) => !c.suspended && !c.origin)
  if (cards.length === 0) return []
  const [nodes, reps] = await Promise.all([
    db.nodes.bulkGet(cards.map((c) => c.id)),
    db.repertoires.toArray(),
  ])
  const names = new Map(reps.map((r) => [r.id, r.name]))
  const out: MovePrompt[] = []
  cards.forEach((card, i) => {
    const node = nodes[i]
    if (!node) return
    const p = makePrompt(node.fen, card.answer, names.get(card.repertoireId) ?? 'Your repertoire')
    if (p) out.push(p)
  })
  return out
}

/** Every move of every catalog entry's start moves: the fallback pool. */
export function catalogPrompts(): MovePrompt[] {
  return CATALOG.flatMap((e) => promptsFromLine(e.startMoves, e.name))
}
