import { describe, expect, it } from 'vitest'
import {
  createPlayout,
  gradeCounts,
  playEngineMove,
  playoutSummary,
  playUserMove,
  setGrade,
  userMovesPlayed,
} from '../playout'

// End of 1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5, White to move.
const ITALIAN = 'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4'
// Back rank: White mates with Ra8#.
const BACK_RANK = '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1'

describe('play-out state', () => {
  it('starts on the right side', () => {
    expect(createPlayout(ITALIAN, 'white', 10).status).toBe('awaitingUser')
    expect(createPlayout(ITALIAN, 'black', 10).status).toBe('awaitingEngine')
  })

  it('alternates user and engine moves', () => {
    let s = createPlayout(ITALIAN, 'white', 10)
    s = playUserMove(s, { from: 'c2', to: 'c3' })
    expect(s.status).toBe('awaitingEngine')
    expect(s.moves[0]).toMatchObject({ san: 'c3', uci: 'c2c3', byUser: true, fenBefore: ITALIAN })
    s = playEngineMove(s, 'g8f6')
    expect(s.status).toBe('awaitingUser')
    expect(s.moves.map((m) => m.san)).toEqual(['c3', 'Nf6'])
  })

  it('ignores illegal and out-of-turn moves', () => {
    const s = createPlayout(ITALIAN, 'white', 10)
    expect(playUserMove(s, { from: 'c2', to: 'c5' })).toBe(s)
    expect(playEngineMove(s, 'g8f6')).toBe(s)
    const afterUser = playUserMove(s, { from: 'c2', to: 'c3' })
    expect(playUserMove(afterUser, { from: 'd2', to: 'd3' })).toBe(afterUser)
  })

  it('ends after the engine answers the last user move', () => {
    let s = createPlayout(ITALIAN, 'white', 2)
    s = playEngineMove(playUserMove(s, { from: 'c2', to: 'c3' }), 'g8f6')
    s = playUserMove(s, { from: 'd2', to: 'd3' })
    expect(s.status).toBe('awaitingEngine')
    s = playEngineMove(s, 'd7d6')
    expect(s).toMatchObject({ status: 'complete', end: 'moves' })
    expect(userMovesPlayed(s)).toBe(2)
    expect(playUserMove(s, { from: 'a2', to: 'a3' })).toBe(s)
  })

  it('ends on checkmate', () => {
    const s = playUserMove(createPlayout(BACK_RANK, 'white', 10), { from: 'a1', to: 'a8' })
    expect(s).toMatchObject({ status: 'complete', end: 'checkmate' })
    expect(playoutSummary(s)).toBe('Checkmate.')
  })

  it('records grades on user moves only and summarises them', () => {
    let s = createPlayout(ITALIAN, 'white', 2)
    s = playEngineMove(playUserMove(s, { from: 'c2', to: 'c3' }), 'g8f6')
    s = playEngineMove(playUserMove(s, { from: 'f3', to: 'g5' }), 'd7d6')
    s = setGrade(s, 0, 'good')
    s = setGrade(s, 1, 'good') // engine move: ignored
    s = setGrade(s, 2, 'blunder')
    expect(gradeCounts(s)).toEqual({ book: 0, good: 1, inaccuracy: 0, mistake: 0, blunder: 1 })
    expect(playoutSummary(s)).toBe('Play-out finished. 1 good move, 1 blunder.')
  })
})
