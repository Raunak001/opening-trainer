import { useLiveQuery } from 'dexie-react-hooks'
import { getDb, type TrainerDB } from '../db'
import { puzzleStats, themeLabel } from './stats'

export interface PuzzleHistoryProps {
  db?: TrainerDB
  onSolve?: () => void
}

/** Rating graph, totals, themes and recent attempts. */
export function PuzzleHistory({ db = getDb(), onSolve }: PuzzleHistoryProps) {
  const attempts = useLiveQuery(() => db.puzzleAttempts.orderBy('at').toArray(), [db])
  if (!attempts) return <div className="puzzles__message">Loading…</div>
  if (attempts.length === 0)
    return (
      <div className="puzzles__message">
        <p>No puzzles solved yet. Your rating starts at 1000.</p>
        {onSolve && (
          <button type="button" className="puzzles__cta" onClick={onSolve}>
            Solve puzzles
          </button>
        )}
      </div>
    )

  const stats = puzzleStats(attempts)
  const recent = [...attempts].reverse().slice(0, 25)
  const tiles: [string, string][] = [
    ['Rating', String(Math.round(stats.rating))],
    ['Peak', String(Math.round(stats.peak))],
    ['Solved', `${stats.solved} / ${stats.attempts}`],
    ['Success', `${Math.round(stats.successRate * 100)}%`],
    ['Streak', `${stats.streak} (best ${stats.bestStreak})`],
  ]

  return (
    <section className="puzzle-history" aria-label="Puzzle history">
      <div className="puzzle-history__tiles">
        {tiles.map(([label, value]) => (
          <div key={label} className="puzzle-history__tile">
            <span className="puzzle-history__tile-label">{label}</span>
            <span className="puzzle-history__tile-value">{value}</span>
          </div>
        ))}
      </div>

      <div className="puzzle-history__card">
        <h3>Rating</h3>
        <RatingChart history={stats.history} />
      </div>

      <div className="puzzle-history__columns">
        <div className="puzzle-history__card">
          <h3>Themes</h3>
          <table className="puzzle-history__table">
            <thead>
              <tr>
                <th>Theme</th>
                <th>Tried</th>
                <th>Solved</th>
              </tr>
            </thead>
            <tbody>
              {stats.themes.slice(0, 12).map((t) => (
                <tr key={t.theme}>
                  <td>{themeLabel(t.theme)}</td>
                  <td>{t.attempts}</td>
                  <td>{Math.round((t.solved / t.attempts) * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="puzzle-history__card">
          <h3>Recent</h3>
          <table className="puzzle-history__table">
            <thead>
              <tr>
                <th>When</th>
                <th>Puzzle</th>
                <th>Result</th>
                <th>Rating</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((a) => {
                const delta = Math.round(a.ratingAfter) - Math.round(a.ratingBefore)
                return (
                  <tr key={a.id}>
                    <td>{a.at.toLocaleDateString()}</td>
                    <td>{a.puzzleRating}</td>
                    <td className={a.solved ? 'puzzle-history__win' : 'puzzle-history__loss'}>
                      {a.solved ? 'Solved' : 'Failed'}
                    </td>
                    <td>
                      {Math.round(a.ratingAfter)}{' '}
                      <span className={delta >= 0 ? 'puzzle-history__win' : 'puzzle-history__loss'}>
                        ({delta >= 0 ? `+${delta}` : delta})
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}

const W = 600
const H = 160
const PAD = 28

/** Line chart of the rating after each attempt. */
function RatingChart({ history }: { history: number[] }) {
  const min = Math.floor(Math.min(...history) / 50) * 50
  const max = Math.ceil(Math.max(...history) / 50) * 50 || min + 50
  const span = Math.max(50, max - min)
  const x = (i: number) => PAD + (i / Math.max(1, history.length - 1)) * (W - PAD - 8)
  const y = (r: number) => 8 + (1 - (r - min) / span) * (H - 24)
  const points = history.map((r, i) => `${x(i).toFixed(1)},${y(r).toFixed(1)}`).join(' ')
  return (
    <svg
      className="puzzle-history__chart"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Rating over ${history.length - 1} puzzles, from ${Math.round(history[0])} to ${Math.round(history[history.length - 1])}`}
    >
      {[min, min + span / 2, min + span].map((r) => (
        <g key={r}>
          <line x1={PAD} x2={W - 8} y1={y(r)} y2={y(r)} className="puzzle-history__grid" />
          <text x={PAD - 4} y={y(r) + 4} textAnchor="end" className="puzzle-history__axis">
            {Math.round(r)}
          </text>
        </g>
      ))}
      <polyline points={points} className="puzzle-history__line" />
      <circle
        cx={x(history.length - 1)}
        cy={y(history[history.length - 1])}
        r={4}
        className="puzzle-history__dot"
      />
    </svg>
  )
}
