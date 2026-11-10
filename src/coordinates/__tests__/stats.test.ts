import { describe, expect, it } from 'vitest'
import type { CoordStatRow } from '../../db/db'
import { heatmap, recordAnswer, recordAnswers, statKey, strength, weakest } from '../stats'

const row = (over: Partial<CoordStatRow>): CoordStatRow => ({
  key: 'find:white:e4',
  mode: 'find',
  view: 'white',
  square: 'e4',
  attempts: 0,
  misses: 0,
  correctMs: 0,
  lastAt: 0,
  ...over,
})

describe('stats', () => {
  it('records answers, timing only the correct ones', () => {
    const a = recordAnswer(undefined, {
      mode: 'find',
      view: 'white',
      square: 'e4',
      correct: true,
      ms: 1200,
      at: 5,
    })
    expect(a).toEqual(row({ attempts: 1, correctMs: 1200, lastAt: 5 }))
    const b = recordAnswer(a, {
      mode: 'find',
      view: 'white',
      square: 'e4',
      correct: false,
      ms: 900,
      at: 6,
    })
    expect(b).toMatchObject({ attempts: 2, misses: 1, correctMs: 1200, lastAt: 6 })
  })

  it('folds a round into stored rows, one row per key', () => {
    const stored = new Map([
      [
        statKey('name', 'black', 'g6'),
        row({
          key: 'name:black:g6',
          mode: 'name',
          view: 'black',
          square: 'g6',
          attempts: 4,
          misses: 1,
          correctMs: 6000,
        }),
      ],
    ])
    const out = recordAnswers(stored, [
      { mode: 'name', view: 'black', square: 'g6', correct: true, ms: 1000, at: 1 },
      { mode: 'name', view: 'black', square: 'g6', correct: false, ms: 4000, at: 2 },
      { mode: 'name', view: 'black', square: 'b3', correct: true, ms: 2000, at: 3 },
    ])
    expect(out).toHaveLength(2)
    expect(out.find((r) => r.square === 'g6')).toMatchObject({
      attempts: 6,
      misses: 2,
      correctMs: 7000,
    })
    expect(out.find((r) => r.square === 'b3')).toMatchObject({ attempts: 1, misses: 0 })
  })

  it('scales strength down for slow answers', () => {
    expect(strength(1, 1000)).toBe(1)
    expect(strength(1, 6000)).toBe(0.5)
    expect(strength(0.5, undefined)).toBe(0.5)
  })

  it('builds a heatmap filtered by view and mode', () => {
    const rows = [
      row({ attempts: 4, misses: 1, correctMs: 3000 }),
      row({ key: 'name:white:e4', mode: 'name', attempts: 2, misses: 1, correctMs: 1000 }),
      row({ key: 'find:black:e4', view: 'black', attempts: 10, misses: 10 }),
      row({ key: 'find:white:a1', square: 'a1', attempts: 0 }),
    ]
    const white = heatmap(rows, { view: 'white' })
    expect(white.size).toBe(1)
    expect(white.get('e4')).toMatchObject({ attempts: 6, correct: 4, accuracy: 4 / 6, avgMs: 1000 })
    expect(heatmap(rows, { view: 'white', modes: ['name'] }).get('e4')?.attempts).toBe(2)
    const black = heatmap(rows, { view: 'black' }).get('e4')
    expect(black).toMatchObject({ accuracy: 0, strength: 0 })
    expect(black?.avgMs).toBeUndefined()
  })

  it('lists the weakest squares first', () => {
    const cells = heatmap([
      row({ attempts: 5, misses: 0, correctMs: 5000 }),
      row({ key: 'find:white:b6', square: 'b6', attempts: 5, misses: 3, correctMs: 6000 }),
      row({ key: 'find:white:g3', square: 'g3', attempts: 5, misses: 0, correctMs: 20000 }),
    ])
    expect(weakest(cells, 2).map((c) => c.square)).toEqual(['b6', 'g3'])
  })
})
