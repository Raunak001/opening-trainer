import { describe, expect, it } from 'vitest'
import { sameDiagonal, squareColor, type Square } from '../squares'
import { makeQuestion, makeQuestions, pieceReach } from '../visualize'
import { seeded } from './rng'

describe('visualize', () => {
  it('computes piece reach on an empty board', () => {
    expect(pieceReach('n', 'g1')).toEqual(['e2', 'f3', 'h3'])
    expect(pieceReach('n', 'd4')).toHaveLength(8)
    expect(pieceReach('b', 'c1')).toEqual(['a3', 'b2', 'd2', 'e3', 'f4', 'g5', 'h6'])
    expect(pieceReach('r', 'a1')).toHaveLength(14)
  })

  it('makes correct colour questions', () => {
    const rng = seeded(11)
    for (let i = 0; i < 30; i++) {
      const q = makeQuestion('color', rng)
      expect(q.answer).toBe(squareColor(q.reveal[0]))
    }
  })

  it('makes correct diagonal questions, both answers', () => {
    const rng = seeded(5)
    const answers = new Set<string>()
    for (let i = 0; i < 40; i++) {
      const q = makeQuestion('diagonal', rng)
      const [a, b] = q.reveal
      expect(q.answer).toBe(sameDiagonal(a, b) ? 'yes' : 'no')
      answers.add(q.answer)
    }
    expect(answers).toEqual(new Set(['yes', 'no']))
  })

  it('makes reach questions with exactly one reachable option', () => {
    const rng = seeded(9)
    for (const kind of ['knight', 'bishop'] as const) {
      for (let i = 0; i < 30; i++) {
        const q = makeQuestion(kind, rng)
        const reach = pieceReach(kind === 'knight' ? 'n' : 'b', q.reveal[0])
        expect(q.options).toContain(q.answer)
        expect(new Set(q.options).size).toBe(q.options.length)
        expect(q.options.filter((o) => reach.includes(o as Square))).toEqual([q.answer])
      }
    }
  })

  it('mixes every kind into a round', () => {
    const qs = makeQuestions(10, seeded(2))
    expect(qs).toHaveLength(10)
    expect(new Set(qs.map((q) => q.kind)).size).toBe(4)
  })
})
