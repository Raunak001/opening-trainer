import { Chess, type Square } from 'chess.js'
import type { Color, Key } from 'chessground/types'
import { useState } from 'react'
import { Board } from './board'

function formatMoves(sans: string[]): string {
  return sans.map((san, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${san}` : san)).join(' ')
}

// Scratch page for T1.1: free play with legal-only dragging. Replaced by the drill UI later.
export function BoardTestPage() {
  const [game] = useState(() => new Chess())
  const [fen, setFen] = useState(game.fen())
  const [lastMove, setLastMove] = useState<[Key, Key]>()
  const [orientation, setOrientation] = useState<Color>('white')

  function handleMove(orig: Key, dest: Key) {
    const isPromotion = game
      .moves({ square: orig as Square, verbose: true })
      .some((m) => m.to === dest && m.promotion)
    // Auto-queen until the promotion picker lands (T1.5).
    game.move({ from: orig, to: dest, promotion: isPromotion ? 'q' : undefined })
    setFen(game.fen())
    setLastMove([orig, dest])
  }

  function reset() {
    game.reset()
    setFen(game.fen())
    setLastMove(undefined)
  }

  return (
    <main className="board-test">
      <Board fen={fen} orientation={orientation} onMove={handleMove} lastMove={lastMove} />
      <div className="board-test__controls">
        <button
          type="button"
          onClick={() => setOrientation((o) => (o === 'white' ? 'black' : 'white'))}
        >
          Flip board
        </button>
        <button type="button" onClick={reset}>
          Reset
        </button>
        <p data-testid="moves">{formatMoves(game.history()) || 'Start position'}</p>
        <p data-testid="fen">{fen}</p>
      </div>
    </main>
  )
}
