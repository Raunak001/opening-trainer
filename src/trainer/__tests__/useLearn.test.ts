import { act, renderHook } from '@testing-library/react'
import { Chess } from 'chess.js'
import type { Key } from 'chessground/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildOpeningIndex, parseOpeningsTsv } from '../../repertoire/openings'
import { positionKey } from '../../repertoire/positionKey'
import type { LearnState } from '../learn'
import { lineNarration } from '../narration'
import { ANIMATION_MS, OPPONENT_DELAY_MS } from '../useDrill'
import { SHOW_ARROW_MS, SHOW_MOVE_MS, useLearn } from '../useLearn'

const keyAfter = (sans: string) => {
  const chess = new Chess()
  for (const san of sans.split(' ').filter(Boolean)) chess.move(san)
  return positionKey(chess.fen())
}

const LINE = { side: 'black' as const, moves: 'e4 c6 d4 d5 e5 Bf5'.split(' ') }
const NEW = new Set(['e4', 'e4 c6 d4', 'e4 c6 d4 d5 e5'].map(keyAfter))
const OPENINGS = buildOpeningIndex(
  parseOpeningsTsv(
    [
      'eco\tname\tpgn',
      'B10\tCaro-Kann Defense\t1. e4 c6',
      'B12\tCaro-Kann Defense: Advance Variation\t1. e4 c6 2. d4 d5 3. e5',
    ].join('\n'),
  ),
)

type Hook = ReturnType<typeof renderHook<ReturnType<typeof useLearn>, unknown>>
const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms))
const move = (hook: Hook, from: string, to: string) =>
  act(() => hook.result.current.board.onMove?.(from as Key, to as Key))

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('useLearn', () => {
  it('shows the line with narration and arrows, then you play it back', () => {
    const onComplete = vi.fn<(s: LearnState) => void>()
    const hook = renderHook(() => useLearn(LINE, NEW, { openings: OPENINGS, onComplete }))
    expect(hook.result.current.panel.coachMessage).toMatch(/Watch the line first/)
    expect(hook.result.current.board.interactive).toBe(false)

    wait(600) // 1.e4
    expect(hook.result.current.panel.moves?.moves).toEqual(['e4'])
    wait(SHOW_MOVE_MS) // arrow for 1…c6
    expect(hook.result.current.board.shapes).toEqual([{ orig: 'c7', dest: 'c6', brush: 'orange' }])
    expect(hook.result.current.panel.coachMessage).toMatch(/^1…c6 is your move\./)
    wait(SHOW_ARROW_MS) // 1…c6 played
    expect(hook.result.current.panel.coachMessage).toMatch(/This is the Caro-Kann Defense\.$/)

    // Stepping by hand pauses the autoplay.
    act(() => hook.result.current.panel.onBack?.())
    expect(hook.result.current.paused).toBe(true)
    expect(hook.result.current.learn.ply).toBe(1)
    wait(10_000)
    expect(hook.result.current.learn.ply).toBe(1)
    act(() => hook.result.current.togglePause())
    for (let i = 0; i < 12 && hook.result.current.learn.ply < 6; i++) wait(SHOW_MOVE_MS)
    expect(hook.result.current.learn.ply).toBe(6)
    expect(hook.result.current.panel.prompt).toMatch(/Now play it yourself/)

    act(() => hook.result.current.play())
    expect(hook.result.current.learn.phase).toBe('play')
    wait(OPPONENT_DELAY_MS + ANIMATION_MS) // 1.e4
    expect(hook.result.current.board.interactive).toBe(true)
    // New move: the arrow is up from the first try.
    expect(hook.result.current.board.shapes).toHaveLength(1)
    move(hook, 'c7', 'c6')
    expect(hook.result.current.panel.coachMessage).toBe('c6 is right!')
    wait(OPPONENT_DELAY_MS + ANIMATION_MS) // 2.d4
    move(hook, 'd7', 'd5')
    wait(OPPONENT_DELAY_MS + ANIMATION_MS) // 3.e5
    expect(hook.result.current.panel.coachMessage).toMatch(/Advance Variation/)
    move(hook, 'c8', 'f5')
    expect(hook.result.current.learn.phase).toBe('complete')
    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(onComplete.mock.calls[0][0].records).toHaveLength(3)
  })
})

describe('lineNarration', () => {
  it('names an opening only when the name changes', () => {
    const chess = new Chess()
    const steps = LINE.moves.map((san) => {
      const fenBefore = chess.fen()
      const turn = chess.turn()
      chess.move(san)
      return { san, fenBefore, fenAfter: chess.fen(), byUser: turn === 'b' }
    })
    const texts = lineNarration(steps, 'black', { openings: OPENINGS })
    expect(texts.filter((t) => t.includes('This is the'))).toEqual([
      expect.stringContaining('Caro-Kann Defense.'),
      expect.stringContaining('Caro-Kann Defense: Advance Variation.'),
    ])
  })
})
