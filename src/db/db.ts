import Dexie, { type EntityTable, type Transaction } from 'dexie'
import type { Card, ReviewLog } from 'ts-fsrs'
import type {
  Color,
  PruneSettings,
  RatingBucket,
  RepertoireTree,
  Speed,
  TreeNode,
} from '../repertoire'
import type { AppSettings } from './settings'

/** One cached Lichess explorer response. */
export interface ExplorerCacheRow {
  /** `${positionKey}|${canonical params}` — see repertoire/explorer.ts. */
  key: string
  positionKey: string
  params: string
  /** Raw explorer JSON. Typed by the explorer client, opaque here. */
  response: unknown
  fetchedAt: number
}

/** One chess.com monthly archive that has been fetched. */
export interface ArchiveRow {
  /** `${username}/${YYYY}/${MM}` */
  id: string
  username: string
  /** `YYYY/MM` (UTC month, as chess.com files games by end time). */
  month: string
  fetchedAt: number
  /** Fetched after the month ended: immutable, never fetched again. */
  complete: boolean
  /** Standard-chess games stored from this archive. */
  gameCount: number
}

export type TimeClass = 'bullet' | 'blitz' | 'rapid' | 'daily'

/** What happened when a game was checked for automatic cards (T5.4). */
export interface GameCardResult {
  processedAt: number
  outcome: 'failed' | 'created' | 'none'
  cardId?: string
}

/** One imported chess.com game (standard chess only). */
export interface GameRow {
  /** chess.com game URL (unique, stable). */
  id: string
  /** Lowercased chess.com account the game was imported for. */
  username: string
  /** Archive the game came from (`ArchiveRow.id`). */
  archiveId: string
  /** Game end, ms since epoch. */
  endTime: number
  timeClass: TimeClass
  /** The user's color in this game. */
  color: Color
  opponent: string
  opponentRating?: number
  result: 'win' | 'loss' | 'draw'
  pgn: string
  /** Moves in SAN, parsed from the PGN at import. */
  sans: string[]
  /** Set once the game has been checked for automatic cards. */
  cards?: GameCardResult
}

/** A repertoire's definition. Its tree lives in `nodes`, one row per position. */
export interface RepertoireRow {
  id: string
  name: string
  color: Color
  /** SAN moves from the initial position that every line starts with. */
  startMoves: string[]
  speeds: Speed[]
  ratings: RatingBucket[]
  settings: PruneSettings
  /**
   * User's own move choices (position key → SAN) that replace the automatic
   * pick. Optional: rows saved before T2.7 have none. Not indexed.
   */
  overrides?: Record<string, string>
  /**
   * Opponent moves the user added to the tree (position key → SANs), kept even
   * when pruning would drop them (T5.5). Optional, not indexed.
   */
  extraMoves?: Record<string, string[]>
  /**
   * A system's moves, played wherever legal and played (T7.9; see the builder's
   * `forcedMoves`). Optional, not indexed.
   */
  forcedMoves?: string[]
  /**
   * Set when the repertoire is a library course (T7.3): the catalog entry id
   * and depth tier it was built from. Optional, not indexed.
   */
  courseId?: string
  tier?: 'essentials' | 'advanced' | 'full'
  /** Position key of the tree root (the initial position). */
  rootKey: string
  /** Number of rows in `nodes` for this repertoire, for lists without loading the tree. */
  positionCount: number
  createdAt: number
  updatedAt: number
}

/** One tree position of one repertoire. */
export interface NodeRow extends TreeNode {
  /** `${repertoireId}:${positionKey}`, same shape as card ids. */
  id: string
  repertoireId: string
}

/** FSRS state for one user-to-move position. */
export interface CardRow extends Card {
  /** `${repertoireId}:${positionKey}` (CLAUDE.md). */
  id: string
  repertoireId: string
  positionKey: string
  /** SAN the card was learned with. If the tree's move changes, the card starts over. */
  answer: string
  /**
   * The position left the tree (rebuild or move swap). Kept, not deleted, so its
   * history returns if the position does. Due queues skip suspended cards.
   */
  suspended?: boolean
  /**
   * `game`: created from an imported game where the opponent left the book (T5.4).
   * The position is not in the tree, so the card carries its own `line`.
   * `lesson`: a solved concept lesson (T6.5); `repertoireId` is `lessons/<pack id>` and
   * `lessonId` names the lesson. Absent → tree card.
   */
  origin?: 'game' | 'lesson'
  /** SAN moves from the initial position to the card's position (game cards only). */
  line?: string[]
  /** Game the card was created from (game cards only). */
  gameId?: string
  /** Lesson the card was created from (lesson cards only). */
  lessonId?: string
}

