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
