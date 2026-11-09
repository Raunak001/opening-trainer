import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  getDb,
  getSettings,
  updateSettings,
  type GameRow,
  type TimeClass,
  type TrainerDB,
} from '../db'
import { listRepertoires, loadRepertoire, type Repertoire } from '../repertoire/builder'
import { getChesscomClient, type ChesscomClient } from './chesscom'
import { describeDeviation, matchGame, type GameMatch } from './deviation'
import { filterGames, TIME_CLASSES } from './games'
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

type ColorFilter = 'both' | GameRow['color']

const RESULT_LABEL: Record<GameRow['result'], string> = { win: 'Won', loss: 'Lost', draw: 'Draw' }

/** Import chess.com games and show where each one left the repertoire. */
export function ImportPage({ db: dbProp, client: clientProp }: ImportPageProps) {
  const db = dbProp ?? getDb()
  const [username, setUsername] = useState<string>()
  const [timeClasses, setTimeClasses] = useState<TimeClass[]>([])
  const [color, setColor] = useState<ColorFilter>('both')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const abort = useRef<AbortController>(undefined)

  useEffect(() => {
    let live = true
    getSettings(db).then((s) => {
      if (!live) return
      setUsername(s.importer.username)
      setTimeClasses(s.importer.timeClasses)
    })
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

  function toggleTimeClass(tc: TimeClass, on: boolean) {
    const next = TIME_CLASSES.filter((t) => (t === tc ? on : timeClasses.includes(t)))
    setTimeClasses(next)
    updateSettings(db, { importer: { timeClasses: next } }).catch((err: unknown) =>
      setStatus({ kind: 'error', message: String(err) }),
    )
  }

  // Live, so a rebuilt tree re-checks every game.
  const repertoires = useLiveQuery(async () => {
    const reps: Repertoire[] = []
    for (const row of await listRepertoires(db)) {
      const rep = await loadRepertoire(db, row.id)
      if (rep) reps.push(rep)
    }
    return reps
  }, [db])

  const matches = useMemo(() => {
    const out = new Map<string, GameMatch | undefined>()
    if (!repertoires) return out
    for (const g of games ?? []) out.set(g.id, matchGame(g.sans, g.color, repertoires))
    return out
  }, [games, repertoires])
  const repName = (id: string) => repertoires?.find((r) => r.id === id)?.name ?? ''

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
  const shown = filterGames(games ?? [], {
    timeClasses,
    color: color === 'both' ? undefined : color,
  })

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
        <div className="import__form">
          <fieldset className="import__checks">
            <legend>Time classes</legend>
            {TIME_CLASSES.map((tc) => (
              <label key={tc}>
                <input
                  type="checkbox"
                  checked={timeClasses.includes(tc)}
                  onChange={(e) => toggleTimeClass(tc, e.target.checked)}
                />
                {tc}
              </label>
            ))}
          </fieldset>
          <label>
            Your color
            <select value={color} onChange={(e) => setColor(e.target.value as ColorFilter)}>
              <option value="both">Both</option>
              <option value="white">White</option>
              <option value="black">Black</option>
            </select>
          </label>
        </div>
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

      {(games?.length ?? 0) > 0 && (
        <section className="import__panel" aria-label="Games">
          <h2>
            Games ({shown.length}
            {shown.length !== games?.length && ` of ${games?.length}`})
          </h2>
          <ol className="import__games">
            {shown.map((g) => (
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
                <DeviationCell match={matches.get(g.id)} sans={g.sans} repName={repName} />
              </li>
            ))}
          </ol>
        </section>
      )}
    </main>
  )
}

function DeviationCell({
  match,
  sans,
  repName,
}: {
  match: GameMatch | undefined
  sans: readonly string[]
  repName: (id: string) => string
}) {
  if (!match) return <span className="import__muted">No repertoire for this color</span>
  const d = match.deviation
  return (
    <span className={`import__dev import__dev--${d.kind}`} data-ply={d.ply}>
      {describeDeviation(d, sans)}
      {d.kind !== 'outside' && (
        <span className="import__muted"> · {repName(match.repertoireId)}</span>
      )}
    </span>
  )
}
