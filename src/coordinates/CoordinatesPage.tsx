import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import {
  getDb,
  getSettings,
  type CoordDrill,
  type CoordRunRow,
  type DrillMode,
  type TrainerDB,
} from '../db'
import { TrainerLayout } from '../trainer/TrainerLayout'
import { CoordBoard } from './CoordBoard'
import { Heatmap } from './Heatmap'
import { MoveDrill } from './MoveDrill'
import { SquareDrill } from './SquareDrill'
import { bestRuns, runKey } from './store'
import type { View } from './squares'
import { VisualizeDrill } from './VisualizeDrill'
import './coordinates.css'

const DRILLS: { id: CoordDrill; name: string; blurb: string }[] = [
  { id: 'find', name: 'Find the square', blurb: 'A square name appears: click it. Timed.' },
  { id: 'name', name: 'Name the square', blurb: 'A square lights up: type its name. Timed.' },
  {
    id: 'move',
    name: 'Play the move',
    blurb: 'Play a move like Nf3 from your courses, no labels on the board.',
  },
  {
    id: 'visualize',
    name: 'Visualize',
    blurb: 'Square colours, diagonals and piece moves, without looking.',
  },
]

const VIEWS: { id: View; label: string }[] = [
  { id: 'white', label: 'White' },
  { id: 'black', label: 'Black' },
]

type Tab = 'train' | 'stats'

