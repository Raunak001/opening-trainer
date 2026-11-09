import { createEmptyCard } from 'ts-fsrs'
import { nodeId, type CardRow } from '../db'
// Import repertoire modules directly: the package index also re-exports React pages.
import type { PositionKey } from '../repertoire/positionKey'
import type { Color } from '../repertoire/prune'
import { sideToMove, type RepertoireTree } from '../repertoire/tree'

/** A position the user must answer, and the move the tree expects there. */
export interface CardTarget {
  positionKey: PositionKey
  answer: string
}

/**
 * Card = a node where it is the user's move (CLAUDE.md) and the tree has an
 * answer for it. Leaves where it is the user's move but no move was chosen
 * (no explorer data) are skipped: there would be nothing to check against.
 */
export function cardTargets(tree: RepertoireTree, userColor: Color): CardTarget[] {
  return Object.values(tree.nodes)
    .filter((n) => sideToMove(n.key) === userColor && n.edges.length > 0)
    .sort((a, b) => a.ply - b.ply || a.key.localeCompare(b.key))
    .map((n) => ({ positionKey: n.key, answer: n.edges[0].san }))
}

export interface CardSyncPlan {
  /** New positions: fresh cards. */
  add: CardRow[]
  /** The expected move changed: fresh cards replacing the old state (logs are kept). */
  reset: CardRow[]
  /** Positions that left the tree. */
  suspend: CardRow[]
  /**
   * Suspended positions back with the same answer (history resumes), and game
   * cards whose position the tree now covers with the same answer (they become tree cards).
   */
  resume: CardRow[]
  /** Untouched. */
  unchanged: number
}

function freshCard(repertoireId: string, target: CardTarget, now: Date): CardRow {
  return {
    ...createEmptyCard(now),
    id: nodeId(repertoireId, target.positionKey),
    repertoireId,
    positionKey: target.positionKey,
    answer: target.answer,
  }
}

/** A game card turned into a tree card, keeping its history. */
function adopt(card: CardRow): CardRow {
  const adopted: CardRow = { ...card, suspended: false }
  delete adopted.origin
  delete adopted.line
  delete adopted.gameId
  return adopted
}

/** Decides how a repertoire's stored cards must change to match its tree. Pure. */
export function planCardSync(
  repertoireId: string,
  targets: readonly CardTarget[],
  existing: readonly CardRow[],
  now: Date,
): CardSyncPlan {
  const plan: CardSyncPlan = { add: [], reset: [], suspend: [], resume: [], unchanged: 0 }
  const byPosition = new Map(existing.map((c) => [c.positionKey, c]))
  const wanted = new Set<PositionKey>()

  for (const target of targets) {
    wanted.add(target.positionKey)
    const card = byPosition.get(target.positionKey)
    if (!card) plan.add.push(freshCard(repertoireId, target, now))
    else if (card.answer !== target.answer) plan.reset.push(freshCard(repertoireId, target, now))
    else if (card.origin === 'game') plan.resume.push(adopt(card))
    else if (card.suspended) plan.resume.push({ ...card, suspended: false })
    else plan.unchanged++
  }
  for (const card of existing) {
    // Game cards are not in the tree by design: rebuilds leave them alone.
    if (!wanted.has(card.positionKey) && !card.suspended && card.origin !== 'game')
      plan.suspend.push({ ...card, suspended: true })
  }
  return plan
}
