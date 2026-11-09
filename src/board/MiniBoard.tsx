import { Chessground } from 'chessground'
import type { Color } from 'chessground/types'
import { useEffect, useRef } from 'react'
import 'chessground/assets/chessground.base.css'
import './board.css'

export interface MiniBoardProps {
  fen: string
  orientation?: Color
  /** Accessible description, e.g. "Caro-Kann Defense start position". */
  label: string
}

/** A small static board: no input, no coordinates. */
export function MiniBoard({ fen, orientation = 'white', label }: MiniBoardProps) {
  const elRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!elRef.current) return
    const api = Chessground(elRef.current, {
      fen,
      orientation,
      viewOnly: true,
      coordinates: false,
      animation: { enabled: false },
      drawable: { enabled: false, visible: false },
    })
    return () => api.destroy()
  }, [fen, orientation])
  return (
    <div className="board board--mini" role="img" aria-label={label}>
      <div ref={elRef} className="board__ground" />
    </div>
  )
}
