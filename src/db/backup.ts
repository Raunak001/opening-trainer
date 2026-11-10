import type { TrainerDB } from './db'

export const BACKUP_FORMAT = 'opening-trainer-backup'
export const BACKUP_VERSION = 1

/** Every table, in a stable order. A backup must contain each one (possibly empty). */
export const BACKUP_TABLES = [
  'repertoires',
  'nodes',
  'cards',
  'reviewLogs',
  'settings',
  'explorerCache',
  'evalCache',
  'archives',
  'games',
  'puzzleAttempts',
  'analyses',
  'coordStats',
  'coordRuns',
] as const

export type BackupTable = (typeof BACKUP_TABLES)[number]

/** Primary key field of each table: every backed-up row must have it. */
const PRIMARY_KEY: Record<BackupTable, string> = {
  repertoires: 'id',
  nodes: 'id',
  cards: 'id',
  reviewLogs: 'id',
  settings: 'id',
  explorerCache: 'key',
  evalCache: 'key',
  archives: 'id',
  games: 'id',
  puzzleAttempts: 'id',
  analyses: 'gameId',
  coordStats: 'key',
  coordRuns: 'id',
}

/** Schema version that introduced each table. Older backups restore with those tables empty. */
const TABLE_SINCE: Partial<Record<BackupTable, number>> = {
  archives: 4,
  games: 4,
  puzzleAttempts: 5,
  analyses: 6,
  coordStats: 7,
  coordRuns: 7,
}

/** Oldest schema version whose backups still restore (later versions only added tables). */
export const MIN_BACKUP_SCHEMA = 3

export interface Backup {
  format: typeof BACKUP_FORMAT
  version: number
  /** Dexie schema version the rows belong to. */
  schemaVersion: number
  exportedAt: Date
  tables: Record<BackupTable, Record<string, unknown>[]>
}

export type BackupCounts = Record<BackupTable, number>

export class BackupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BackupError'
  }
}

/** Reads every table into a backup object. */
export async function exportBackup(db: TrainerDB, now: Date = new Date()): Promise<Backup> {
  await db.open()
  return db.transaction(
    'r',
    BACKUP_TABLES.map((t) => db.table(t)),
    async () => {
      const tables = {} as Backup['tables']
      for (const name of BACKUP_TABLES) tables[name] = await db.table(name).toArray()
      return {
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        schemaVersion: db.verno,
        exportedAt: now,
        tables,
      }
    },
  )
}

const DATE_TAG = '$date'

/**
 * JSON text for a backup. Dates (card due dates, review times, …) are tagged
 * so they come back as Dates rather than strings.
 */
export function serializeBackup(backup: Backup): string {
  return JSON.stringify(backup, function (this: Record<string, unknown>, key, value) {
    const original = this[key]
    return original instanceof Date ? { [DATE_TAG]: original.toISOString() } : value
  })
}

function reviveDates(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const keys = Object.keys(value)
    const tagged = (value as Record<string, unknown>)[DATE_TAG]
    if (keys.length === 1 && typeof tagged === 'string') {
      const date = new Date(tagged)
      if (!Number.isNaN(date.getTime())) return date
    }
  }
  return value
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Parses and checks a backup file. Throws BackupError with a readable reason
 * for anything that is not a complete backup this app can restore.
 */
export function parseBackup(text: string, currentSchemaVersion: number): Backup {
  let data: unknown
  try {
    data = JSON.parse(text, reviveDates)
  } catch {
    throw new BackupError('This file is not valid JSON.')
  }
  if (!isRecord(data) || data.format !== BACKUP_FORMAT)
    throw new BackupError('This is not an Opening Trainer backup.')
  if (data.version !== BACKUP_VERSION)
    throw new BackupError(`Unsupported backup format version ${String(data.version)}.`)
  if (
    typeof data.schemaVersion !== 'number' ||
    data.schemaVersion < MIN_BACKUP_SCHEMA ||
    data.schemaVersion > currentSchemaVersion
  )
    throw new BackupError(
      `This backup is from database version ${String(data.schemaVersion)}; ` +
        `this app uses version ${currentSchemaVersion}.`,
    )
  if (!(data.exportedAt instanceof Date)) throw new BackupError('The backup has no export date.')
  if (!isRecord(data.tables)) throw new BackupError('The backup has no tables.')

  const tables = {} as Backup['tables']
  for (const name of BACKUP_TABLES) {
    const schemaVersion = data.schemaVersion
    const rows = data.tables[name] ?? ((TABLE_SINCE[name] ?? 0) > schemaVersion ? [] : undefined)
    if (!Array.isArray(rows)) throw new BackupError(`The backup is missing the "${name}" table.`)
    const pk = PRIMARY_KEY[name]
    rows.forEach((row, i) => {
      if (!isRecord(row) || row[pk] === undefined || row[pk] === null)
        throw new BackupError(`Row ${i + 1} of "${name}" has no "${pk}".`)
    })
    tables[name] = rows as Record<string, unknown>[]
  }
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    // Rows from older schemas are valid as is (later versions only added tables).
    schemaVersion: currentSchemaVersion,
    exportedAt: data.exportedAt,
    tables,
  }
}

export function backupCounts(backup: Backup): BackupCounts {
  return Object.fromEntries(BACKUP_TABLES.map((t) => [t, backup.tables[t].length])) as BackupCounts
}

/**
 * Replaces all data with the backup's, in one transaction: if anything fails,
 * nothing changes.
 */
export async function restoreBackup(db: TrainerDB, backup: Backup): Promise<BackupCounts> {
  await db.open()
  if (backup.schemaVersion < MIN_BACKUP_SCHEMA || backup.schemaVersion > db.verno)
    throw new BackupError(
      `Backup is for database version ${backup.schemaVersion}, not ${db.verno}.`,
    )
  await db.transaction(
    'rw',
    BACKUP_TABLES.map((t) => db.table(t)),
    async () => {
      for (const name of BACKUP_TABLES) {
        const table = db.table(name)
        await table.clear()
        await table.bulkAdd(backup.tables[name])
      }
    },
  )
  return backupCounts(backup)
}

/** "opening-trainer-backup-2026-11-08.json" (local date). */
export function backupFileName(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${BACKUP_FORMAT}-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`
}
