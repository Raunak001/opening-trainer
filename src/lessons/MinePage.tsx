import { useEffect, useRef, useState } from 'react'
import { getDb, getSettings, type TrainerDB } from '../db'
import { dexieEvalCache } from '../engine/evalCache'
import type { Engine } from '../engine/engine'
import { formatScore } from '../engine/explain'
import { getSharedEngine } from '../engine/shared'
import { filterGames } from '../importer/games'
import { formatMoves } from '../importer/gaps'
import {
  getExplorerClient,
  type ExplorerClient,
  type RatingBucket,
  type Speed,
} from '../repertoire/explorer'
import {
  bucketsInBand,
  bucketUpperLabel,
  parseStartMoves,
  RATING_BUCKETS,
  SPEED_LABELS,
  SPEEDS,
} from '../repertoire/builderForm'
import { formatGames } from '../repertoire/treeView'
import { CONCEPTS, type KnownConcept } from './lesson'
import {
  DEFAULT_MINE_EXPLORER,
  mineExplorer,
  mineGames,
  type MinedCandidate,
  type MineSource,
} from './mining'
import { verifyCandidates, type Verdict } from './verify'
import './lessons.css'

export interface MinePageProps {
  db?: TrainerDB
  /** Explorer client; defaults to the app's cached one. */
  client?: ExplorerClient
  /** Engine for the Stockfish check; defaults to the app's shared one. */
  engine?: () => Engine
  /** Open a candidate in the authoring tool. */
  onOpen?: (candidate: MinedCandidate) => void
}

const ALL_CONCEPTS = Object.keys(CONCEPTS) as KnownConcept[]
/** Results shown per concept. */
export const SHOWN_PER_CONCEPT = 10
/** Candidates the Stockfish check may look at per concept before giving up. */
export const MAX_CHECKS_PER_CONCEPT = 30

type Result = MinedCandidate & { verdict?: Verdict }

type Status =
  | { kind: 'idle' }
  | { kind: 'busy'; message: string }
  | { kind: 'done'; message: string }
  | { kind: 'error'; message: string }

function percent(part: number, whole: number) {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : '0%'
}

