import { Chessground } from 'chessground'
import type { Api } from 'chessground/api'
import type { Config } from 'chessground/config'
import type { DrawBrush, DrawShape } from 'chessground/draw'
import type { Color, Key, SquareClasses } from 'chessground/types'
import { useEffect, useRef } from 'react'
import 'chessground/assets/chessground.base.css'
import './board.css'
import { inCheck, legalDests, turnColor } from './dests'

export interface BoardProps {
  /** Position to show. The parent owns it: apply the move in `onMove` and pass the new FEN back. */
  fen: string
  orientation?: Color
  /** Called after the user drops a piece on a legal square. */
  onMove?: (orig: Key, dest: Key) => void
  /** Programmatic arrows/circles (hints, engine lines). Not erasable by the user. */
  shapes?: DrawShape[]
  /** Squares to highlight as the last move, e.g. after an opponent reply. */
  lastMove?: [Key, Key]
  /** False locks input, e.g. while an opponent move animates. */
  interactive?: boolean
  /** Extra CSS classes per square: `wrong` (red flash) and `hint` are styled in board.css. */
  squareClasses?: SquareClasses
}

const EMPTY_SHAPES: DrawShape[] = []
const NO_CLASSES: SquareClasses = new Map()

/** Brush name for hint and engine arrows: `{ orig, dest, brush: ARROW_BRUSH }`. */
export const ARROW_BRUSH = 'orange'

const ORANGE: DrawBrush = { key: 'o', color: '#ffaa00', opacity: 0.8, lineWidth: 10 }

function positionConfig(
  fen: string,
  orientation: Color,
  interactive: boolean,
  lastMove?: [Key, Key],
): Config {
  const turn = turnColor(fen)
  return {
    fen,
    orientation,
    turnColor: turn,
    check: inCheck(fen),
    lastMove,
    // No color means nothing is movable.
    movable: interactive ? { color: turn, dests: legalDests(fen) } : { color: undefined },
  }
}

export function Board({
  fen,
  orientation = 'white',
  onMove,
  shapes = EMPTY_SHAPES,
  lastMove,
  interactive = true,
  squareClasses = NO_CLASSES,
}: BoardProps) {
  const elRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<Api | null>(null)
  // Read through a ref so a new callback each render doesn't rebuild the board.
  const onMoveRef = useRef(onMove)

  useEffect(() => {
    onMoveRef.current = onMove
  }, [onMove])

  useEffect(() => {
    if (!elRef.current) return
    const api = Chessground(elRef.current, {
      movable: {
        free: false,
        showDests: true,
        events: { after: (orig, dest) => onMoveRef.current?.(orig, dest) },
      },
      premovable: { enabled: false },
      draggable: { showGhost: true },
      highlight: { lastMove: true, check: true },
    })
    api.state.drawable.brushes[ARROW_BRUSH] = ORANGE
    apiRef.current = api
    return () => {
      api.destroy()
      apiRef.current = null
    }
  }, [])

  useEffect(() => {
    const api = apiRef.current
    if (!api) return
    if (!interactive) api.selectSquare(null)
    api.set(positionConfig(fen, orientation, interactive, lastMove))
  }, [fen, orientation, interactive, lastMove])

  useEffect(() => {
    apiRef.current?.set({ highlight: { custom: squareClasses } })
  }, [squareClasses])

  useEffect(() => {
    apiRef.current?.setAutoShapes(shapes)
  }, [shapes])

  return <div ref={elRef} className="board" />
}