/** Board vision drills (Phase 10): learn square names until they are automatic. */
export function CoordinatesPage({ db: dbProp }: { db?: TrainerDB }) {
  const db = dbProp ?? getDb()
  const [tab, setTab] = useState<Tab>('train')
  return (
    <div className="coordinates">
      <nav className="app-nav app-nav--sub" aria-label="Coordinates">
        {(
          [
            ['train', 'Train'],
            ['stats', 'Stats'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-current={tab === id ? 'page' : undefined}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      {tab === 'train' ? <Train db={db} /> : <CoordStats db={db} />}
    </div>
  )
}

function ViewToggle({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  return (
    <div className="coord-toggle" role="group" aria-label="Board side">
      {VIEWS.map((v) => (
        <button
          key={v.id}
          type="button"
          aria-pressed={view === v.id}
          onClick={() => onChange(v.id)}
        >
          {v.label}
        </button>
      ))}
    </div>
  )
}

function Train({ db }: { db: TrainerDB }) {
  const [drill, setDrill] = useState<CoordDrill>('find')
  const [view, setView] = useState<View>('white')
  // Bumped per round: remounts the drill for "Play again".
  const [round, setRound] = useState(0)
  const [running, setRunning] = useState(false)
  // Best run before the current round, so the summary can tell a new best.
  const [bestBefore, setBestBefore] = useState<CoordRunRow>()
  const settings = useLiveQuery(() => getSettings(db), [db])
  const runs = useLiveQuery(() => db.coordRuns.toArray(), [db])
  if (!settings || !runs) return <p className="coord-muted coord-loading">Loading…</p>

  const best = bestRuns(runs).get(runKey(drill, view))
  const start = () => {
    setBestBefore(best)
    setRound((r) => r + 1)
    setRunning(true)
  }
  const common = {
    db,
    view,
    best: bestBefore,
    onAgain: start,
    onQuit: () => setRunning(false),
  }

  if (running) {
    if (drill === 'find' || drill === 'name')
      return (
        <SquareDrill
          key={round}
          {...common}
          mode={drill}
          seconds={settings.coordinates.roundSeconds}
        />
      )
    if (drill === 'move')
      return <MoveDrill key={round} {...common} questions={settings.coordinates.questions} />
    return <VisualizeDrill key={round} {...common} questions={settings.coordinates.questions} />
  }

  const timed = drill === 'find' || drill === 'name'
  return (
    <TrainerLayout className="coord-layout">
      <CoordBoard view={view} />
      <aside className="side-panel coord-panel">
        <header className="coord-panel__head">
          <span className="coord-panel__title">Coordinates</span>
        </header>
        <div className="coord-drills" role="radiogroup" aria-label="Drill">
          {DRILLS.map((d) => (
            <button
              key={d.id}
              type="button"
              role="radio"
              aria-checked={drill === d.id}
              className="coord-drill"
              onClick={() => setDrill(d.id)}
            >
              <span className="coord-drill__name">{d.name}</span>
              <span className="coord-muted">{d.blurb}</span>
              <span className="coord-drill__best">
                Best: W {bestRuns(runs).get(runKey(d.id, 'white'))?.correct ?? '–'} · B{' '}
                {bestRuns(runs).get(runKey(d.id, 'black'))?.correct ?? '–'}
              </span>
            </button>
          ))}
        </div>
        <ViewToggle view={view} onChange={setView} />
        <p className="coord-muted">
          {timed
            ? `${settings.coordinates.roundSeconds} seconds. Squares you miss or answer slowly come up more often.`
            : drill === 'move'
              ? `${settings.coordinates.questions} positions with ${view === 'white' ? 'White' : 'Black'} to move.`
              : `${settings.coordinates.questions} questions.`}
          {best ? ` Your best: ${best.correct}.` : ''}
        </p>
        <div className="coord-actions">
          <button type="button" className="coord-primary" onClick={start}>
            Start
          </button>
        </div>
      </aside>
    </TrainerLayout>
  )
}

const MODE_FILTERS: { id: 'all' | DrillMode; label: string }[] = [
  { id: 'all', label: 'Both drills' },
  { id: 'find', label: 'Find' },
  { id: 'name', label: 'Name' },
]

const DRILL_NAMES = Object.fromEntries(DRILLS.map((d) => [d.id, d.name])) as Record<
  CoordDrill,
  string
>

/** Square heatmap, best scores and recent rounds. */
export function CoordStats({ db }: { db: TrainerDB }) {
  const [view, setView] = useState<View>('white')
  const [mode, setMode] = useState<'all' | DrillMode>('all')
  const rows = useLiveQuery(() => db.coordStats.toArray(), [db])
  const runs = useLiveQuery(() => db.coordRuns.orderBy('at').reverse().toArray(), [db])
  if (!rows || !runs) return <p className="coord-muted coord-loading">Loading…</p>
  const best = bestRuns(runs)
  return (
    <main className="coord-stats">
      <section className="coord-card">
        <h2>Squares</h2>
        <div className="coord-stats__controls">
          <ViewToggle view={view} onChange={setView} />
          <div className="coord-toggle" role="group" aria-label="Drill">
            {MODE_FILTERS.map((m) => (
              <button
                key={m.id}
                type="button"
                aria-pressed={mode === m.id}
                onClick={() => setMode(m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
        <Heatmap rows={rows} view={view} modes={mode === 'all' ? undefined : [mode]} />
      </section>
      <section className="coord-card">
        <h2>Best rounds</h2>
        <table className="coord-table">
          <thead>
            <tr>
              <th>Drill</th>
              <th>White</th>
              <th>Black</th>
            </tr>
          </thead>
          <tbody>
            {DRILLS.map((d) => (
              <tr key={d.id}>
                <td>{d.name}</td>
                <td>{best.get(runKey(d.id, 'white'))?.correct ?? '–'}</td>
                <td>{best.get(runKey(d.id, 'black'))?.correct ?? '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h2>Recent rounds</h2>
        {runs.length === 0 ? (
          <p className="coord-muted">No rounds yet.</p>
        ) : (
          <ul className="coord-runs">
            {runs.slice(0, 12).map((r) => (
              <li key={r.id}>
                <span>{DRILL_NAMES[r.drill]}</span>
                <span className="coord-muted">{r.view === 'white' ? 'White' : 'Black'}</span>
                <span>
                  {r.correct} ✓ {r.wrong} ✗
                </span>
                <span className="coord-muted">{r.at.toLocaleDateString()}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
