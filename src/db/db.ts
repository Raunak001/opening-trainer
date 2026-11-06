import Dexie, { type EntityTable } from 'dexie'
import type { Color, PruneSettings, RepertoireTree, Speed, RatingBucket } from '../repertoire'

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

/** A built repertoire. The whole tree is one row for now; T3.1 may split nodes out. */
export interface RepertoireRow {
  id: string
  name: string
  color: Color
  /** SAN moves from the initial position that every line starts with. */
  startMoves: string[]
  speeds: Speed[]
  ratings: RatingBucket[]
  settings: PruneSettings
  tree: RepertoireTree
  createdAt: number
  updatedAt: number
}

export const DB_NAME = 'opening-trainer'

export class TrainerDB extends Dexie {
  explorerCache!: EntityTable<ExplorerCacheRow, 'key'>
  repertoires!: EntityTable<RepertoireRow, 'id'>

  constructor(name: string = DB_NAME) {
    super(name)
    // v1 (T2.1): explorer cache.
    this.version(1).stores({
      explorerCache: 'key, positionKey',
    })
    // v2 (T2.4b): built repertoires.
    this.version(2)
      .stores({
        repertoires: 'id, name, updatedAt',
      })
      .upgrade(() => {
        // New table only: nothing to transform, and explorerCache rows are left untouched.
      })
  }
}

let instance: TrainerDB | undefined

/** The app's shared database (opened lazily). */
export function getDb(): TrainerDB {
  instance ??= new TrainerDB()
  return instance
}
