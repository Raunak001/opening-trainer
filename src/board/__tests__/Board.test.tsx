import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Board } from '../Board'

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1'

describe('Board', () => {
  it('mounts chessground with all 32 pieces', () => {
    const { container } = render(<Board fen={START} />)
    expect(container.querySelector('cg-board')).not.toBeNull()
    expect(container.querySelectorAll('piece:not(.ghost)')).toHaveLength(32)
  })

  it('updates the position and orientation from props', () => {
    const { container, rerender } = render(<Board fen={START} />)
    rerender(<Board fen={AFTER_E4} orientation="black" />)
    expect(container.querySelector('.cg-wrap')).toHaveClass('orientation-black')
    expect(container.querySelectorAll('piece.pawn.white')).toHaveLength(8)
  })
})
