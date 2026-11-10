import { useRef, useState, type ChangeEvent } from 'react'
import {
  BACKUP_TABLES,
  backupCounts,
  backupFileName,
  exportBackup,
  parseBackup,
  restoreBackup,
  serializeBackup,
  type Backup,
  type BackupCounts,
  type BackupTable,
} from './backup'
import { getDb, type TrainerDB } from './db'
import './backup.css'

export interface BackupPageProps {
  db?: TrainerDB
  /** Saves a file for the user; tests replace it. */
  saveFile?: (name: string, text: string) => void
}

const TABLE_LABELS: Record<BackupTable, string> = {
  repertoires: 'Repertoires',
  nodes: 'Tree positions',
  cards: 'Cards',
  reviewLogs: 'Reviews',
  settings: 'Settings',
  explorerCache: 'Cached explorer answers',
  evalCache: 'Cached engine evaluations',
  archives: 'chess.com months fetched',
  games: 'Imported games',
  puzzleAttempts: 'Puzzle attempts',
  analyses: 'Game reviews',
}

/** Default file saver: a temporary download link. */
function downloadFile(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

type Status =
  | { kind: 'idle' }
  | { kind: 'busy'; message: string }
  | { kind: 'confirm'; backup: Backup; fileName: string }
  | { kind: 'done'; message: string }
  | { kind: 'error'; message: string }

/** Export everything to a JSON file; restore from one after confirming. */
export function BackupPage({ db: dbProp, saveFile = downloadFile }: BackupPageProps) {
  const db = dbProp ?? getDb()
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const fileInput = useRef<HTMLInputElement>(null)
  const busy = status.kind === 'busy'

  async function exportNow(): Promise<boolean> {
    try {
      const now = new Date()
      const backup = await exportBackup(db, now)
      saveFile(backupFileName(now), serializeBackup(backup))
      return true
    } catch (err) {
      setStatus({ kind: 'error', message: `Export failed: ${String(err)}` })
      return false
    }
  }

  async function onExport() {
    setStatus({ kind: 'busy', message: 'Exporting…' })
    if (await exportNow()) setStatus({ kind: 'done', message: 'Backup saved.' })
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow picking the same file again
    if (!file) return
    setStatus({ kind: 'busy', message: 'Reading backup…' })
    try {
      await db.open()
      const backup = parseBackup(await file.text(), db.verno)
      setStatus({ kind: 'confirm', backup, fileName: file.name })
    } catch (err) {
      setStatus({
        kind: 'error',
        message: `Could not read ${file.name}: ${err instanceof Error ? err.message : String(err)}`,
      })
    }
  }

  async function onRestore(backup: Backup) {
    setStatus({ kind: 'busy', message: 'Restoring…' })
    try {
      const counts = await restoreBackup(db, backup)
      setStatus({
        kind: 'done',
        message: `Restored ${counts.repertoires} repertoires, ${counts.cards} cards and ${counts.reviewLogs} reviews.`,
      })
    } catch (err) {
      setStatus({
        kind: 'error',
        message: `Restore failed; your data is unchanged. ${err instanceof Error ? err.message : String(err)}`,
      })
    }
  }

  return (
    <main className="backup">
      <section className="backup__panel">
        <h1>Backup</h1>
        <p className="backup__muted">
          Everything lives in this browser only. Export regularly; a backup file restores all
          repertoires, cards, review history and settings.
        </p>
        <div className="backup__actions">
          <button type="button" className="backup__primary" disabled={busy} onClick={onExport}>
            Export backup
          </button>
          <button type="button" disabled={busy} onClick={() => fileInput.current?.click()}>
            Restore from file…
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            hidden
            data-testid="backup-file"
            onChange={onFile}
          />
        </div>
        {status.kind === 'busy' && <p role="status">{status.message}</p>}
        {status.kind === 'done' && (
          <p role="status" className="backup__ok">
            {status.message}
          </p>
        )}
        {status.kind === 'error' && (
          <p role="alert" className="backup__error">
            {status.message}
          </p>
        )}
      </section>

      {status.kind === 'confirm' && (
        <Confirm
          backup={status.backup}
          fileName={status.fileName}
          onExportFirst={exportNow}
          onRestore={() => onRestore(status.backup)}
          onCancel={() => setStatus({ kind: 'idle' })}
        />
      )}
    </main>
  )
}

function Confirm({
  backup,
  fileName,
  onExportFirst,
  onRestore,
  onCancel,
}: {
  backup: Backup
  fileName: string
  onExportFirst: () => Promise<boolean>
  onRestore: () => void
  onCancel: () => void
}) {
  const counts: BackupCounts = backupCounts(backup)
  const [savedFirst, setSavedFirst] = useState(false)
  return (
    <section
      className="backup__panel backup__confirm"
      role="alertdialog"
      aria-label="Confirm restore"
    >
      <h2>Replace all data with this backup?</h2>
      <p>
        <strong>{fileName}</strong>, exported {backup.exportedAt.toLocaleString()}.
      </p>
      <table className="backup__counts">
        <tbody>
          {BACKUP_TABLES.map((t) => (
            <tr key={t}>
              <th scope="row">{TABLE_LABELS[t]}</th>
              <td>{counts[t].toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="backup__warning">
        Everything currently in the app is deleted and replaced. This cannot be undone unless you
        have a backup of the current data.
      </p>
      <div className="backup__actions">
        <button
          type="button"
          onClick={async () => setSavedFirst(await onExportFirst())}
          disabled={savedFirst}
        >
          {savedFirst ? 'Current data saved' : 'Save current data first'}
        </button>
        <button type="button" className="backup__danger" onClick={onRestore}>
          Replace my data
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </section>
  )
}
