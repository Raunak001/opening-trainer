import { createEmptyCard, State } from 'ts-fsrs'
import { describe, expect, it } from 'vitest'
import type { CardRow } from '../../db'
import { cardsByPosition, enumerateLines, lineCards, lineStatus } from '../lines'
import { buildOpeningIndex, parseOpeningsTsv } from '../openings'
import { addMove, createTree, setNodeStats, type GameStats, type RepertoireTree } from '../tree'
import { keyAfter } from './fakeWorld'

const g = (n: number): GameStats => ({ white: n, draws: 0, black: 0 })

/** Adds a SAN line with per-move game counts; node totals are set separately. */
function line(tree: RepertoireTree, moves: [san: string, games: number][]): RepertoireTree {
  let t = tree
  let key = t.rootKey
  for (const [san, games] of moves) {
    const r = addMove(t, key, san, g(games))
    t = r.tree
    key = r.node.key
  }
  return t
}

/**
 * Caro-Kann for Black. After 1.e4 c6 White plays 2.d4 (60%) or 2.Nc3 (20%).
 * 2.d4 d5 3.Nc3 (30%) and 2.Nc3 d5 3.d4 (50%) transpose to the same position.
 * 2.d4 d5 3.e5 (70%) is the Advance.
 */
function caroTree(): RepertoireTree {
  let t = createTree()
  t = line(t, [
    ['e4', 100],
    ['c6', 100],
    ['d4', 60],
    ['d5', 60],
    ['e5', 42],
    ['Bf5', 42],
  ])
  t = line(t, [
    ['e4', 100],
    ['c6', 100],
    ['d4', 60],
    ['d5', 60],
    ['Nc3', 18],
    ['dxe4', 18],
  ])
  t = line(t, [
    ['e4', 100],
    ['c6', 100],
    ['Nc3', 20],
    ['d5', 20],
    ['d4', 10],
  ])
  // Node totals (explorer games per position) drive the shares.
  t = setNodeStats(t, keyAfter('e4 c6'), g(100))
  t = setNodeStats(t, keyAfter('e4 c6 d4 d5'), g(60))
  t = setNodeStats(t, keyAfter('e4 c6 Nc3 d5'), g(20))
  t = setNodeStats(t, keyAfter('e4'), g(100))
  return t
}

const TSV = [
  'eco\tname\tpgn',
  'B10\tCaro-Kann Defense\t1. e4 c6',
  'B12\tCaro-Kann Defense: Advance Variation\t1. e4 c6 2. d4 d5 3. e5',
  'B15\tCaro-Kann Defense: Main Line\t1. e4 c6 2. d4 d5 3. Nc3 dxe4',
].join('\n')

describe('enumerateLines', () => {
  it('gives one line per leaf, transpositions once via the most popular path', () => {
    const lines = enumerateLines(caroTree(), 'black')
    expect(lines.map((l) => l.moves.join(' '))).toEqual([
      'e4 c6 d4 d5 e5 Bf5', // 0.6 × 0.7 = 0.42
      'e4 c6 d4 d5 Nc3 dxe4', // 0.6 × 0.3 = 0.18 (beats 2.Nc3 d5 3.d4: 0.2 × 0.5 = 0.10)
    ])
    expect(lines[0].frequency).toBeCloseTo(0.42)
    expect(lines[1].frequency).toBeCloseTo(0.18)
    expect(lines[0].id).toBe(keyAfter('e4 c6 d4 d5 e5 Bf5'))
    expect(lines[0].positions).toHaveLength(7)
    expect(lines[0].positions[0]).toBe(caroTree().rootKey)
  })

  it('orders by how often you meet the line', () => {
    let t = caroTree()
    // Make 3.Nc3 the most common reply instead.
    t = line(t, [
      ['e4', 100],
      ['c6', 100],
      ['d4', 60],
      ['d5', 60],
      ['Nc3', 50],
    ])
    const lines = enumerateLines(t, 'black')
    expect(lines[0].moves.slice(4, 5)).toEqual(['Nc3'])
  })

  it('names each line by its deepest named position', () => {
    const index = buildOpeningIndex(parseOpeningsTsv(TSV))
    const lines = enumerateLines(caroTree(), 'black', index)
    expect(lines.map((l) => l.name)).toEqual([
      'Caro-Kann Defense: Advance Variation',
      'Caro-Kann Defense: Main Line',
    ])
  })

  it('has no lines for an empty tree', () => {
    expect(enumerateLines(createTree(), 'white')).toEqual([])
  })
})

describe('lineStatus', () => {
  const card = (key: string, state: State, suspended = false): CardRow => ({
    ...createEmptyCard(new Date(2026, 10, 1)),
    state,
    id: `r:${key}`,
    repertoireId: 'r',
    positionKey: key,
    answer: 'x',
    suspended,
  })
  const [advance] = enumerateLines(caroTree(), 'black')
  // Black's cards on the Advance line: after 1.e4, after 2.d4, after 3.e5.
  const keys = ['e4', 'e4 c6 d4', 'e4 c6 d4 d5 e5'].map(keyAfter)

  it('picks the line’s live cards in move order', () => {
    const cards = cardsByPosition([
      card(keys[2], State.New),
      card(keys[0], State.New),
      card(keys[1], State.New, true),
      card(keyAfter('e4 c6 Nc3'), State.New),
    ])
    expect(lineCards(advance, cards).map((c) => c.positionKey)).toEqual([keys[0], keys[2]])
  })

  it('new → learning → learned, and a lapse makes it learning again', () => {
    const status = (...states: State[]) =>
      lineStatus(lineCards(advance, cardsByPosition(keys.map((k, i) => card(k, states[i])))))
    expect(status(State.New, State.New, State.New)).toBe('new')
    expect(status(State.Review, State.New, State.New)).toBe('learning')
    expect(status(State.Learning, State.Learning, State.Review)).toBe('learned')
    expect(status(State.Review, State.Review, State.Review)).toBe('learned')
    expect(status(State.Review, State.Relearning, State.Review)).toBe('learning')
  })
})
