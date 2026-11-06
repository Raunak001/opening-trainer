import Dexie, { type EntityTable } from 'dexie'

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

export const DB_NAME = 'opening-trainer'

export class TrainerDB extends Dexie {
  explorerCache!: EntityTable<ExplorerCacheRow, 'key'>

  constructor(name: string = DB_NAME) {
    super(name)
    // v1 (T2.1): explorer cache only. Later tables arrive via version bumps with upgrades.
    this.version(1).stores({
      explorerCache: 'key, positionKey',
    })
  }
}

let instance: TrainerDB | undefined

/** The app's shared database (opened lazily). */
export function getDb(): TrainerDB {
  instance ??= new TrainerDB()
  return instance
}
