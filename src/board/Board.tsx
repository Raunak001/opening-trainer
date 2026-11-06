import { Chessground } from 'chessground'
import type { Api } from 'chessground/api'
import type { Config } from 'chessground/config'
import type { DrawBrush, DrawShape } from 'chessground/draw'
import type { Color, Key, SquareClasses } from 'chessground/types'
import { useEffect, useRef, useState } from 'react'
import 'chessground/assets/chessground.base.css'
import './board.css'
import {
  inCheck,
  isPromotion,
  legalDests,
  normalizeCastle,
  turnColor,
  type PromotionPiece,
} from './dests'
import { PromotionPicker } from './PromotionPicker'

export interface BoardProps {
  /** Position to show. The parent owns it: apply the move in `onMove` and pass the new FEN back. */
  fen: string
  orientation?: Color
  /**
   * Called after the user drops a piece on a legal square. Castling always arrives as the
   * king's real move (e1g1), even when the king was dropped on its rook. Promotions arrive
   * once the user picks a piece; cancelling the picker restores the position silently.
   */
  onMove?: (orig: Key, dest: Key, promotion?: PromotionPiece) => void
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
  const [promotion, setPromotion] = useState<{ orig: Key; dest: Key } | null>(null)

  // chessground keeps the handler from mount; route it through a ref so it sees fresh props.
  const handleMoveRef = useRef<(orig: Key, dest: Key) => void>(() => {})
  useEffect(() => {
    handleMoveRef.current = (orig, dest) => {
      const to = normalizeCastle(fen, orig, dest)
      if (isPromotion(fen, orig, to)) setPromotion({ orig, dest: to })
      else onMove?.(orig, to)
    }
  }, [fen, onMove])

  useEffect(() => {
    if (!elRef.current) return
    const api = Chessground(elRef.current, {
      movable: {
        free: false,
        showDests: true,
        events: { after: (orig, dest) => handleMoveRef.current(orig, dest) },
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

  // Also re-runs when the picker closes, which restores the position after a cancel.
  const canMove = interactive && !promotion
  useEffect(() => {
    const api = apiRef.current
    if (!api) return
    if (!canMove) api.selectSquare(null)
    api.set(positionConfig(fen, orientation, canMove, lastMove))
  }, [fen, orientation, canMove, lastMove])

  useEffect(() => {
    apiRef.current?.set({ highlight: { custom: squareClasses } })
  }, [squareClasses])

  useEffect(() => {
    apiRef.current?.setAutoShapes(shapes)
  }, [shapes])

  return (
    <div className="board">
      <div ref={elRef} className="board__ground" />
      {promotion && (
        <PromotionPicker
          color={turnColor(fen)}
          dest={promotion.dest}
          orientation={orientation}
          onPick={(piece) => {
            setPromotion(null)
            onMove?.(promotion.orig, promotion.dest, piece)
          }}
          onCancel={() => setPromotion(null)}
        />
      )}
    </div>
  )
}
