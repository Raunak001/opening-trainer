import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState, type ReactNode } from 'react'
import { Heatmap } from '../coordinates/Heatmap'
import { getDb, type TrainerDB } from '../db'
import { formatLine } from '../repertoire/builderForm'
import { TIERS } from '../repertoire/courses'
import { loadOpeningIndex, type OpeningIndex } from '../repertoire/openings'
import { loadProgress, type LineProgress, type RepertoireProgress } from '../srs'
import './progress.css'

export interface ProgressPageProps {
  db?: TrainerDB
  /** Shown as a "Practice all" button when there is something to study. */
  onStartReview?: () => void
}

/** Lines shown per repertoire before "Show all". */
export const LINES_SHOWN = 8

const pct = (fraction: number) => `${Math.round(fraction * 100)}%`
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** Due today, new left, streak, and mastery per line. Updates live as you study. */
export function ProgressPage({ db: dbProp, onStartReview }: ProgressPageProps) {
  const db = dbProp ?? getDb()
  const progress = useLiveQuery(() => loadProgress(db, new Date()), [db])
  const [openings, setOpenings] = useState<OpeningIndex>()

  useEffect(() => {
    let live = true
    loadOpeningIndex().then((index) => live && setOpenings(index))
    return () => {
      live = false
    }
  }, [])

  if (!progress) return <p className="progress__empty">Loading progress…</p>
  if (progress.repertoires.length === 0)
    return (
      <p className="progress__empty">
        No courses yet. Start one from the Library, then come back here.
      </p>
    )

  const { today, streak } = progress
  const overCap = today.review - today.reviewWithinCap
  const toStudy = today.learning + today.reviewWithinCap + progress.practiceNew

  return (
    <main className="progress">
      <section className="progress__tiles" aria-label="Today">
        <Tile label="Due today" value={String(today.due)}>
          {plural(today.review, 'review')} · {today.learning} learning
          {overCap > 0 && ` · ${overCap} over today's limit`}
        </Tile>
        <Tile label="New cards" value={String(today.newTotal)}>
          not yet studied
        </Tile>
        <Tile label="Streak" value={plural(streak.current, 'day')}>
          {streak.studiedToday
            ? 'Studied today'
            : streak.current > 0
              ? 'Study today to keep it'
              : 'Study today to start one'}{' '}
          · longest {streak.longest}
        </Tile>
        <Tile label="Mastery" value={pct(progress.mastery)}>
          Full marks at {progress.masteredAfterDays}+ days stability
        </Tile>
      </section>

      {onStartReview && (
        <div className="progress__actions">
          <button type="button" disabled={toStudy === 0} onClick={onStartReview}>
            {toStudy > 0 ? `Practice all (${toStudy})` : 'Nothing to practise now'}
          </button>
        </div>
      )}

      {progress.repertoires.map((rep) => (
        <RepertoireSection key={rep.id} rep={rep} openings={openings} />
      ))}

      <BoardVision db={db} />
    </main>
  )
}

/** Coordinate drill heatmaps from both sides, once there are any answers. */
function BoardVision({ db }: { db: TrainerDB }) {
  const rows = useLiveQuery(() => db.coordStats.toArray(), [db])
  if (!rows || rows.length === 0) return null
  return (
    <section className="progress__rep" aria-label="Board vision">
      <header className="progress__rep-header">
        <h2>Board vision</h2>
        <span className="progress__muted">Coordinate drills, square by square</span>
      </header>
      <div className="progress__heatmaps">
        <div>
          <h3 className="progress__sub">White at the bottom</h3>
          <Heatmap rows={rows} view="white" compact />
        </div>
        <div>
          <h3 className="progress__sub">Black at the bottom</h3>
          <Heatmap rows={rows} view="black" compact />
        </div>
      </div>
    </section>
  )
}

function Tile({ label, value, children }: { label: string; value: string; children: ReactNode }) {
  return (
    <div className="progress__tile" role="group" aria-label={label}>
      <span className="progress__tile-label">{label}</span>
      <span className="progress__tile-value">{value}</span>
      <span className="progress__muted">{children}</span>
    </div>
  )
}

function RepertoireSection({
  rep,
  openings,
}: {
  rep: RepertoireProgress
  openings: OpeningIndex | undefined
}) {
  const [showAll, setShowAll] = useState(false)
  const lines = showAll ? rep.lines : rep.lines.slice(0, LINES_SHOWN)
  return (
    <section className="progress__rep" aria-label={rep.name}>
      <header className="progress__rep-header">
        <h2>
          {rep.name}{' '}
          <span className="progress__muted">
            ({rep.color === 'white' ? 'White' : 'Black'}
            {rep.tier && ` · ${TIERS[rep.tier].label}`})
          </span>
        </h2>
        <MasteryBar value={rep.mastery} label={`${rep.name} mastery`} />
        <span className="progress__muted">
          {rep.studied}/{rep.cards} cards studied
        </span>
      </header>
      {rep.lines.length > 0 && (
        <>
          <h3 className="progress__sub">Lines, weakest first ({rep.lines.length})</h3>
          <ol className="progress__lines">
            {lines.map((line) => (
              <LineRow key={line.leafKey} line={line} openings={openings} />
            ))}
          </ol>
          {rep.lines.length > LINES_SHOWN && (
            <button type="button" className="progress__more" onClick={() => setShowAll((v) => !v)}>
              {showAll ? 'Show fewer' : `Show all ${rep.lines.length} lines`}
            </button>
          )}
        </>
      )}
    </section>
  )
}

/** The deepest named position on the line. */
function lineName(line: LineProgress, openings: OpeningIndex | undefined): string | undefined {
  if (!openings) return undefined
  for (let i = line.positions.length - 1; i >= 0; i--) {
    const opening = openings.get(line.positions[i])
    if (opening) return opening.name
  }
  return undefined
}

function LineRow({ line, openings }: { line: LineProgress; openings: OpeningIndex | undefined }) {
  const name = lineName(line, openings)
  const moves = formatLine(line.moves)
  return (
    <li className="progress__line">
      <span className="progress__line-text">
        <span className="progress__line-moves">{moves}</span>
        {name && <span className="progress__muted">{name}</span>}
      </span>
      <MasteryBar value={line.mastery} label={`${moves} mastery`} />
      <span className="progress__stat" title="Mean FSRS stability of the line's cards">
        {line.meanStability.toFixed(1)} d
      </span>
      <span className="progress__stat">
        {line.studied}/{line.cards}
      </span>
    </li>
  )
}

function MasteryBar({ value, label }: { value: number; label: string }) {
  return (
    <span className="progress__mastery">
      <span
        className="progress__bar"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value * 100)}
      >
        <span className="progress__bar-fill" style={{ width: pct(value) }} />
      </span>
      <span className="progress__stat">{pct(value)}</span>
    </span>
  )
}
