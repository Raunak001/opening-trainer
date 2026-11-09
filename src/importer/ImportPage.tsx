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
import {
  applyAutoCards,
  engineReplyGrader,
  type ApplyOptions,
  type AutoCardSummary,
} from './autoCards'
import { describeDeviation, matchGame, type GameMatch } from './deviation'
import { filterGames, TIME_CLASSES } from './games'
import { syncGames, type SyncProgress, type SyncResult } from './sync'
import './import.css'

export interface ImportPageProps {
  db?: TrainerDB
  client?: ChesscomClient
  /** Grades the user's reply after an opponent leaves book; Stockfish by default. */
  gradeReply?: ApplyOptions['gradeReply']
}

type Status =
  | { kind: 'idle' }
  | { kind: 'busy'; message: string }
  | { kind: 'done'; message: string }
  | { kind: 'error'; message: string }

async function loadAllRepertoires(db: TrainerDB): Promise<Repertoire[]> {
  const reps: Repertoire[] = []
  for (const row of await listRepertoires(db)) {
    const rep = await loadRepertoire(db, row.id)
    if (rep) reps.push(rep)
  }
  return reps
}

function syncMessage(r: SyncResult): string {
  return `Fetched ${r.fetched} of ${r.months} months: ${r.added} new games, ${r.games} stored.`
}

function cardsMessage(s: AutoCardSummary): string {
  const failed = s.failed + s.refailed
  if (failed + s.created === 0) return 'No cards from games.'
  const cards = (n: number) => `${n} ${n === 1 ? 'card' : 'cards'}`
  return `From your games: ${cards(failed)} failed and ${cards(s.created)} new, due now.`
}

const progressMessage = (p: SyncProgress) => `Fetching ${p.month} (${p.index} of ${p.total})…`

const isAbort = (err: unknown) => err instanceof DOMException && err.name === 'AbortError'
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

type ColorFilter = 'both' | GameRow['color']

const RESULT_LABEL: Record<GameRow['result'], string> = { win: 'Won', loss: 'Lost', draw: 'Draw' }

/** Import chess.com games and show where each one left the repertoire. */
export function ImportPage({ db: dbProp, client: clientProp, gradeReply }: ImportPageProps) {
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
  const repertoires = useLiveQuery(() => loadAllRepertoires(db), [db])

  const matches = useMemo(() => {
    const out = new Map<string, GameMatch | undefined>()
    if (!repertoires) return out
    for (const g of games ?? []) out.set(g.id, matchGame(g.sans, g.color, repertoires))
    return out
  }, [games, repertoires])
  const repName = (id: string) => repertoires?.find((r) => r.id === id)?.name ?? ''

  /** Fails and creates cards from games not checked yet (T5.4). */
  async function checkCards(signal: AbortSignal): Promise<AutoCardSummary> {
    const all = await db.games.where('username').equals(user).toArray()
    const reps = await loadAllRepertoires(db)
    const found = new Map(all.map((g) => [g.id, matchGame(g.sans, g.color, reps)]))
    return applyAutoCards(db, all, {
      gradeReply: gradeReply ?? engineReplyGrader(db),
      matches: found,
      signal,
      onProgress: (done, total) =>
        setStatus({ kind: 'busy', message: `Checking games for cards (${done} of ${total})…` }),
    })
  }

  /** Runs one action with a cancel button; `steps` return the lines to report. */
  async function run(steps: (signal: AbortSignal) => Promise<string[]>) {
    if (!user || status.kind === 'busy') return
    const controller = new AbortController()
    abort.current = controller
    setStatus({ kind: 'busy', message: 'Starting…' })
    try {
      const lines = await steps(controller.signal)
      setStatus({ kind: 'done', message: lines.join(' ') })
    } catch (err) {
      if (isAbort(err))
        setStatus({ kind: 'done', message: 'Cancelled. Work already done is kept.' })
      else setStatus({ kind: 'error', message: errorText(err) })
    }
  }

  function onSync(e: FormEvent) {
    e.preventDefault()
    run(async (signal) => {
      await updateSettings(db, { importer: { username: user } })
      setStatus({ kind: 'busy', message: 'Listing archives…' })
      const synced = await syncGames(db, clientProp ?? getChesscomClient(), user, {
        signal,
        onProgress: (p) => setStatus({ kind: 'busy', message: progressMessage(p) }),
      })
      try {
        return [syncMessage(synced), cardsMessage(await checkCards(signal))]
      } catch (err) {
        if (isAbort(err)) throw err
        return [syncMessage(synced), `Checking games for cards failed: ${errorText(err)}`]
      }
    })
  }

  const onCheck = () => run(async (signal) => [cardsMessage(await checkCards(signal))])

  const busy = status.kind === 'busy'
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
              disabled={username === undefined || busy}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <button type="submit" className="import__primary" disabled={!user || busy}>
            Sync
          </button>
          <button type="button" disabled={!user || busy} onClick={onCheck}>
            Check games for cards
          </button>
          {busy && (
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
        {status.kind === 'busy' && <p role="status">{status.message}</p>}
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
                <DeviationCell
                  match={matches.get(g.id)}
                  sans={g.sans}
                  repName={repName}
                  cards={g.cards}
                />
              </li>
            ))}
          </ol>
        </section>
      )}
    </main>
  )
}

const CARD_BADGE: Record<NonNullable<GameRow['cards']>['outcome'], string | undefined> = {
  failed: 'card failed',
  created: 'new card',
  none: undefined,
}

function DeviationCell({
  match,
  sans,
  repName,
  cards,
}: {
  match: GameMatch | undefined
  sans: readonly string[]
  repName: (id: string) => string
  cards: GameRow['cards']
}) {
  const badge = cards && CARD_BADGE[cards.outcome]
  if (!match) return <span className="import__muted">No repertoire for this color</span>
  const d = match.deviation
  return (
    <span className={`import__dev import__dev--${d.kind}`} data-ply={d.ply}>
      {describeDeviation(d, sans)}
      {d.kind !== 'outside' && (
        <span className="import__muted"> · {repName(match.repertoireId)}</span>
      )}
      {badge && <span className="import__badge">{badge}</span>}
    </span>
  )
}
