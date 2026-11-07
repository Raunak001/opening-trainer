import { act, renderHook } from '@testing-library/react'
import type { Key } from 'chessground/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ARROW_BRUSH } from '../../board'
import { expectedMove, type Line } from '../drill'
import { italianLine } from '../sampleLines'
import {
  ANIMATION_MS,
  OPPONENT_DELAY_MS,
  REPLAY_DELAY_MS,
  useDrill,
  WRONG_FLASH_MS,
} from '../useDrill'

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'
const AFTER_D4 = 'rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1'
const AFTER_E4_E5 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2'
// 8...d5, the last move of the line
const FINAL = 'r1bqk2r/ppp2ppp/2n2n2/3p4/2BPP3/5N2/PP1N1PPP/R2QK2R w KQkq - 0 9'

type Hook = ReturnType<typeof renderHook<ReturnType<typeof useDrill>, unknown>>

function move(hook: Hook, from: string, to: string) {
  act(() => hook.result.current.board.onMove?.(from as Key, to as Key))
}

function wait(ms: number) {
  act(() => vi.advanceTimersByTime(ms))
}

/** Plays the line's own moves, waiting out every delay, until it completes. */
function playToEnd(hook: Hook) {
  for (let guard = 0; hook.result.current.drill.status !== 'complete'; guard++) {
    if (guard > 50) throw new Error('drill did not complete')
    const step = expectedMove(hook.result.current.drill)
    if (step && hook.result.current.board.interactive) move(hook, step.from, step.to)
    else wait(OPPONENT_DELAY_MS + ANIMATION_MS)
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useDrill as White', () => {
  it('starts interactive on the start position', () => {
    const hook = renderHook(() => useDrill(italianLine('white')))
    const { board, panel } = hook.result.current
    expect(board.fen).toBe(START)
    expect(board.orientation).toBe('white')
    expect(board.interactive).toBe(true)
    expect(panel.challenge).toBe(1)
    expect(panel.challengeCount).toBe(8)
    expect(panel.prompt).toBe('Your move as White.')
  })

  it('correct move: locks, replies after a delay, unlocks after the animation', () => {
    const hook = renderHook(() => useDrill(italianLine('white')))
    move(hook, 'e2', 'e4')
    expect(hook.result.current.board.fen).toBe(AFTER_E4)
    expect(hook.result.current.board.interactive).toBe(false)
    expect(hook.result.current.panel.coachMessage).toBe('e4 is correct!')
    expect(hook.result.current.panel.completed).toBe(1)

    wait(OPPONENT_DELAY_MS - 1)
    expect(hook.result.current.board.fen).toBe(AFTER_E4)

    wait(1)
    expect(hook.result.current.board.fen).toBe(AFTER_E4_E5)
    expect(hook.result.current.board.lastMove).toEqual(['e7', 'e5'])
    expect(hook.result.current.board.interactive).toBe(false)

    wait(ANIMATION_MS)
    expect(hook.result.current.board.interactive).toBe(true)
    expect(hook.result.current.panel.challenge).toBe(2)
  })

  it('wrong move: flashes red on the board, then snaps back', () => {
    const hook = renderHook(() => useDrill(italianLine('white')))
    move(hook, 'd2', 'd4')
    const { panel } = hook.result.current
    let { board } = hook.result.current
    expect(board.fen).toBe(AFTER_D4)
    expect(board.lastMove).toEqual(['d2', 'd4'])
    expect(board.squareClasses?.get('d4')).toBe('wrong')
    expect(board.interactive).toBe(false)
    expect(board.shapes).toEqual([])
    expect(panel.coachMessage).toBe('Not quite. Try again.')

    wait(WRONG_FLASH_MS)
    ;({ board } = hook.result.current)
    expect(board.fen).toBe(START)
    expect(board.lastMove).toBeUndefined()
    expect(board.squareClasses?.size).toBe(0)
    expect(board.interactive).toBe(false)

    wait(ANIMATION_MS)
    expect(hook.result.current.board.interactive).toBe(true)
  })

  it('second miss: shows the hint arrow and rings the piece', () => {
    const hook = renderHook(() => useDrill(italianLine('white')))
    move(hook, 'd2', 'd4')
    wait(WRONG_FLASH_MS + ANIMATION_MS)
    move(hook, 'g1', 'f3')
    expect(hook.result.current.panel.coachMessage).toBe('Not that one. Follow the arrow.')
    expect(hook.result.current.board.shapes).toEqual([
      { orig: 'e2', dest: 'e4', brush: ARROW_BRUSH },
    ])

    wait(WRONG_FLASH_MS + ANIMATION_MS)
    const { board, panel } = hook.result.current
    expect(board.squareClasses?.get('e2')).toBe('hint')
    expect(panel.hintDisabled).toBe(true)

    move(hook, 'e2', 'e4')
    expect(hook.result.current.board.shapes).toEqual([])
    expect(hook.result.current.drill.records).toEqual([{ ply: 0, misses: 2, hintUsed: true }])
  })

  it('hint button: rings the piece, then shows the arrow', () => {
    const hook = renderHook(() => useDrill(italianLine('white')))
    act(() => hook.result.current.panel.onHint?.())
    expect(hook.result.current.board.squareClasses?.get('e2')).toBe('hint')
    expect(hook.result.current.board.shapes).toEqual([])
    expect(hook.result.current.panel.coachMessage).toBe('Move this piece.')

    act(() => hook.result.current.panel.onHint?.())
    expect(hook.result.current.board.shapes).toHaveLength(1)
    expect(hook.result.current.panel.hintDisabled).toBe(true)
  })

  it('plays the line end to end', () => {
    const hook = renderHook(() => useDrill(italianLine('white')))
    playToEnd(hook)
    const { board, panel } = hook.result.current
    expect(board.fen).toBe(FINAL)
    expect(board.interactive).toBe(false)
    expect(panel.completed).toBe(8)
    expect(panel.challenge).toBe(8)
    expect(panel.prompt).toBe('Line complete.')
    expect(panel.coachMessage).toBe('Line complete. Well played!')
  })
})

