import { Chessground } from 'chessground'
import type { Api } from 'chessground/api'
import type { Config } from 'chessground/config'
import type { DrawShape } from 'chessground/draw'
import type { Color, Key } from 'chessground/types'
import { useEffect, useRef } from 'react'
import 'chessground/assets/chessground.base.css'
import 'chessground/assets/chessground.brown.css'
import 'chessground/assets/chessground.cburnett.css'
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
}

const EMPTY_SHAPES: DrawShape[] = []

function positionConfig(fen: string, orientation: Color, lastMove?: [Key, Key]): Config {
  const turn = turnColor(fen)
  return {
    fen,
    orientation,
    turnColor: turn,
    check: inCheck(fen),
    lastMove,
    movable: { color: turn, dests: legalDests(fen) },
  }
}

export function Board({
  fen,
  orientation = 'white',
  onMove,
  shapes = EMPTY_SHAPES,
  lastMove,
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
    apiRef.current = api
    return () => {
      api.destroy()
      apiRef.current = null
    }
  }, [])

  useEffect(() => {
    apiRef.current?.set(positionConfig(fen, orientation, lastMove))
  }, [fen, orientation, lastMove])

  useEffect(() => {
    apiRef.current?.setAutoShapes(shapes)
  }, [shapes])

  return <div ref={elRef} className="board" />
}
