import type { CoordRunRow } from '../db'

export interface RoundSummaryProps {
  run: Omit<CoordRunRow, 'id'>
  /** Best run before this one, if any. */
  best?: CoordRunRow
  /** Squares answered wrong this round. */
  missed: string[]
  onAgain: () => void
  onQuit: () => void
}

/** End-of-round panel: score, personal best, misses, and what next. */
export function RoundSummary({ run, best, missed, onAgain, onQuit }: RoundSummaryProps) {
  const newBest = !best || run.correct > best.correct
  return (
    <div className="coord-summary">
      <p className="coord-summary__score">{run.correct}</p>
      <p className="coord-muted">
        correct · {run.wrong} wrong · {(run.durationMs / 1000).toFixed(0)}s
      </p>
      {newBest ? (
        <p className="coord-summary__best">{best ? 'New best!' : 'First round from this side.'}</p>
      ) : (
        <p className="coord-muted">Best: {best.correct}</p>
      )}
      {missed.length > 0 && <p>Missed: {[...new Set(missed)].join(', ')}</p>}
      <div className="coord-actions">
        <button type="button" className="coord-primary" onClick={onAgain} autoFocus>
          Play again
        </button>
        <button type="button" className="coord-secondary" onClick={onQuit}>
          Change drill
        </button>
      </div>
    </div>
  )
}
