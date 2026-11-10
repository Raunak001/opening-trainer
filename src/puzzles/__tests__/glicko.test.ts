import { describe, expect, it } from 'vitest'
import { DEFAULT_GLICKO, expectedScore, INITIAL_RATING, updateRating } from '../glicko'

describe('Glicko-2', () => {
  it("matches Glickman's worked example for a single game (no RD floor)", () => {
    // Player 1500/200/0.06 beats a 1400/30 opponent: one game of the paper's example.
    const r = updateRating({ rating: 1500, rd: 200, vol: 0.06 }, 1400, true, {
      ...DEFAULT_GLICKO,
      puzzleRd: 30,
      minRd: 0,
    })
    // Reference values from an independent implementation of the paper's steps 1–8.
    expect(r.rating).toBeCloseTo(1563.6, 0)
    expect(r.rd).toBeCloseTo(175.4, 0)
    expect(r.vol).toBeCloseTo(0.06, 3)
  })

  it('starts at 1000 and moves fast at first', () => {
    const win = updateRating(INITIAL_RATING, 1000, true)
    const loss = updateRating(INITIAL_RATING, 1000, false)
    expect(win.rating).toBeGreaterThan(1100)
    expect(loss.rating).toBeLessThan(900)
    expect(win.rd).toBeLessThan(INITIAL_RATING.rd)
  })

  it('settles: a settled player moves less, and RD never drops below the floor', () => {
    let p = INITIAL_RATING
    for (let i = 0; i < 200; i++) p = updateRating(p, 1000, i % 2 === 0)
    expect(p.rd).toBeGreaterThanOrEqual(DEFAULT_GLICKO.minRd)
    expect(p.rd).toBeLessThan(80)
    const floored = updateRating(p, 1000, true, { ...DEFAULT_GLICKO, minRd: 100 })
    expect(floored.rd).toBe(100)
    const change = Math.abs(updateRating(p, p.rating, true).rating - p.rating)
    expect(change).toBeGreaterThan(3)
    expect(change).toBeLessThan(20)
  })

  it('rewards solving harder puzzles more', () => {
    const p = { rating: 1200, rd: 80, vol: 0.06 }
    const easy = updateRating(p, 900, true).rating - 1200
    const hard = updateRating(p, 1500, true).rating - 1200
    expect(hard).toBeGreaterThan(easy)
    expect(expectedScore(p, 900)).toBeGreaterThan(expectedScore(p, 1500))
  })

  it('climbs when the user keeps solving puzzles at their rating', () => {
    let p = INITIAL_RATING
    for (let i = 0; i < 30; i++) p = updateRating(p, Math.round(p.rating), true)
    expect(p.rating).toBeGreaterThan(1500)
  })

  it('never goes below the floor', () => {
    let p = INITIAL_RATING
    for (let i = 0; i < 100; i++) p = updateRating(p, 100, false)
    expect(p.rating).toBe(DEFAULT_GLICKO.floor)
  })
})
