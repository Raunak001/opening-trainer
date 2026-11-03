import { describe, expect, it } from 'vitest'
import {
  createDrill,
  expectedMove,
  playOpponentMove,
  requestHint,
  submitMove,
  type DrillState,
  type Line,
  type MoveInput,
} from '../drill'

// Italian Game, Giuoco Piano main line: 1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5 4.c3 Nf6 5.d4
const ITALIAN = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd4']
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'
const AFTER_D4 = 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2BPP3/2P2N2/PP3PPP/RNBQK2R b KQkq - 0 5'

const italian = (side: 'white' | 'black'): Line => ({
  id: `italian-${side}`,
  name: 'Italian Game',
  side,
  moves: ITALIAN,
})

/** Plays the line's own moves until the drill completes. */
function playThrough(state: DrillState): DrillState {
  let s = state
  while (s.status !== 'complete') {
    const step = expectedMove(s)
    s = step ? submitMove(s, { from: step.from, to: step.to }).state : playOpponentMove(s)
  }
  return s
}

describe('createDrill', () => {
  it('starts on the user move when playing White', () => {
    const s = createDrill(italian('white'))
    expect(s.status).toBe('awaitingUser')
    expect(s.fen).toBe(START)
    expect(expectedMove(s)?.san).toBe('e4')
  })

  it('starts with the opponent reply when playing Black', () => {
    const s = createDrill(italian('black'))
    expect(s.status).toBe('awaitingOpponent')
    expect(expectedMove(s)).toBeUndefined()

    const after = playOpponentMove(s)
    expect(after.fen).toBe(AFTER_E4)
    expect(after.lastMove).toEqual({ from: 'e2', to: 'e4' })
    expect(after.status).toBe('awaitingUser')
    expect(expectedMove(after)?.san).toBe('e5')
  })

  it('rejects a line with an illegal move', () => {
    expect(() => createDrill({ ...italian('white'), moves: ['e4', 'e5', 'Ke3'] })).toThrow(
      /illegal move Ke3 at ply 2/,
    )
  })

  it('supports a custom start position', () => {
    const s = createDrill({
      id: 'after-e4',
      name: 'From 1.e4',
      side: 'black',
      startFen: AFTER_E4,
      moves: ['c5', 'Nf3'],
    })
    expect(s.status).toBe('awaitingUser')
    expect(expectedMove(s)?.san).toBe('c5')
  })
})

