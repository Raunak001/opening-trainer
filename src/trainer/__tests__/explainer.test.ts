import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { TrainerDB } from '../../db'
import { EngineError } from '../../engine'
import { positionKey } from '../../repertoire/positionKey'
import { stubEngine } from '../../engine/__tests__/stubEngine'
import { createMoveExplainer, drillFeedback } from '../explainer'

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
const NC6 = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3'
const AFTER_BA6 = 'r1bqkbnr/pppp1ppp/B1n5/4p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3'

const names: string[] = []
const openDb = () => {
  const name = `explainer-test-${names.length}`
  names.push(name)
  return new TrainerDB(name)
}
afterEach(async () => {
  for (const n of names.splice(0)) await Dexie.delete(n)
})

describe('createMoveExplainer', () => {
  it('grades the move with settings depth and explains it', async () => {
    const { engine, searched } = stubEngine({
      [positionKey(NC6)]: { score: { type: 'cp', value: 39 }, pv: ['f1b5', 'a7a6'] },
      [positionKey(AFTER_BA6)]: { score: { type: 'cp', value: 290 }, pv: ['b7a6', 'd2d4'] },
    })
    const explain = createMoveExplainer(openDb(), () => engine)
    const explanation = await explain({
      fen: NC6,
      move: { from: 'f1', to: 'a6' },
      startFen: START,
      previous: ['e4', 'e5', 'Nf3', 'Nc6'],
    })
    if (!explanation) throw new Error('expected an explanation')
    expect(explanation.grade).toBe('blunder')
    expect(explanation.reason).toBe('This leaves your bishop on a6 hanging.')
    expect(searched).toHaveLength(2)
    expect(drillFeedback('Ba6', explanation, false)).toBe(
      'Ba6 is a blunder. This leaves your bishop on a6 hanging.',
    )
    expect(drillFeedback('Ba6', explanation, true)).toBe(
      'Ba6 is a blunder. This leaves your bishop on a6 hanging. Best was Bb5 (+0.4).',
    )
  })

  it('returns undefined when no engine is available', async () => {
    const explain = createMoveExplainer(openDb(), () => {
      throw new EngineError('Web Workers are not available')
    })
    await expect(
      explain({ fen: NC6, move: { from: 'f1', to: 'a6' }, startFen: START, previous: [] }),
    ).resolves.toBeUndefined()
  })
})

describe('drillFeedback', () => {
  it('calls a good off-repertoire move playable', () => {
    const text = drillFeedback(
      'Nc3',
      {
        grade: 'good',
        label: 'good move',
        evalBest: '+0.3',
        evalPlayed: '+0.2',
        best: 'Best was Nf3 (+0.3).',
        findings: [],
      },
      false,
    )
    expect(text).toBe("Nc3 is playable (+0.2), but it isn't your repertoire move.")
  })

  it('uses "an" before vowels', () => {
    const text = drillFeedback(
      'h3',
      {
        grade: 'inaccuracy',
        label: 'inaccuracy',
        evalBest: '+0.4',
        evalPlayed: '-0.2',
        findings: [],
      },
      false,
    )
    expect(text).toBe('h3 is an inaccuracy.')
  })
})
