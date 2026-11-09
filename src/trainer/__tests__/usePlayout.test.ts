import { act, renderHook } from '@testing-library/react'
import { Chess } from 'chess.js'
import type { Key } from 'chessground/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Engine, Explanation, SearchOptions } from '../../engine'
import { playoutFeedback, usePlayout } from '../usePlayout'
import { OPPONENT_DELAY_MS } from '../useDrill'

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
const ITALIAN = 'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4'
const LINE = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5']

/** Opponent that plays its first legal move (sorted by SAN) and records the depth asked. */
function fakeOpponent() {
  const depths: number[] = []
  const engine: Engine = {
    ready: async () => {},
    async search(fen: string, options: SearchOptions) {
      depths.push(options.depth)
      const move = new Chess(fen)
        .moves({ verbose: true })
        .sort((a, b) => a.san.localeCompare(b.san))[0]
      return { fen, bestMove: move.lan, lines: [] }
    },
    cancel: () => {},
    setOption: async () => {},
    dispose: () => {},
  }
  return { engine, depths }
}

const graded = (grade: Explanation['grade'], extra: Partial<Explanation> = {}): Explanation => ({
  grade,
  label: grade === 'good' ? 'good move' : grade,
  evalBest: '+0.3',
  evalPlayed: '+0.2',
  findings: [],
  ...extra,
})

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('usePlayout', () => {
  it('grades the user move, then the opponent replies', async () => {
    const opponent = fakeOpponent()
    const explain = vi.fn().mockResolvedValue(graded('good'))
    const hook = renderHook(() =>
      usePlayout({
        fen: ITALIAN,
        userSide: 'white',
        lineStartFen: START,
        lineMoves: LINE,
        userMoves: 10,
        opponent: opponent.engine,
        depth: 8,
        explain,
      }),
    )
    expect(hook.result.current.board.interactive).toBe(true)
    expect(hook.result.current.panel.challenge).toBe(1)

    act(() => hook.result.current.board.onMove?.('c2' as Key, 'c3' as Key))
    expect(hook.result.current.board.interactive).toBe(false)
    expect(hook.result.current.panel.prompt).toBe('Stockfish is thinking…')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(OPPONENT_DELAY_MS)
    })
    expect(explain).toHaveBeenCalledWith({
      fen: ITALIAN,
      move: { from: 'c2', to: 'c3', promotion: undefined },
      startFen: START,
      previous: LINE,
    })
    expect(opponent.depths).toEqual([8])
    const { state } = hook.result.current
    expect(state.moves).toHaveLength(2)
    expect(state.moves[0].grade).toBe('good')
    expect(hook.result.current.panel.coachMessage).toBe('c3 is a good move.')
    expect(hook.result.current.board.interactive).toBe(true)
    expect(hook.result.current.panel.completed).toBe(1)
  })

  it('finishes with a summary after the last move', async () => {
    const opponent = fakeOpponent()
    const explain = vi.fn().mockResolvedValue(graded('mistake', { reason: 'This loses a pawn.' }))
    const hook = renderHook(() =>
      usePlayout({
        fen: ITALIAN,
        userSide: 'white',
        lineStartFen: START,
        lineMoves: LINE,
        userMoves: 1,
        opponent: opponent.engine,
        depth: 8,
        explain,
      }),
    )
    act(() => hook.result.current.board.onMove?.('d2' as Key, 'd4' as Key))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(OPPONENT_DELAY_MS)
    })
    expect(hook.result.current.state.status).toBe('complete')
    expect(hook.result.current.panel.prompt).toBe('Play-out finished. 1 mistake.')
    expect(hook.result.current.panel.coachMessage).toBe('d4 is a mistake. This loses a pawn.')
  })

  it('opens with an engine move when the user plays the other side', async () => {
    const opponent = fakeOpponent()
    const hook = renderHook(() =>
      usePlayout({
        fen: ITALIAN,
        userSide: 'black',
        lineStartFen: START,
        lineMoves: LINE,
        userMoves: 10,
        opponent: opponent.engine,
        depth: 8,
        explain: vi.fn(),
      }),
    )
    expect(hook.result.current.board.interactive).toBe(false)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(OPPONENT_DELAY_MS)
    })
    expect(hook.result.current.state.moves).toHaveLength(1)
    expect(hook.result.current.board.interactive).toBe(true)
  })
})

describe('playoutFeedback', () => {
  it('names the better move for bad moves', () => {
    expect(
      playoutFeedback(
        'Ng5',
        graded('blunder', {
          reason: 'This leaves your knight on g5 hanging.',
          best: 'Best was d3 (+0.4).',
        }),
      ),
    ).toBe('Ng5 is a blunder. This leaves your knight on g5 hanging. Best was d3 (+0.4).')
    expect(playoutFeedback('h3', graded('inaccuracy'))).toBe('h3 is an inaccuracy.')
  })
})
