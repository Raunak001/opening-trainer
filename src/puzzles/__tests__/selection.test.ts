import { describe, expect, it } from 'vitest'
import { pickPuzzle, targetRating } from '../selection'

const c = (id: string, rating: number) => ({ id, rating })
const POOL = [c('a', 600), c('b', 980), c('c', 1020), c('d', 1150), c('e', 1600)]

describe('pickPuzzle', () => {
  it('picks within the narrowest window that has an unseen puzzle', () => {
    const ids = new Set<string>()
    for (const r of [0, 0.49, 0.5, 0.99])
      ids.add(pickPuzzle(POOL, 1000, new Set(), () => r)?.id ?? '')
    expect([...ids].sort()).toEqual(['b', 'c'])
  })

  it('skips seen puzzles and widens the window', () => {
    expect(pickPuzzle(POOL, 1000, new Set(['b', 'c']), () => 0)?.id).toBe('d')
  })

  it('repeats a seen puzzle near the rating before going far away', () => {
    const pool = [c('b', 1000), c('e', 2500)]
    expect(pickPuzzle(pool, 1000, new Set(['b']), () => 0)?.id).toBe('b')
  })

  it('falls back to the closest puzzle when nothing is within range', () => {
    expect(pickPuzzle([c('x', 2600), c('y', 2400)], 500, new Set())?.id).toBe('y')
    expect(pickPuzzle([], 1000, new Set())).toBeUndefined()
  })

  it('aims at the rounded rating', () => {
    expect(targetRating(1234.6)).toBe(1235)
  })
})
