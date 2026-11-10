import { describe, expect, it } from 'vitest'
import {
  hint,
  opponentReply,
  playUserMove,
  ratedOutcome,
  retry,
  showSolution,
  startPuzzle,
  userColor,
} from '../solution'
import { MATE_IN_1, MATE_IN_2, MATERIAL, PROMOTION } from './fixtures'

describe('startPuzzle', () => {
  it('auto-plays the setup move and gives the user the other side', () => {
    const s = startPuzzle(MATE_IN_1)
    expect(s.sans).toEqual(['Nc5'])
    expect(s.lastMove).toEqual(['d7', 'c5'])
    expect(s.fen.split(' ')[1]).toBe('w')
    expect(userColor(MATE_IN_1)).toBe('white')
    expect(userColor(MATERIAL)).toBe('black')
    expect(s.phase).toBe('user')
  })

  it('rejects a puzzle with an illegal setup move', () => {
    expect(() => startPuzzle({ ...MATE_IN_1, moves: ['a1a8', 'e4h7'] })).toThrow()
  })
})

describe('playUserMove', () => {
  it('solves a mate in 1', () => {
    const { state, result } = playUserMove(startPuzzle(MATE_IN_1), 'e4h7')
    expect(result).toBe('solved')
    expect(state.phase).toBe('done')
    expect(ratedOutcome(state)).toBe('win')
  })

  it('a correct move hands over to the opponent, then the user finishes', () => {
    let { state, result } = playUserMove(startPuzzle(MATE_IN_2), 'f1f7')
    expect(result).toBe('correct')
    expect(state.phase).toBe('opponent')
    expect(ratedOutcome(state)).toBeUndefined()
    state = opponentReply(state)
    expect(state.sans).toEqual(['Rxg3', 'Qxf7+', 'Kh8'])
    ;({ state, result } = playUserMove(state, 'f7e8'))
    expect(result).toBe('solved')
    expect(state.failed).toBe(false)
  })

  it('accepts a different mate in 1 as correct', () => {
    let { state } = playUserMove(startPuzzle(MATE_IN_2), 'f1f7')
    state = opponentReply(state)
    const alt = playUserMove(state, 'f7f8')
    expect(alt.result).toBe('solved')
    expect(alt.state.sans.at(-1)).toBe('Qf8#')
    expect(ratedOutcome(alt.state)).toBe('win')
  })

  it('accepts an underpromotion that also mates', () => {
    let { state } = playUserMove(startPuzzle(PROMOTION), 'g6g7')
    state = opponentReply(state)
    expect(playUserMove(state, 'g7g8r').result).toBe('solved')
    expect(playUserMove(state, 'g7g8q').result).toBe('solved')
  })

  it('a wrong move fails the puzzle, shows on the board, and retry takes it back', () => {
    const start = startPuzzle(MATERIAL)
    const { state, result } = playUserMove(start, 'f8e8')
    expect(result).toBe('wrong')
    expect(state.failed).toBe(true)
    expect(state.mistakes).toBe(1)
    expect(state.wrong).toMatchObject({ from: 'f8', to: 'e8' })
    expect(ratedOutcome(state)).toBe('loss')
    // Input is locked while the wrong move is on display.
    expect(playUserMove(state, 'f8d8').result).toBe('ignored')
    const back = retry(state)
    expect(back.wrong).toBeUndefined()
    expect(back.fen).toBe(start.fen)
    const next = playUserMove(back, 'f8d8')
    expect(next.result).toBe('correct')
    // Still a loss: the first try counts.
    expect(ratedOutcome(next.state)).toBe('loss')
  })

  it('ignores illegal moves and moves out of turn', () => {
    const s = startPuzzle(MATERIAL)
    expect(playUserMove(s, 'a1a8').result).toBe('ignored')
    const { state } = playUserMove(s, 'f8d8')
    expect(playUserMove(state, 'd6d8').result).toBe('ignored')
  })
})

describe('hint and solution', () => {
  it('a hint names the move and fails the puzzle', () => {
    const h = hint(startPuzzle(MATERIAL))
    expect(h.from).toBe('f8')
    expect(h.to).toBe('d8')
    expect(h.state.hintUsed).toBe(true)
    expect(ratedOutcome(h.state)).toBe('loss')
  })

  it('showSolution plays the remaining moves', () => {
    const s = showSolution(startPuzzle(MATERIAL))
    expect(s.phase).toBe('done')
    expect(s.solutionShown).toBe(true)
    expect(s.sans).toEqual(['Qd6', 'Rd8', 'Qxd8+', 'Bxd8'])
    expect(ratedOutcome(s)).toBe('loss')
  })
})