/** What happened in the review, beyond the rating (filled by the drill, T3.3+). */
export interface ReviewDetails {
  /** Time from prompt to the correct move. */
  durationMs?: number
  hintUsed?: boolean
  /** Wrong moves before the right one. */
  mistakes?: number
  /** Set when the review was an imported game (the card was misplayed there). */
  gameId?: string
}

/** One review of one card, as returned by ts-fsrs. */
export interface ReviewLogRow extends ReviewLog, ReviewDetails {
  id?: number
  cardId: string
  repertoireId: string
}

/** One Stockfish result. */
export interface EvalCacheRow {
  /** `${positionKey}|${depth}` */
  key: string
  positionKey: string
  depth: number
  /** Centipawns from the side to move; absent when `mate` is set. */
  scoreCp?: number
  /** Mate in N from the side to move (negative: getting mated). */
  mate?: number
  /** Best move in UCI. */
  bestMove: string
  /** Principal variation in UCI. */
  pv: string[]
  createdAt: number
}

/** The single settings document (id `'app'`). Missing fields fall back to defaults. */
export interface SettingsRow extends Partial<AppSettings> {
  id: 'app'
}

/** Repertoire rows saved by v2 carried the whole tree inline. */
interface V2RepertoireRow extends Omit<RepertoireRow, 'rootKey' | 'positionCount'> {
  tree?: RepertoireTree
}

export const DB_NAME = 'opening-trainer'

export function nodeId(repertoireId: string, positionKey: string): string {
  return `${repertoireId}:${positionKey}`
}

/** v2 → v3: move each repertoire's inline tree into `nodes`. */
export async function migrateTreesToNodes(tx: Transaction): Promise<void> {
  const repertoires = tx.table<V2RepertoireRow, string>('repertoires')
  const nodes = tx.table<NodeRow, string>('nodes')
  for (const row of await repertoires.toArray()) {
    const { tree, ...rest } = row
    if (!tree) continue
    const nodeRows = Object.values(tree.nodes).map((n) => ({
      ...n,
      id: nodeId(row.id, n.key),
      repertoireId: row.id,
    }))
    await nodes.bulkPut(nodeRows)
    const migrated: RepertoireRow = {
      ...rest,
      rootKey: tree.rootKey,
      positionCount: nodeRows.length,
    }
    await tx.table<RepertoireRow, string>('repertoires').put(migrated)
  }
}

export class TrainerDB extends Dexie {
  explorerCache!: EntityTable<ExplorerCacheRow, 'key'>
  repertoires!: EntityTable<RepertoireRow, 'id'>
  nodes!: EntityTable<NodeRow, 'id'>
  cards!: EntityTable<CardRow, 'id'>
  reviewLogs!: EntityTable<ReviewLogRow, 'id'>
  settings!: EntityTable<SettingsRow, 'id'>
  evalCache!: EntityTable<EvalCacheRow, 'key'>
  archives!: EntityTable<ArchiveRow, 'id'>
  games!: EntityTable<GameRow, 'id'>

  constructor(name: string = DB_NAME) {
    super(name)
    // v1 (T2.1): explorer cache.
    this.version(1).stores({
      explorerCache: 'key, positionKey',
    })
    // v2 (T2.4b): built repertoires, tree inline.
    this.version(2)
      .stores({
        repertoires: 'id, name, updatedAt',
      })
      .upgrade(() => {
        // New table only: nothing to transform.
      })
    // v3 (T3.1): full schema. Trees move from repertoire rows into `nodes`.
    this.version(3)
      .stores({
        nodes: 'id, repertoireId',
        cards: 'id, repertoireId, due, [repertoireId+due]',
        reviewLogs: '++id, cardId, repertoireId, review',
        settings: 'id',
        evalCache: 'key, positionKey',
      })
      .upgrade(migrateTreesToNodes)
    // v4 (T5.1): imported chess.com archives and games.
    this.version(4)
      .stores({
        archives: 'id, username',
        games: 'id, username, endTime, archiveId',
      })
      .upgrade(() => {
        // New tables only: nothing to transform.
      })
  }
}

let instance: TrainerDB | undefined

/** The app's shared database (opened lazily). */
export function getDb(): TrainerDB {
  instance ??= new TrainerDB()
  return instance
}
