import { act, renderHook } from '@testing-library/react'
import type { Key } from 'chessground/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeCastle, type PromotionPiece } from '../../board'
import { expectedMove, type Line, type Step } from '../drill'
import { SPECIAL_MOVE_LINES } from './sampleLines'
import { ANIMATION_MS, OPPONENT_DELAY_MS, useDrill, WRONG_FLASH_MS } from '../useDrill'

// Final positions, checked by hand: captured pawns gone after e.p., kings and rooks on
// their castled squares, the promoted knight on h1 giving check.
const FINAL: Record<string, string> = {
  'castle-short': 'r1bq1rk1/pppp1ppp/2n2n2/2b1p3/2B1P3/3P1N2/PPP2PPP/RNBQ1RK1 w - - 1 6',
  'castle-long': '2kr1bnr/pppqpppp/2n5/3p1b2/3P1B2/2N5/PPPQPPPP/2KR1BNR w - - 8 6',
  'ep-white': 'rnbqkb1r/ppp1pppp/3P1n2/8/8/8/PPPP1PPP/RNBQKBNR b KQkq - 0 3',
  'ep-black': 'rnbqkbnr/ppp2ppp/8/4p3/4P3/2p5/PP1PNPPP/R1BQKBNR w KQkq - 0 5',
  promotion: 'Q7/3k4/8/8/8/8/5K2/7n w - - 0 3',
}

const lineById = (id: string) => {
  const line = SPECIAL_MOVE_LINES.find((l) => l.id === id)
  if (!line) throw new Error(`no line ${id}`)
  return line
}

type Hook = ReturnType<typeof renderHook<ReturnType<typeof useDrill>, unknown>>

/** What the Board sends for a step: castling optionally as king-onto-rook. */
function boardInput(step: Step, kingOntoRook: boolean): [Key, Key, PromotionPiece?] {
  let to: string = step.to
  if (kingOntoRook && step.san.startsWith('O-O')) to = (step.san === 'O-O' ? 'h' : 'a') + to[1]
  return [step.from, to as Key, step.promotion as PromotionPiece | undefined]
}

function playToEnd(hook: Hook, kingOntoRook = false) {
  for (let guard = 0; hook.result.current.drill.status !== 'complete'; guard++) {
    if (guard > 50) throw new Error('drill did not complete')
    const step = expectedMove(hook.result.current.drill)
    if (step && hook.result.current.board.interactive) {
      // Board normalizes king-onto-rook before calling onMove.
      const [from, to, promotion] = boardInput(step, kingOntoRook)
      const dest = normalizeCastle(hook.result.current.board.fen, from, to)
      act(() => hook.result.current.board.onMove?.(from, dest, promotion))
    } else {
      act(() => vi.advanceTimersByTime(OPPONENT_DELAY_MS + ANIMATION_MS))
    }
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('special-move lines', () => {
  it.each(SPECIAL_MOVE_LINES.map((l): [string, Line] => [l.id, l]))(
    '%s plays to the end without a miss',
    (id, line) => {
      const hook = renderHook(() => useDrill(line))
      playToEnd(hook)
      const { drill, board } = hook.result.current
      expect(drill.status).toBe('complete')
      expect(board.fen).toBe(FINAL[id.replace(/-(white|black)$/, '')] ?? FINAL[id])
      expect(drill.records.every((r) => r.misses === 0)).toBe(true)
    },
  )

  it.each(['castle-short-white', 'castle-short-black', 'castle-long-white', 'castle-long-black'])(
    '%s accepts the king dropped on its rook',
    (id) => {
      const hook = renderHook(() => useDrill(lineById(id)))
      playToEnd(hook, true)
      expect(hook.result.current.drill.records.every((r) => r.misses === 0)).toBe(true)
      expect(hook.result.current.drill.status).toBe('complete')
    },
  )

  it('en passant removes the captured pawn from the board', () => {
    const hook = renderHook(() => useDrill(lineById('ep-white')))
    playToEnd(hook)
    const placement = hook.result.current.board.fen.split(' ')[0]
    expect(placement.split('/')[3]).toBe('8') // rank 5: d5 pawn captured
  })

  it('the wrong promotion piece is a miss and snaps back', () => {
    const hook = renderHook(() => useDrill(lineById('promotion-black')))
    act(() => vi.advanceTimersByTime(OPPONENT_DELAY_MS + ANIMATION_MS)) // 1.a8=Q+
    act(() => hook.result.current.board.onMove?.('e8', 'd7'))
    act(() => vi.advanceTimersByTime(OPPONENT_DELAY_MS + ANIMATION_MS)) // 2.Kf2

    act(() => hook.result.current.board.onMove?.('h2', 'h1', 'q'))
    expect(hook.result.current.drill.misses).toBe(1)
    expect(hook.result.current.board.fen.split(' ')[0]).toBe('Q7/3k4/8/8/8/8/5K2/7q')

    act(() => vi.advanceTimersByTime(WRONG_FLASH_MS + ANIMATION_MS))
    expect(hook.result.current.board.fen.split(' ')[0]).toBe('Q7/3k4/8/8/8/8/5K1p/8')

    act(() => hook.result.current.board.onMove?.('h2', 'h1', 'n'))
    expect(hook.result.current.drill.status).toBe('complete')
  })
})
