import { Chess, type Square } from 'chess.js'
import type { DrawShape } from 'chessground/draw'
import type { Color, Key } from 'chessground/types'
import { useMemo, useState } from 'react'
import { ARROW_BRUSH, Board, legalDests } from './board'
import { SidePanel, TrainerLayout } from './trainer'

function formatMoves(sans: string[]): string {
  return sans.map((san, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${san}` : san)).join(' ')
}

// Scratch page: free play with legal-only dragging beside a static side panel.
// Replaced by the drill UI in T1.4b.
export function BoardTestPage() {
  const [game] = useState(() => new Chess())
  const [fen, setFen] = useState(game.fen())
  const [lastMove, setLastMove] = useState<[Key, Key]>()
  const [orientation, setOrientation] = useState<Color>('white')
  const [showArrow, setShowArrow] = useState(false)

  // Demo arrow: the first legal move in the position.
  const shapes = useMemo<DrawShape[]>(() => {
    if (!showArrow) return []
    const first = legalDests(fen).entries().next().value
    return first ? [{ orig: first[0], dest: first[1][0], brush: ARROW_BRUSH }] : []
  }, [fen, showArrow])

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
    <>
      <TrainerLayout>
        <Board
          fen={fen}
          orientation={orientation}
          onMove={handleMove}
          lastMove={lastMove}
          shapes={shapes}
        />
        <SidePanel
          coachMessage="The Italian Game develops quickly and eyes the f7 square."
          prompt="Play the main line for White."
          challenge={3}
          challengeCount={10}
          completed={2}
          onHint={() => setShowArrow((v) => !v)}
          canGoBack
        />
      </TrainerLayout>
      <section className="board-test__controls" aria-label="Dev controls">
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
      </section>
    </>
  )
}
