import { State } from 'ts-fsrs'
import { describe, expect, it } from 'vitest'
import type { CardRow } from '../../db'
import { addMove, createTree, type RepertoireTree } from '../../repertoire/tree'
import { keyAfter } from '../../repertoire/__tests__/fakeWorld'
import { cardTargets, planCardSync, type CardTarget } from '../cards'

const NOW = new Date('2026-11-06T12:00:00Z')

function addLine(tree: RepertoireTree, line: string) {
  let t = tree
  let key = t.rootKey
  for (const san of line.split(' ')) {
    const r = addMove(t, key, san)
    t = r.tree
    key = r.node.key
  }
  return t
}

// White repertoire: 1.e4, then 2.Nf3 vs 1...e5 and 2.c3 vs 1...c5; the c5 line stops after 2...d5.
const TREE = addLine(addLine(createTree(), 'e4 e5 Nf3 Nc6'), 'e4 c5 c3 d5')

describe('cardTargets', () => {
  it('makes one card per user-to-move position with an answer', () => {
    expect(cardTargets(TREE, 'white')).toEqual([
      { positionKey: keyAfter(''), answer: 'e4' },
      { positionKey: keyAfter('e4 c5'), answer: 'c3' },
      { positionKey: keyAfter('e4 e5'), answer: 'Nf3' },
    ])
  })

  it('skips user-to-move leaves with no answer', () => {
    // After 2...Nc6 and 2...d5 it is White's move, but the tree has no move there.
    const keys = cardTargets(TREE, 'white').map((t) => t.positionKey)
    expect(keys).not.toContain(keyAfter('e4 e5 Nf3 Nc6'))
    expect(keys).not.toContain(keyAfter('e4 c5 c3 d5'))
  })

  it('uses Black-to-move positions for a Black repertoire', () => {
    expect(cardTargets(TREE, 'black')).toEqual(
      expect.arrayContaining([
        { positionKey: keyAfter('e4'), answer: 'e5' },
        { positionKey: keyAfter('e4 e5 Nf3'), answer: 'Nc6' },
        { positionKey: keyAfter('e4 c5 c3'), answer: 'd5' },
      ]),
    )
  })
})

describe('planCardSync', () => {
  const targets = cardTargets(TREE, 'white')
  const first = planCardSync('rep', targets, [], NOW)

  it('creates fresh New cards with ids `${repertoireId}:${positionKey}`', () => {
    expect(first.add).toHaveLength(3)
    expect(first.add[1]).toMatchObject({
      id: `rep:${keyAfter('e4 c5')}`,
      repertoireId: 'rep',
      positionKey: keyAfter('e4 c5'),
      answer: 'c3',
      state: State.New,
      reps: 0,
      due: NOW,
    })
    expect(first.add[1]).not.toHaveProperty('suspended')
  })

  it('is a no-op when nothing changed', () => {
    const again = planCardSync('rep', targets, first.add, NOW)
    expect(again).toMatchObject({ add: [], reset: [], suspend: [], resume: [], unchanged: 3 })
  })

  /** Existing cards that have been studied a bit. */
  const studied: CardRow[] = first.add.map((c) => ({ ...c, reps: 4, state: State.Review }))

  it('resets a card whose expected move changed', () => {
    const swapped: CardTarget[] = targets.map((t) =>
      t.positionKey === keyAfter('e4 e5') ? { ...t, answer: 'Bc4' } : t,
    )
    const plan = planCardSync('rep', swapped, studied, NOW)
    expect(plan.reset).toHaveLength(1)
    expect(plan.reset[0]).toMatchObject({ answer: 'Bc4', reps: 0, state: State.New })
    expect(plan.unchanged).toBe(2)
  })

  it('suspends cards for positions that left the tree, then resumes them unchanged', () => {
    const without = targets.filter((t) => t.positionKey !== keyAfter('e4 c5'))
    const plan = planCardSync('rep', without, studied, NOW)
    expect(plan.suspend).toEqual([{ ...studied[1], suspended: true }])

    const stored = studied.map((c) => (c.id === plan.suspend[0].id ? plan.suspend[0] : c))
    // Already suspended: not suspended twice.
    expect(planCardSync('rep', without, stored, NOW).suspend).toEqual([])

    const back = planCardSync('rep', targets, stored, NOW)
    expect(back.resume).toEqual([{ ...studied[1], suspended: false }])
    expect(back.resume[0].reps).toBe(4) // history kept
  })

  it('resets rather than resumes when a position comes back with a different move', () => {
    const suspended = studied.map((c, i) => (i === 1 ? { ...c, suspended: true } : c))
    const changed = targets.map((t) =>
      t.positionKey === keyAfter('e4 c5') ? { ...t, answer: 'Nf3' } : t,
    )
    const plan = planCardSync('rep', changed, suspended, NOW)
    expect(plan.resume).toEqual([])
    expect(plan.reset[0]).toMatchObject({ answer: 'Nf3', reps: 0 })
    expect(plan.reset[0]).not.toHaveProperty('suspended')
  })
})
