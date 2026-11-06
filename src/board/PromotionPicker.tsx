import type { Color, Key } from 'chessground/types'
import { useEffect, useRef } from 'react'
import type { PromotionPiece } from './dests'

const CHOICES: { piece: PromotionPiece; name: string; file: string }[] = [
  { piece: 'q', name: 'Queen', file: 'Q' },
  { piece: 'n', name: 'Knight', file: 'N' },
  { piece: 'r', name: 'Rook', file: 'R' },
  { piece: 'b', name: 'Bishop', file: 'B' },
]

export interface PromotionPickerProps {
  /** Color of the promoting pawn. */
  color: Color
  /** Promotion square; the column starts here and runs toward the board's middle. */
  dest: Key
  orientation: Color
  onPick: (piece: PromotionPiece) => void
  onCancel: () => void
}

export function PromotionPicker({
  color,
  dest,
  orientation,
  onPick,
  onCancel,
}: PromotionPickerProps) {
  const firstRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    firstRef.current?.focus()
  }, [])

  const file = dest.charCodeAt(0) - 'a'.charCodeAt(0)
  const column = orientation === 'white' ? file : 7 - file
  const atTop = (dest[1] === '8') === (orientation === 'white')
  const prefix = color === 'white' ? 'w' : 'b'

  return (
    <div
      className="promotion"
      role="dialog"
      aria-label="Choose promotion piece"
      onClick={onCancel}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel()
      }}
    >
      <div
        className={`promotion__column ${atTop ? 'promotion__column--top' : 'promotion__column--bottom'}`}
        style={{ left: `${column * 12.5}%` }}
        onClick={(e) => e.stopPropagation()}
      >
        {CHOICES.map(({ piece, name, file: letter }, i) => (
          <button
            key={piece}
            ref={i === 0 ? firstRef : undefined}
            type="button"
            className="promotion__piece"
            aria-label={name}
            onClick={() => onPick(piece)}
          >
            <img src={`/pieces/${prefix}${letter}.svg`} alt="" />
          </button>
        ))}
        <button type="button" className="promotion__cancel" aria-label="Cancel" onClick={onCancel}>
          ×
        </button>
      </div>
    </div>
  )
}