/** Find concept positions in your games or the explorer, then open them in the authoring tool. */
export function MinePage({ db: dbProp, client: clientProp, engine, onOpen }: MinePageProps) {
  const db = dbProp ?? getDb()
  const [source, setSource] = useState<MineSource>('games')
  const [concepts, setConcepts] = useState<KnownConcept[]>(ALL_CONCEPTS)
  const [speeds, setSpeeds] = useState<Speed[]>(['blitz', 'rapid'])
  const [ratingMin, setRatingMin] = useState<RatingBucket>(1600)
  const [ratingMax, setRatingMax] = useState<RatingBucket>(1800)
  const [startMoves, setStartMoves] = useState('')
  const [check, setCheck] = useState(true)
  const [results, setResults] = useState<Result[]>()
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const abort = useRef<AbortController>(undefined)

  useEffect(() => () => abort.current?.abort(), [])

  const toggle = <T,>(list: T[], item: T) =>
    list.includes(item) ? list.filter((x) => x !== item) : [...list, item]

  const run = async () => {
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    setResults(undefined)
    try {
      const settings = await getSettings(db)
      let found: MinedCandidate[]
      let summary: string
      if (source === 'games') {
        setStatus({ kind: 'busy', message: 'Reading your games…' })
        const user = settings.importer.username.trim().toLowerCase()
        if (!user) {
          setStatus({
            kind: 'error',
            message: 'No chess.com username yet: sync games on the Import page.',
          })
          return
        }
        const games = filterGames(await db.games.where('username').equals(user).toArray(), {
          timeClasses: settings.importer.timeClasses,
        })
        found = mineGames(games, { concepts })
        summary = `${games.length} games`
      } else {
        const parsed = parseStartMoves(startMoves)
        if (!parsed.ok) {
          setStatus({ kind: 'error', message: parsed.error })
          return
        }
        setStatus({ kind: 'busy', message: 'Walking the explorer…' })
        let walked = 0
        found = await mineExplorer(clientProp ?? getExplorerClient(), {
          ...DEFAULT_MINE_EXPLORER,
          concepts,
          speeds,
          ratings: bucketsInBand(ratingMin, ratingMax),
          startMoves: parsed.sans,
          signal: controller.signal,
          onProgress: ({ positions, found: n }) => {
            walked = positions
            setStatus({ kind: 'busy', message: `Explorer: ${positions} positions, ${n} found…` })
          },
        })
        summary = `${walked} explorer positions`
      }

      if (!check) {
        setResults(found)
        setStatus({ kind: 'done', message: `${summary}: ${found.length} candidates.` })
        return
      }
      let instance: Engine
      try {
        instance = (engine ?? getSharedEngine)()
      } catch (error) {
        setResults(found)
        setStatus({
          kind: 'error',
          message: `${summary}: ${found.length} candidates, not checked (${(error as Error).message}).`,
        })
        return
      }
      const { mineDepth, acceptWithinCp } = settings.lessons
      const verified = await verifyCandidates(instance, dexieEvalCache(db), found, {
        depth: mineDepth,
        withinCp: acceptWithinCp,
        wantPerConcept: SHOWN_PER_CONCEPT,
        maxChecksPerConcept: MAX_CHECKS_PER_CONCEPT,
        signal: controller.signal,
        onProgress: (n) =>
          setStatus({ kind: 'busy', message: `Stockfish: checked ${n} of ${found.length}…` }),
      })
      setResults(verified)
      setStatus({
        kind: 'done',
        message: `${summary}: ${found.length} candidates, ${verified.length} pass the Stockfish check.`,
      })
    } catch (error) {
      const name = (error as Error).name
      if (name === 'AbortError' || name === 'SearchCancelledError')
        setStatus({ kind: 'done', message: 'Cancelled.' })
      else setStatus({ kind: 'error', message: String((error as Error).message ?? error) })
    }
  }

  const busy = status.kind === 'busy'
  const canRun =
    !busy &&
    concepts.length > 0 &&
    (source === 'games' || (speeds.length > 0 && ratingMin <= ratingMax))

  return (
    <div className="lessons">
      <section className="lessons__panel" aria-label="Mine positions">
        <h1>Mine positions</h1>
        <p className="lessons__muted">
          Finds positions where a concept move was there and was missed. The Stockfish check keeps
          only those where a concept move is close to best; open one in the authoring tool to write
          the lesson.
        </p>
        <fieldset className="mine__fieldset">
          <legend>Source</legend>
          <label className="mine__check">
            <input
              type="radio"
              name="source"
              checked={source === 'games'}
              onChange={() => setSource('games')}
            />
            Your imported games
          </label>
          <label className="mine__check">
            <input
              type="radio"
              name="source"
              checked={source === 'explorer'}
              onChange={() => setSource('explorer')}
            />
            Lichess explorer
          </label>
        </fieldset>
        <fieldset className="mine__fieldset">
          <legend>Concepts</legend>
          {ALL_CONCEPTS.map((c) => (
            <label key={c} className="mine__check">
              <input
                type="checkbox"
                checked={concepts.includes(c)}
                onChange={() => setConcepts((l) => toggle(l, c))}
              />
              {CONCEPTS[c].label}
            </label>
          ))}
        </fieldset>
        {source === 'explorer' && (
          <fieldset className="mine__fieldset">
            <legend>Explorer</legend>
            {SPEEDS.map((s) => (
              <label key={s} className="mine__check">
                <input
                  type="checkbox"
                  checked={speeds.includes(s)}
                  onChange={() => setSpeeds((l) => toggle(l, s))}
                />
                {SPEED_LABELS[s]}
              </label>
            ))}
            <div className="author__row">
              <label>
                Rating from
                <select
                  value={ratingMin}
                  onChange={(e) => setRatingMin(Number(e.target.value) as RatingBucket)}
                >
                  {RATING_BUCKETS.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Rating to
                <select
                  value={ratingMax}
                  onChange={(e) => setRatingMax(Number(e.target.value) as RatingBucket)}
                >
                  {RATING_BUCKETS.map((b) => (
                    <option key={b} value={b}>
                      {bucketUpperLabel(b)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Start moves
                <input
                  value={startMoves}
                  placeholder="e.g. e4 e5"
                  onChange={(e) => setStartMoves(e.target.value)}
                />
              </label>
            </div>
            <p className="lessons__muted">
              Follows moves played in at least {DEFAULT_MINE_EXPLORER.minShare * 100}% of games, up
              to {DEFAULT_MINE_EXPLORER.maxPly} plies and {DEFAULT_MINE_EXPLORER.maxPositions}{' '}
              positions. Requests are cached.
            </p>
          </fieldset>
        )}
        <label className="mine__check">
          <input type="checkbox" checked={check} onChange={() => setCheck((c) => !c)} />
          Check with Stockfish (slower; evals are cached)
        </label>
        <div className="author__row">
          <button type="button" onClick={() => void run()} disabled={!canRun}>
            Find positions
          </button>
          {busy && (
            <button type="button" onClick={() => abort.current?.abort()}>
              Cancel
            </button>
          )}
        </div>
        {status.kind !== 'idle' && (
          <p className={status.kind === 'error' ? 'author__error' : 'lessons__muted'} role="status">
            {status.message}
          </p>
        )}
      </section>

      {results &&
        concepts.map((concept) => {
          const own = results.filter((r) => r.concept === concept)
          return (
            <section key={concept} className="lessons__panel" aria-label={CONCEPTS[concept].label}>
              <h2>
                {CONCEPTS[concept].label} ({own.length})
              </h2>
              {own.length === 0 ? (
                <p className="lessons__muted">Nothing found.</p>
              ) : (
                <ol className="mine__results">
                  {own.slice(0, SHOWN_PER_CONCEPT).map((r) => (
                    <li key={r.id}>
                      <div>
                        <div>{r.line.length > 0 ? formatMoves(r.line) : 'Start position'}</div>
                        <div className="lessons__muted">
                          Concept moves: {r.moves.join(', ')} · missed in {formatGames(r.missed)} of{' '}
                          {formatGames(r.reached)} games ({percent(r.missed, r.reached)}) · played
                          instead:{' '}
                          {r.playedInstead
                            .slice(0, 3)
                            .map(([san, n]) => `${san} (${formatGames(n)})`)
                            .join(', ')}
                        </div>
                        {r.verdict && <VerdictLine verdict={r.verdict} />}
                      </div>
                      {onOpen && (
                        <button type="button" onClick={() => onOpen(r)}>
                          Open in Author
                        </button>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          )
        })}
    </div>
  )
}

/** "Stockfish: best d4 (+0.4) · d4 best, f4 −85cp" */
function VerdictLine({ verdict }: { verdict: Verdict }) {
  const moves = verdict.moves
    .map((m) => (m.lossCp === 0 ? `${m.san} best` : `${m.san} −${m.lossCp}cp`))
    .join(', ')
  return (
    <div className="lessons__muted">
      Stockfish: best {verdict.bestSan ?? '—'} ({formatScore(verdict.bestScore)} for the side to
      move) · {moves}
    </div>
  )
}
