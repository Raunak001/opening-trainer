import { describe, expect, it } from 'vitest'
import {
  createAttempt,
  hintsExhausted,
  hintUsed,
  mainAnswer,
  requestLessonHint,
  submitLessonMove,
} from '../attempt'
import { CENTER, fenAfter, QUEEN } from './fixtures'

const d4 = { from: 'd2', to: 'd4' }
const d3 = { from: 'd2', to: 'd3' }
const castle = { from: 'e1', to: 'g1' }

describe('lesson attempt', () => {
  it('solves with the main answer', () => {
    const { state, result } = submitLessonMove(createAttempt(CENTER), d4)
    expect(result).toBe('correct')
    expect(state.status).toBe('solved')
    expect(state.solvedBy).toEqual({ san: 'd4', from: 'd2', to: 'd4' })
    expect(state.fen).toBe(fenAfter('e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d4'))
    expect(hintUsed(state)).toBe(false)
  })

  it('solves with any accepted move', () => {
    const { state, result } = submitLessonMove(createAttempt(CENTER), d3)
    expect(result).toBe('correct')
    expect(state.solvedBy?.san).toBe('d3')
  })

  it('counts a wrong move and keeps the position', () => {
    const start = createAttempt(CENTER)
    const { state, result } = submitLessonMove(start, castle)
    expect(result).toBe('wrong')
    expect(state.fen).toBe(start.fen)
    expect(state.misses).toBe(1)
    expect(state.board).toBe('none')
  })

  it('shows the arrow after the second miss', () => {
    let state = createAttempt(CENTER)
    state = submitLessonMove(state, castle).state
    state = submitLessonMove(state, { from: 'a2', to: 'a3' }).state
    expect(state.misses).toBe(2)
    expect(state.board).toBe('arrow')
  })

  it('ignores illegal moves and moves after solving', () => {
    const start = createAttempt(CENTER)
    expect(submitLessonMove(start, { from: 'd2', to: 'd5' })).toEqual({
      state: start,
      result: 'illegal',
    })
    const solved = submitLessonMove(start, d4).state
    expect(submitLessonMove(solved, d3).result).toBe('ignored')
  })

  it('reveals text hints, then the piece, then the arrow', () => {
    let state = createAttempt(CENTER)
    state = requestLessonHint(state)
    expect(state).toMatchObject({ textHints: 1, board: 'none' })
    expect(hintUsed(state)).toBe(true)
    state = requestLessonHint(state)
    expect(state).toMatchObject({ textHints: 2, board: 'none' })
    state = requestLessonHint(state)
    expect(state.board).toBe('piece')
    expect(hintsExhausted(state)).toBe(false)
    state = requestLessonHint(state)
    expect(state.board).toBe('arrow')
    expect(hintsExhausted(state)).toBe(true)
  })

  it('goes straight to board hints when there are no text hints', () => {
    expect(requestLessonHint(createAttempt(QUEEN)).board).toBe('piece')
  })

  it('resolves the main answer for the board hints', () => {
    expect(mainAnswer(QUEEN)).toEqual({ san: 'Nc6', from: 'b8', to: 'c6' })
  })
})
