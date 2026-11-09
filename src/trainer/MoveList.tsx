import { useEffect, useRef } from 'react'
import { moveRows } from './moveRows'
import './moveList.css'

export interface MoveListProps {
  /** Moves played so far, in SAN. */
  moves: readonly string[]
  /** FEN the moves start from; sets the first move number. Default: initial position. */
  startFen?: string
  /** Index of the highlighted move; default the last one. -1 highlights nothing. */
  current?: number
  /** Makes moves clickable (e.g. to jump to a position in a preview). */
  onSelect?: (ply: number) => void
}

/** Numbered SAN list of the line so far, current move highlighted. */
export function MoveList({ moves, startFen, current = moves.length - 1, onSelect }: MoveListProps) {
  const listRef = useRef<HTMLOListElement>(null)
  // Keep the current move in view as the line grows.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[aria-current="true"]')
    el?.scrollIntoView?.({ block: 'nearest' })
  }, [current, moves.length])

  if (moves.length === 0)
    return (
      <div className="move-list move-list--empty" aria-label="Moves">
        No moves yet.
      </div>
    )

  const cell = (m: { san: string; ply: number } | undefined, fallback: string) => {
    if (!m) return <span className="move-list__move move-list__move--blank">{fallback}</span>
    const props = {
      className: 'move-list__move',
      'aria-current': m.ply === current ? ('true' as const) : undefined,
    }
    return onSelect ? (
      <button type="button" {...props} onClick={() => onSelect(m.ply)}>
        {m.san}
      </button>
    ) : (
      <span {...props}>{m.san}</span>
    )
  }

  return (
    <ol className="move-list" aria-label="Moves" ref={listRef}>
      {moveRows(moves, startFen).map((row) => (
        <li key={row.number} className="move-list__row">
          <span className="move-list__number">{row.number}.</span>
          {cell(row.white, '…')}
          {cell(row.black, '')}
        </li>
      ))}
    </ol>
  )
}
