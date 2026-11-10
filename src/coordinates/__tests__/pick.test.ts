import { describe, expect, it } from 'vitest'
import type { CoordStatRow } from '../../db/db'
import { pickSquare, shuffle, squareWeight, UNSEEN_WEIGHT } from '../pick'
import { heatmap } from '../stats'
import { seeded } from './rng'

const stat = (
  square: string,
  attempts: number,
  misses: number,
  correctMs: number,
): CoordStatRow => ({
  key: `find:white:${square}`,
  mode: 'find',
  view: 'white',
  square,
  attempts,
  misses,
  correctMs,
  lastAt: 0,
})

describe('pick', () => {
  it('weights unseen, missed and slow squares above known ones', () => {
    const cells = heatmap([
      stat('e4', 20, 0, 20 * 800),
      stat('b6', 10, 5, 5 * 2000),
      stat('g3', 10, 0, 10 * 6000),
    ])
    const known = squareWeight(cells.get('e4'))
    expect(known).toBeCloseTo(1 + 6 * (1 / 22))
    expect(squareWeight(undefined)).toBe(UNSEEN_WEIGHT)
    expect(squareWeight(cells.get('b6'))).toBeGreaterThan(UNSEEN_WEIGHT)
    expect(squareWeight(cells.get('g3'))).toBeGreaterThan(known + 2)
  })

  it('picks missed squares far more often', () => {
    const rows = []
    for (const f of 'abcdefgh')
      for (const r of '12345678') rows.push(stat(`${f}${r}`, 20, 0, 20 * 800))
    rows[0] = stat('a1', 20, 15, 5 * 800)
    const cells = heatmap(rows)
    const rng = seeded(7)
    let a1 = 0
    for (let i = 0; i < 2000; i++) if (pickSquare(cells, rng) === 'a1') a1++
    // Uniform would be ~31 of 2000.
    expect(a1).toBeGreaterThan(120)
  })

  it('avoids recent squares', () => {
    const rng = seeded(3)
    for (let i = 0; i < 200; i++)
      expect(['e4', 'd4']).not.toContain(pickSquare(new Map(), rng, ['e4', 'd4']))
  })

  it('shuffles without losing items', () => {
    expect(shuffle([1, 2, 3, 4, 5], seeded(1)).sort()).toEqual([1, 2, 3, 4, 5])
  })
})
