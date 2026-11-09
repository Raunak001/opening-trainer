import { useCallback, useMemo, useState, type KeyboardEvent } from 'react'
import type { Key } from 'chessground/types'
import { Chess } from 'chess.js'
import { Board } from '../board'
import { MoveList } from './MoveList'
import { fensAlong } from './moveRows'
import './linePreview.css'

export interface LinePreviewProps {
  /** SAN moves of the line. */
  moves: readonly string[]
  startFen?: string
  orientation?: 'white' | 'black'
  /** Heading above the move list. */
  title?: string
  /** Moves shown on open (default: the whole line). */
  initialPly?: number
}

/**
 * View-only board and move list for stepping through a line: ‹ › buttons,
 * ← → keys (Home/End for the ends), or click a move.
 */
export function LinePreview({
  moves,
  startFen,
  orientation = 'white',
  title,
  initialPly,
}: LinePreviewProps) {
  const fens = useMemo(() => fensAlong(moves, startFen), [moves, startFen])
  const startPly = Math.min(initialPly ?? moves.length, moves.length)
  const [ply, setPly] = useState(startPly)
  // A new line starts over (state adjusted during render, not in an effect).
  const [shown, setShown] = useState(moves)
  if (shown !== moves) {
    setShown(moves)
    setPly(startPly)
  }

  const go = useCallback((n: number) => setPly(Math.max(0, Math.min(moves.length, n))), [moves])

  const lastMove = useMemo<[Key, Key] | undefined>(() => {
    if (ply === 0) return undefined
    const m = new Chess(fens[ply - 1]).move(moves[ply - 1])
    return [m.from, m.to]
  }, [fens, moves, ply])

  const onKeyDown = (e: KeyboardEvent) => {
    const next =
      e.key === 'ArrowLeft'
        ? ply - 1
        : e.key === 'ArrowRight'
          ? ply + 1
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? moves.length
              : undefined
    if (next === undefined) return
    e.preventDefault()
    go(next)
  }

  return (
    <section
      className="line-preview"
      aria-label={title ?? 'Line preview'}
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      <Board fen={fens[ply]} orientation={orientation} lastMove={lastMove} interactive={false} />
      <div className="line-preview__side">
        {title && <h3 className="line-preview__title">{title}</h3>}
        <MoveList moves={moves} startFen={startFen} current={ply - 1} onSelect={(i) => go(i + 1)} />
        <div className="line-preview__nav">
          <button type="button" aria-label="Start" onClick={() => go(0)} disabled={ply === 0}>
            «
          </button>
          <button type="button" aria-label="Back" onClick={() => go(ply - 1)} disabled={ply === 0}>
            ‹
          </button>
          <span className="line-preview__count">
            {ply}/{moves.length}
          </span>
          <button
            type="button"
            aria-label="Forward"
            onClick={() => go(ply + 1)}
            disabled={ply === moves.length}
          >
            ›
          </button>
          <button
            type="button"
            aria-label="End"
            onClick={() => go(moves.length)}
            disabled={ply === moves.length}
          >
            »
          </button>
        </div>
      </div>
    </section>
  )
}
