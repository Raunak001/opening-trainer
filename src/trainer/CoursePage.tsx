import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import { State } from 'ts-fsrs'
import { getDb, type TrainerDB } from '../db'
import type { BuildProgress } from '../repertoire/builder'
import { formatLine } from '../repertoire/builderForm'
import { catalogEntry, type CatalogEntry } from '../repertoire/catalog'
import { buildCourse, TIER_ORDER, TIERS, type CourseTier } from '../repertoire/courses'
import { getExplorerClient, type ExplorerClient } from '../repertoire/explorer'
import { lineCards, lineName, type CourseLine } from '../repertoire/lines'
import { loadOpeningIndex, type OpeningIndex } from '../repertoire/openings'
import type { PositionKey } from '../repertoire/positionKey'
import { loadCourse, type CourseDetail, type LineWithStatus } from './courseData'
import { LearnView } from './LearnView'
import { LinePreview } from './LinePreview'
import { ReviewPage } from './ReviewPage'
import './library.css'

export interface CoursePageProps {
  entryId: string
  /** Back to the library. */
  onBack: () => void
  db?: TrainerDB
  client?: ExplorerClient
}

type Build =
  | { kind: 'idle' }
  | { kind: 'building'; tier: CourseTier; progress?: BuildProgress }
  | { kind: 'done'; positions: number; cards: number }
  | { kind: 'cancelled' }
  | { kind: 'error'; message: string }

type Mode = { kind: 'overview' } | { kind: 'learn'; lineId: PositionKey } | { kind: 'practice' }

const STATUS_LABEL = { new: 'New', learning: 'Relearning', learned: 'Learned' } as const

function useOpenings(): OpeningIndex | undefined {
  const [openings, setOpenings] = useState<OpeningIndex>()
  useEffect(() => {
    let live = true
    loadOpeningIndex().then((index) => live && setOpenings(index))
    return () => {
      live = false
    }
  }, [])
  return openings
}

function displayName(line: CourseLine, openings: OpeningIndex | undefined, fallback: string) {
  return (openings && lineName(line.positions, openings)) ?? fallback
}

