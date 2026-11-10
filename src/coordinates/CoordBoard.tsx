import { Chessground } from 'chessground'
import type { Api } from 'chessground/api'
import type { Key } from 'chessground/types'
import { useEffect, useRef } from 'react'
import 'chessground/assets/chessground.base.css'
import '../board/board.css'
import type { Square, View } from './squares'

export const EMPTY_BOARD = '8/8/8/8/8/8/8/8'

export interface CoordBoardProps {
  /** Piece placement (first FEN field). Empty board by default. */
  placement?: string
  view: View
  /** A click on any square. */
  onSquare?: (square: Square) => void
  /** CSS classes per square, styled in coordinates.css. */
  marks?: ReadonlyMap<Square, string>
  /** Text over the middle of the board, e.g. the square to find. */
  overlay?: string
  /** Fades the board out (Visualize, before answering). */
  hidden?: boolean
}

const NO_MARKS: ReadonlyMap<Square, string> = new Map()

/** A board with no square names, for coordinate drills. Pieces never move. */
export function CoordBoard({
  placement = EMPTY_BOARD,
  view,
  onSquare,
  marks = NO_MARKS,
  overlay,
  hidden = false,
}: CoordBoardProps) {
  const elRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<Api | null>(null)
  const onSquareRef = useRef(onSquare)
  useEffect(() => {
    onSquareRef.current = onSquare
  }, [onSquare])

  useEffect(() => {
    const el = elRef.current
    if (!el) return
    const api = Chessground(el, {
      fen: placement,
      orientation: view,
      coordinates: false,
      animation: { enabled: false },
      movable: { color: undefined },
      draggable: { enabled: false },
      premovable: { enabled: false },
      drawable: { enabled: false },
      highlight: { lastMove: false, check: false },
      events: { select: (key: Key) => onSquareRef.current?.(key as Square) },
    })
    apiRef.current = api
    return () => {
      api.destroy()
      apiRef.current = null
    }
    // Later prop changes go through api.set below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    apiRef.current?.set({ fen: placement, orientation: view })
  }, [placement, view])

  useEffect(() => {
    apiRef.current?.set({ highlight: { custom: new Map(marks as Map<Key, string>) } })
  }, [marks])

  return (
    <div className={`board coord-board${hidden ? ' coord-board--hidden' : ''}`}>
      <div ref={elRef} className="board__ground" />
      {overlay && (
        <div className="coord-board__overlay" aria-live="polite">
          {overlay}
        </div>
      )}
    </div>
  )
}
