// Dexie schema, migrations, backup/restore.

export {
  DB_NAME,
  getDb,
  migrateTreesToNodes,
  nodeId,
  TrainerDB,
  type CardRow,
  type EvalCacheRow,
  type ExplorerCacheRow,
  type NodeRow,
  type RepertoireRow,
  type ReviewDetails,
  type ReviewLogRow,
  type SettingsRow,
} from './db'
export {
  DEFAULT_SETTINGS,
  getSettings,
  mergeSettings,
  updateSettings,
  type AppSettings,
  type SettingsPatch,
} from './settings'
export {
  BACKUP_FORMAT,
  BACKUP_TABLES,
  BACKUP_VERSION,
  backupCounts,
  BackupError,
  backupFileName,
  exportBackup,
  parseBackup,
  restoreBackup,
  serializeBackup,
  type Backup,
  type BackupCounts,
  type BackupTable,
} from './backup'
