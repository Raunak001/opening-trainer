import type { CoordStatRow, DrillMode } from '../db'
import { heatmap, weakest } from './stats'
import './coordinates.css'
import { squareColor, squaresForView, type View } from './squares'

/** Red (weak) → amber → green (automatic). */
function strengthColor(strength: number): string {
  const hue = Math.round(strength * 120)
  return `hsl(${hue} 60% 42%)`
}

export interface HeatmapProps {
  rows: readonly CoordStatRow[]
  view: View
  modes?: readonly DrillMode[]
  /** Smaller variant for the Progress page. */
  compact?: boolean
}

const fmtSec = (ms: number | undefined) => (ms === undefined ? '–' : `${(ms / 1000).toFixed(1)}s`)

/** 8×8 grid coloured by how well you know each square from one side. */
export function Heatmap({ rows, view, modes, compact = false }: HeatmapProps) {
  const cells = heatmap(rows, { view, modes })
  const weak = weakest(cells, 5).filter((c) => c.strength < 0.8)
  return (
    <div className={`coord-heatmap${compact ? ' coord-heatmap--compact' : ''}`}>
      <div
        className="coord-heatmap__grid"
        role="grid"
        aria-label={`Square heatmap, ${view}'s view`}
      >
        {squaresForView(view).map((sq) => {
          const cell = cells.get(sq)
          const title = cell
            ? `${sq}: ${cell.correct}/${cell.attempts} right, ${fmtSec(cell.avgMs)} average`
            : `${sq}: not drilled yet`
          return (
            <span
              key={sq}
              role="gridcell"
              title={title}
              aria-label={title}
              className={`coord-heatmap__cell coord-heatmap__cell--${squareColor(sq)}${cell ? '' : ' coord-heatmap__cell--unseen'}`}
              style={cell ? { background: strengthColor(cell.strength) } : undefined}
            >
              {sq}
            </span>
          )
        })}
      </div>
      <p className="coord-heatmap__legend">
        <span className="coord-heatmap__swatch" style={{ background: strengthColor(0) }} /> weak
        <span className="coord-heatmap__swatch" style={{ background: strengthColor(0.5) }} /> slow
        <span className="coord-heatmap__swatch" style={{ background: strengthColor(1) }} />{' '}
        automatic
      </p>
      {cells.size === 0 ? (
        <p className="coord-muted">No answers from this side yet.</p>
      ) : weak.length > 0 ? (
        <p className="coord-muted">
          Weakest:{' '}
          {weak
            .map((c) => `${c.square} (${Math.round(c.accuracy * 100)}%, ${fmtSec(c.avgMs)})`)
            .join(', ')}
        </p>
      ) : (
        <p className="coord-muted">No weak squares from this side.</p>
      )}
    </div>
  )
}