describe('submitMove', () => {
  it('correct: advances, then waits for the opponent reply', () => {
    const { state, result } = submitMove(createDrill(italian('white')), { from: 'e2', to: 'e4' })
    expect(result).toBe('correct')
    expect(state.fen).toBe(AFTER_E4)
    expect(state.ply).toBe(1)
    expect(state.status).toBe('awaitingOpponent')
    expect(state.lastMove).toEqual({ from: 'e2', to: 'e4' })
    expect(state.records).toEqual([{ ply: 0, misses: 0, hintUsed: false }])

    const replied = playOpponentMove(state)
    expect(replied.status).toBe('awaitingUser')
    expect(expectedMove(replied)?.san).toBe('Nf3')
  })

  it('wrong once: counts a miss, keeps the position, no arrow yet', () => {
    const start = createDrill(italian('white'))
    const { state, result } = submitMove(start, { from: 'd2', to: 'd4' })
    expect(result).toBe('wrong')
    expect(state.fen).toBe(START)
    expect(state.ply).toBe(0)
    expect(state.status).toBe('awaitingUser')
    expect(state.misses).toBe(1)
    expect(state.hint).toBe('none')
  })

  it('wrong twice: shows the arrow, and the eventual success records both', () => {
    let s = createDrill(italian('white'))
    s = submitMove(s, { from: 'd2', to: 'd4' }).state
    s = submitMove(s, { from: 'g1', to: 'f3' }).state
    expect(s.misses).toBe(2)
    expect(s.hint).toBe('arrow')
    expect(expectedMove(s)).toMatchObject({ from: 'e2', to: 'e4' })

    const { state, result } = submitMove(s, { from: 'e2', to: 'e4' })
    expect(result).toBe('correct')
    expect(state.misses).toBe(0)
    expect(state.hint).toBe('none')
    expect(state.records).toEqual([{ ply: 0, misses: 2, hintUsed: true }])
  })

  it('illegal: no miss and no change', () => {
    const start = createDrill(italian('white'))
    const { state, result } = submitMove(start, { from: 'e2', to: 'e5' })
    expect(result).toBe('illegal')
    expect(state).toBe(start)
  })

  it('ignores input while the opponent is to move or after completion', () => {
    const black = createDrill(italian('black'))
    expect(submitMove(black, { from: 'e7', to: 'e5' })).toEqual({ state: black, result: 'ignored' })

    const done = playThrough(createDrill(italian('white')))
    expect(submitMove(done, { from: 'e8', to: 'g8' }).result).toBe('ignored')
  })

  it('accepts castling as a king move to the g-file', () => {
    // 1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5 4.O-O
    const line: Line = { ...italian('white'), moves: [...ITALIAN.slice(0, 6), 'O-O'] }
    let s = createDrill(line)
    for (let i = 0; i < 6; i++) {
      const step = expectedMove(s)
      s = step ? submitMove(s, step).state : playOpponentMove(s)
    }
    const { state, result } = submitMove(s, { from: 'e1', to: 'g1' })
    expect(result).toBe('correct')
    expect(state.status).toBe('complete')
  })

  it('requires the right promotion piece', () => {
    const line: Line = {
      id: 'promo',
      name: 'Promotion',
      side: 'white',
      startFen: '8/4P3/8/8/8/8/k7/4K3 w - - 0 1',
      moves: ['e8=Q'],
    }
    const s = createDrill(line)
    const under: MoveInput = { from: 'e7', to: 'e8', promotion: 'n' }
    expect(submitMove(s, under).result).toBe('wrong')
    expect(submitMove(s, { from: 'e7', to: 'e8', promotion: 'q' }).result).toBe('correct')
  })
})

describe('line complete', () => {
  it('as White: ends on the last user move with one record per user move', () => {
    const done = playThrough(createDrill(italian('white')))
    expect(done.status).toBe('complete')
    expect(done.fen).toBe(AFTER_D4)
    expect(done.lastMove).toEqual({ from: 'd2', to: 'd4' })
    expect(done.records.map((r) => r.ply)).toEqual([0, 2, 4, 6, 8])
  })

  it('as Black: ends on the opponent reply after the last user move', () => {
    const done = playThrough(createDrill(italian('black')))
    expect(done.status).toBe('complete')
    expect(done.fen).toBe(AFTER_D4)
    expect(done.records.map((r) => r.ply)).toEqual([1, 3, 5, 7])
  })

  it('playOpponentMove is a no-op when it is not the opponent turn', () => {
    const s = createDrill(italian('white'))
    expect(playOpponentMove(s)).toBe(s)
  })
})

describe('requestHint', () => {
  it('escalates piece, then arrow, and marks the move as hinted', () => {
    let s = createDrill(italian('white'))
    s = requestHint(s)
    expect(s.hint).toBe('piece')
    s = requestHint(s)
    expect(s.hint).toBe('arrow')
    s = requestHint(s)
    expect(s.hint).toBe('arrow')

    const { state } = submitMove(s, { from: 'e2', to: 'e4' })
    expect(state.records).toEqual([{ ply: 0, misses: 0, hintUsed: true }])
  })

  it('a hint plus one miss reaches the arrow', () => {
    let s = requestHint(createDrill(italian('white')))
    s = submitMove(s, { from: 'd2', to: 'd4' }).state
    expect(s.hint).toBe('piece')
    s = submitMove(s, { from: 'c2', to: 'c4' }).state
    expect(s.hint).toBe('arrow')
  })

  it('does nothing when it is not the user move', () => {
    const s = createDrill(italian('black'))
    expect(requestHint(s)).toBe(s)
  })
})