describe('useDrill as Black', () => {
  it('waits for the opponent first move, then hands over', () => {
    const hook = renderHook(() => useDrill(italianLine('black')))
    expect(hook.result.current.board.orientation).toBe('black')
    expect(hook.result.current.board.interactive).toBe(false)
    expect(hook.result.current.panel.prompt).toBe('Opponent is replying…')

    wait(OPPONENT_DELAY_MS + ANIMATION_MS)
    expect(hook.result.current.board.fen).toBe(AFTER_E4)
    expect(hook.result.current.board.interactive).toBe(true)
    expect(hook.result.current.panel.prompt).toBe('Your move as Black.')
  })

  it('plays the line end to end, finishing on the user move', () => {
    const hook = renderHook(() => useDrill(italianLine('black')))
    playToEnd(hook)
    const { board, panel } = hook.result.current
    expect(board.fen).toBe(FINAL)
    expect(panel.completed).toBe(8)
    expect(panel.coachMessage).toBe('Line complete. Well played!')
  })
})

describe('useDrill lifecycle', () => {
  it('restart resets mid-drill state and cancels pending timers', () => {
    const hook = renderHook(() => useDrill(italianLine('white')))
    move(hook, 'e2', 'e4')
    act(() => hook.result.current.restart())
    wait(OPPONENT_DELAY_MS + ANIMATION_MS)
    expect(hook.result.current.board.fen).toBe(START)
    expect(hook.result.current.board.interactive).toBe(true)
    expect(hook.result.current.panel.completed).toBe(0)
  })

  it('unmount clears pending timers', () => {
    const hook = renderHook(() => useDrill(italianLine('white')))
    move(hook, 'd2', 'd4')
    hook.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('useDrill line-context playback', () => {
  /** Each context move schedules the next after a render, so step one at a time. */
  const replay = (moves: number) => {
    for (let i = 0; i < moves; i++) wait(REPLAY_DELAY_MS)
  }

  const card: Line = {
    id: 'card',
    name: 'Italian Game',
    side: 'white',
    moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'],
    autoPlay: 4,
  }

  it('fast-plays the context with the board locked, then hands over', () => {
    const hook = renderHook(() => useDrill(card, { intro: 'Watch, then play.' }))
    expect(hook.result.current.board.interactive).toBe(false)
    expect(hook.result.current.panel.prompt).toBe('Playing the moves that lead here…')
    expect(hook.result.current.panel.coachMessage).toBe('Watch, then play.')
    expect(hook.result.current.panel.challengeCount).toBe(1)

    wait(REPLAY_DELAY_MS - 1)
    expect(hook.result.current.board.fen).toBe(START)
    wait(1)
    expect(hook.result.current.board.fen).toBe(AFTER_E4)
    replay(3)
    expect(hook.result.current.drill.ply).toBe(4)
    expect(hook.result.current.board.interactive).toBe(false) // last move still animating
    wait(ANIMATION_MS)
    expect(hook.result.current.board.interactive).toBe(true)
    expect(hook.result.current.panel.prompt).toBe('Your move as White.')
  })

  it('reports mistakes, hint use and thinking time once, from the prompt', () => {
    const onComplete = vi.fn()
    const hook = renderHook(() => useDrill(card, { onComplete }))
    replay(4) // replay: not thinking time
    wait(ANIMATION_MS)

    wait(3_000)
    move(hook, 'd2', 'd4') // wrong
    wait(WRONG_FLASH_MS + ANIMATION_MS)
    act(() => hook.result.current.panel.onHint?.())
    wait(1_000)
    move(hook, 'f1', 'c4')

    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(onComplete).toHaveBeenCalledWith({
      mistakes: 1,
      hintUsed: true,
      durationMs: 3_000 + WRONG_FLASH_MS + ANIMATION_MS + 1_000,
    })
    wait(5_000)
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('sums thinking time over several prompts and reports a clean line', () => {
    const onComplete = vi.fn()
    const hook = renderHook(() => useDrill(italianLine('white'), { onComplete }))
    for (let guard = 0; hook.result.current.drill.status !== 'complete'; guard++) {
      if (guard > 50) throw new Error('drill did not complete')
      const step = expectedMove(hook.result.current.drill)
      if (step && hook.result.current.board.interactive) {
        wait(1_000)
        move(hook, step.from, step.to)
      } else wait(OPPONENT_DELAY_MS + ANIMATION_MS)
    }
    expect(onComplete).toHaveBeenCalledWith({ mistakes: 0, hintUsed: false, durationMs: 8_000 })
  })
})
