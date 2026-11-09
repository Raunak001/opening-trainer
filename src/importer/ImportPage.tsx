import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { getDb, getSettings, updateSettings, type GameRow, type TrainerDB } from '../db'
import { getChesscomClient, type ChesscomClient } from './chesscom'
import { syncGames, type SyncProgress } from './sync'
import './import.css'

export interface ImportPageProps {
  db?: TrainerDB
  client?: ChesscomClient
}

type Status =
  | { kind: 'idle' }
  | { kind: 'syncing'; progress?: SyncProgress }
  | { kind: 'done'; message: string }
  | { kind: 'error'; message: string }

const RESULT_LABEL: Record<GameRow['result'], string> = { win: 'Won', loss: 'Lost', draw: 'Draw' }

/** Import chess.com games and show where each one left the repertoire. */
export function ImportPage({ db: dbProp, client: clientProp }: ImportPageProps) {
  const db = dbProp ?? getDb()
  const [username, setUsername] = useState<string>()
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const abort = useRef<AbortController>(undefined)

  useEffect(() => {
    let live = true
    getSettings(db).then((s) => live && setUsername(s.importer.username))
    return () => {
      live = false
      abort.current?.abort()
    }
  }, [db])

  const user = username?.trim().toLowerCase() ?? ''
  const games = useLiveQuery(
    async (): Promise<GameRow[]> => (user ? db.games.where('username').equals(user).toArray() : []),
    [db, user],
  )

  async function onSync(e: FormEvent) {
    e.preventDefault()
    if (!user || status.kind === 'syncing') return
    const controller = new AbortController()
    abort.current = controller
    setStatus({ kind: 'syncing' })
    try {
      await updateSettings(db, { importer: { username: user } })
      const r = await syncGames(db, clientProp ?? getChesscomClient(), user, {
        signal: controller.signal,
        onProgress: (progress) => setStatus({ kind: 'syncing', progress }),
      })
      setStatus({
        kind: 'done',
        message:
          `Fetched ${r.fetched} of ${r.months} months: ${r.added} new games, ` +
          `${r.games} stored.`,
      })
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError')
        setStatus({ kind: 'done', message: 'Sync cancelled. Months already fetched are kept.' })
      else setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }

  const syncing = status.kind === 'syncing'
  const sorted = [...(games ?? [])].sort((a, b) => b.endTime - a.endTime)

  return (
    <main className="import">
      <section className="import__panel">
        <h1>Import games</h1>
        <form className="import__form" onSubmit={onSync}>
          <label>
            chess.com username
            <input
              value={username ?? ''}
              onChange={(e) => setUsername(e.target.value)}
              disabled={username === undefined || syncing}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <button type="submit" className="import__primary" disabled={!user || syncing}>
            Sync
          </button>
          {syncing && (
            <button type="button" onClick={() => abort.current?.abort()}>
              Cancel
            </button>
          )}
        </form>
        {status.kind === 'syncing' && (
          <p role="status">
            {status.progress
              ? `Fetching ${status.progress.month} (${status.progress.index} of ${status.progress.total})…`
              : 'Listing archives…'}
          </p>
        )}
        {status.kind === 'done' && (
          <p role="status" className="import__ok">
            {status.message}
          </p>
        )}
        {status.kind === 'error' && (
          <p role="alert" className="import__error">
            {status.message}
          </p>
        )}
      </section>

      {sorted.length > 0 && (
        <section className="import__panel" aria-label="Games">
          <h2>Games ({sorted.length})</h2>
          <ol className="import__games">
            {sorted.map((g) => (
              <li key={g.id} className="import__game">
                <span className="import__muted">{new Date(g.endTime).toLocaleDateString()}</span>
                <span>
                  <a href={g.id} target="_blank" rel="noreferrer">
                    {g.color === 'white' ? 'White' : 'Black'} vs {g.opponent}
                  </a>{' '}
                  <span className="import__muted">
                    {g.timeClass} · {RESULT_LABEL[g.result]}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </main>
  )
}