/** One catalog entry's course: start it at a tier, see its lines, learn and practise them. */
export function CoursePage({ entryId, onBack, db: dbProp, client: clientProp }: CoursePageProps) {
  const db = dbProp ?? getDb()
  const entry = catalogEntry(entryId)
  // null: not started. undefined: still loading.
  const detail = useLiveQuery(
    () => loadCourse(db, entryId, new Date()).then((d) => d ?? null),
    [db, entryId],
  )
  const openings = useOpenings()
  const [mode, setMode] = useState<Mode>({ kind: 'overview' })
  const [build, setBuild] = useState<Build>({ kind: 'idle' })
  const abortRef = useRef<AbortController | null>(null)
  useEffect(() => () => abortRef.current?.abort(), [])

  if (!entry) return <p className="course__muted">No such opening.</p>

  async function start(tier: CourseTier) {
    if (!entry) return
    const controller = new AbortController()
    abortRef.current = controller
    setBuild({ kind: 'building', tier })
    try {
      const { repertoire, cards } = await buildCourse(db, entry, tier, {
        client: clientProp ?? getExplorerClient(),
        signal: controller.signal,
        onProgress: (progress) => setBuild({ kind: 'building', tier, progress }),
      })
      setBuild({
        kind: 'done',
        positions: Object.keys(repertoire.tree.nodes).length,
        cards: cards.added + cards.reset + cards.resumed + cards.unchanged,
      })
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') setBuild({ kind: 'cancelled' })
      else setBuild({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
    } finally {
      abortRef.current = null
    }
  }
  const cancel = () => abortRef.current?.abort()

  if (detail && mode.kind === 'learn') {
    const line = detail.lines.find((l) => l.id === mode.lineId)
    if (line) {
      const newCards = new Set(
        lineCards(line, detail.cards)
          .filter((c) => c.state === State.New)
          .map((c) => c.positionKey),
      )
      return (
        <LearnView
          // A fresh session per line.
          key={line.id}
          db={db}
          repertoireId={detail.repertoire.id}
          side={detail.repertoire.color}
          tree={detail.repertoire.tree}
          line={{ ...line, name: displayName(line, openings, entry.name) }}
          newCards={newCards}
          openings={openings}
          onExit={() => setMode({ kind: 'overview' })}
          onNext={() => {
            // The live query has the saved reviews by the time the button shows.
            if (detail.next.line && detail.next.line.id !== line.id)
              setMode({ kind: 'learn', lineId: detail.next.line.id })
            else setMode({ kind: 'overview' })
          }}
        />
      )
    }
  }

  if (detail && mode.kind === 'practice')
    return (
      <ReviewPage
        db={db}
        repertoireId={detail.repertoire.id}
        onExit={() => setMode({ kind: 'overview' })}
      />
    )

  return (
    <main className="course" aria-label={entry.name}>
      <button type="button" className="course__back" onClick={onBack}>
        ‹ Library
      </button>
      <section className="course__panel">
        <header className="course__header">
          <div>
            <h1>{entry.name}</h1>
            <p className="course__muted">
              {entry.color === 'white' ? 'White' : 'Black'} · {formatLine(entry.startMoves)}
            </p>
          </div>
        </header>
        <p>{entry.blurb}</p>
        {detail === undefined ? (
          <p className="course__muted">Loading…</p>
        ) : detail === null ? (
          <TierPicker
            entry={entry}
            build={build}
            onStart={start}
            onCancel={cancel}
            action="Start course"
          />
        ) : (
          <CourseOverview
            detail={detail}
            entry={entry}
            openings={openings}
            build={build}
            onRebuild={start}
            onCancel={cancel}
            onLearn={(lineId) => setMode({ kind: 'learn', lineId })}
            onPractice={() => setMode({ kind: 'practice' })}
          />
        )}
      </section>
      {detail && (
        <LineList
          lines={detail.lines}
          entry={entry}
          openings={openings}
          onLearn={(lineId) => setMode({ kind: 'learn', lineId })}
        />
      )}
    </main>
  )
}

function TierPicker({
  entry,
  build,
  onStart,
  onCancel,
  action,
  initial = 'essentials',
}: {
  entry: CatalogEntry
  build: Build
  onStart: (tier: CourseTier) => void
  onCancel: () => void
  action: string
  initial?: CourseTier
}) {
  const [tier, setTier] = useState<CourseTier>(initial)
  const building = build.kind === 'building'
  return (
    <div>
      <fieldset className="course__tiers" disabled={building} aria-label="Depth">
        {TIER_ORDER.map((t) => (
          <label key={t} className={`course__tier${t === tier ? ' is-selected' : ''}`}>
            <input
              type="radio"
              name={`tier-${entry.id}`}
              value={t}
              checked={t === tier}
              onChange={() => setTier(t)}
            />
            <strong>{TIERS[t].label}</strong>
            <span>{TIERS[t].description}</span>
          </label>
        ))}
      </fieldset>
      <div className="course__actions">
        {building ? (
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        ) : (
          <button type="button" className="course__primary" onClick={() => onStart(tier)}>
            {action}
          </button>
        )}
      </div>
      <BuildStatus build={build} />
    </div>
  )
}

function BuildStatus({ build }: { build: Build }) {
  let text: string
  switch (build.kind) {
    case 'idle':
      return null
    case 'building':
      text = build.progress
        ? `Building from the Lichess explorer… ${build.progress.positions} positions, ${build.progress.queued} to look up. Rate limits can pause this for a minute.`
        : 'Building from the Lichess explorer…'
      break
    case 'done':
      text = `Built: ${build.positions} positions, ${build.cards} cards.`
      break
    case 'cancelled':
      text = 'Build cancelled. Nothing was changed.'
      break
    case 'error':
      text = `Build failed: ${build.message}`
      break
  }
  return (
    <p
      className={`course__status${build.kind === 'error' ? ' course__status--error' : ''}`}
      role="status"
    >
      {text}
    </p>
  )
}

function CourseOverview({
  detail,
  entry,
  openings,
  build,
  onRebuild,
  onCancel,
  onLearn,
  onPractice,
}: {
  detail: CourseDetail
  entry: CatalogEntry
  openings: OpeningIndex | undefined
  build: Build
  onRebuild: (tier: CourseTier) => void
  onCancel: () => void
  onLearn: (lineId: PositionKey) => void
  onPractice: () => void
}) {
  const [changing, setChanging] = useState(false)
  const { counts, next, repertoire } = detail
  const tier = repertoire.tier ?? 'essentials'
  const building = build.kind === 'building'
  return (
    <>
      <p className="course__stats">
        <span>
          Depth <strong>{TIERS[tier].label}</strong>
        </span>
        <span>
          <strong>{counts.learned}</strong>/{counts.lines} lines learned
        </span>
        {counts.learning > 0 && (
          <span>
            <strong>{counts.learning}</strong> to relearn
          </span>
        )}
        <span>
          <strong>{counts.due}</strong> due
        </span>
      </p>
      <div className="course__actions" style={{ marginTop: 12 }}>
        <button
          type="button"
          className="course__primary"
          disabled={!next.line || building}
          onClick={() => next.line && onLearn(next.line.id)}
        >
          {next.line
            ? `Learn: ${displayName(next.line, openings, entry.name)}`
            : next.reason === 'cap'
              ? 'Learn (daily new-card limit reached)'
              : 'Learn (all lines learned)'}
        </button>
        <button type="button" disabled={counts.due === 0 || building} onClick={onPractice}>
          {counts.due > 0 ? `Practice (${counts.due} due)` : 'Practice (nothing due)'}
        </button>
        {!changing && !building && (
          <button type="button" onClick={() => setChanging(true)}>
            Change depth
          </button>
        )}
      </div>
      {(changing || building) && (
        <TierPicker
          entry={entry}
          build={build}
          initial={tier}
          onStart={(t) => {
            setChanging(false)
            onRebuild(t)
          }}
          onCancel={onCancel}
          action="Rebuild at this depth"
        />
      )}
      {!changing && !building && <BuildStatus build={build} />}
    </>
  )
}

function LineList({
  lines,
  entry,
  openings,
  onLearn,
}: {
  lines: readonly LineWithStatus[]
  entry: CatalogEntry
  openings: OpeningIndex | undefined
  onLearn: (lineId: PositionKey) => void
}) {
  const [preview, setPreview] = useState<PositionKey>()
  return (
    <section className="course__panel" aria-label="Lines">
      <h2 style={{ margin: 0, fontSize: 17 }}>Lines ({lines.length}), most common first</h2>
      {lines.length === 0 ? (
        <p className="course__muted">No lines: the explorer had no games here.</p>
      ) : (
        <ol className="course__lines">
          {lines.map((line) => {
            const name = displayName(line, openings, entry.name)
            const open = preview === line.id
            return (
              <li key={line.id} className="course__line">
                <span className="course__line-text">
                  <span className="course__line-name">{name}</span>
                  <span className="course__line-moves">{formatLine(line.moves)}</span>
                </span>
                <span className={`course__badge course__badge--${line.status}`}>
                  {STATUS_LABEL[line.status]}
                </span>
                <span className="course__actions">
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setPreview(open ? undefined : line.id)}
                  >
                    {open ? 'Hide' : 'Preview'}
                  </button>
                  <button type="button" onClick={() => onLearn(line.id)}>
                    {line.status === 'new' ? 'Learn' : 'Relearn'}
                  </button>
                </span>
                {open && (
                  <div className="course__line-preview">
                    <LinePreview moves={line.moves} orientation={entry.color} title={name} />
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
