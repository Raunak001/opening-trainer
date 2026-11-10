import type { MouseEvent } from 'react'
import { KEY_MARKS, type MoveReview } from './classify'
import { MARK_STYLES } from './describe'

export interface EvalGraphProps {
  /** White's win% per position, start first. */
  whiteWin: readonly number[]
  moves: readonly MoveReview[]
  /** Current position index. */
  ply: number
  onSelect: (ply: number) => void
}

const W = 600
const H = 120

/** White-vs-Black advantage over the game, with key moments as dots. Click to jump. */
export function EvalGraph({ whiteWin, moves, ply, onSelect }: EvalGraphProps) {
  const n = Math.max(1, whiteWin.length - 1)
  const x = (i: number) => (i / n) * W
  const y = (w: number) => H - (w / 100) * H
  const line = whiteWin.map((w, i) => `${x(i).toFixed(1)},${y(w).toFixed(1)}`).join(' ')
  const area = `0,${H} ${line} ${W},${H}`

  const onClick = (e: MouseEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    const i = Math.round(((e.clientX - box.left) / box.width) * n)
    onSelect(Math.max(0, Math.min(n, i)))
  }

  return (
    <svg
      className="eval-graph"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Evaluation graph"
      onClick={onClick}
    >
      <rect width={W} height={H} className="eval-graph__black" />
      <polygon points={area} className="eval-graph__white" />
      <line x1={0} x2={W} y1={H / 2} y2={H / 2} className="eval-graph__mid" />
      <line x1={x(ply)} x2={x(ply)} y1={0} y2={H} className="eval-graph__cursor" />
      {moves
        .filter((m) => KEY_MARKS.has(m.mark))
        .map((m) => (
          <circle
            key={m.ply}
            cx={x(m.ply + 1)}
            cy={y(whiteWin[m.ply + 1])}
            r={5}
            fill={MARK_STYLES[m.mark].color}
            stroke="#1f1e1c"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          >
            <title>{`${m.san}: ${MARK_STYLES[m.mark].label}`}</title>
          </circle>
        ))}
    </svg>
  )
}
