import { describe, expect, it } from 'vitest'
import { DEFAULT_PRUNE_SETTINGS } from '../prune'
import { addMove, createTree, setNodeStats, type RepertoireTree } from '../tree'
import {
  allExpandable,
  childViews,
  expandedToPly,
  formatGames,
  formatPercent,
  moveLabel,
  overrideCandidates,
  resultSplit,
  userMoves,
  withOverride,
} from '../treeView'
import { keyAfter, world } from './fakeWorld'
import startJson from './fixtures/start.json'
import type { ExplorerResponse } from '../explorer'

function addLine(tree: RepertoireTree, line: string) {
  let t = tree
  let key = t.rootKey
  for (const san of line.split(' ')) {
    const r = addMove(t, key, san, { white: 6, draws: 1, black: 3 })
    t = r.tree
    key = r.node.key
  }
  return t
}

describe('labels and formatting', () => {
  it('numbers moves by the parent ply', () => {
    expect(moveLabel(0, 'e4')).toBe('1.e4')
    expect(moveLabel(1, 'e5')).toBe('1…e5')
    expect(moveLabel(22, 'Nf3')).toBe('12.Nf3')
  })

  it('splits results into percentages', () => {
    expect(resultSplit({ white: 50, draws: 10, black: 40 })).toEqual({
      white: 50,
      draws: 10,
      black: 40,
    })
    expect(resultSplit({ white: 0, draws: 0, black: 0 })).toEqual({ white: 0, draws: 0, black: 0 })
  })

  it('formats shares and game counts compactly', () => {
    expect(formatPercent(0.6115)).toBe('61%')
    expect(formatPercent(0.0352)).toBe('3.5%')
    expect(formatPercent(0.0004)).toBe('<0.1%')
    expect(formatPercent(0)).toBe('0%')
    expect(formatGames(950)).toBe('950')
    expect(formatGames(1234)).toBe('1.2k')
    expect(formatGames(56_000)).toBe('56k')
    expect(formatGames(1_157_866_480)).toBe('1.2B')
  })
})

describe('childViews', () => {
  it('reports stats from the parent position and the user side', () => {
    let tree = addMove(createTree(), keyAfter(''), 'e4', { white: 60, draws: 10, black: 30 }).tree
    tree = addMove(tree, tree.rootKey, 'd4', { white: 20, draws: 0, black: 30 }).tree
    tree = setNodeStats(tree, tree.rootKey, { white: 100, draws: 20, black: 80 })

    const [e4, d4] = childViews(tree, tree.rootKey, 'black')
    expect(e4).toMatchObject({
      label: '1.e4',
      games: 100,
      share: 0.5,
      score: 0.35, // Black's score: (30 + 10/2) / 100
      mover: 'white',
      canonical: true,
    })
    expect(d4).toMatchObject({ label: '1.d4', games: 50, share: 0.25 })
  })

  it('has no share when the parent was never looked up', () => {
    const tree = addLine(createTree(), 'e4')
    expect(childViews(tree, tree.rootKey, 'white')[0].share).toBeUndefined()
  })

  it('marks transpositions and moves back to earlier positions as non-canonical', () => {
    // Italian via two orders: the node is shown under 1.e4 e5 2.Nf3 Nc6, not 1.Nf3 Nc6 2.e4 e5.
    let tree = addLine(createTree(), 'e4 e5 Nf3 Nc6')
    tree = addLine(tree, 'Nf3 Nc6 e4 e5')
    const viaE4 = childViews(tree, keyAfter('e4 e5 Nf3'), 'white')
    const viaNf3 = childViews(tree, keyAfter('Nf3 Nc6 e4'), 'white')
    expect(viaE4[0]).toMatchObject({ label: '2…Nc6', canonical: true })
    expect(viaNf3[0]).toMatchObject({ label: '2…e5', canonical: false })

    // Knight out and back: the edge to the start position is not canonical.
    const loop = addLine(createTree(), 'Nf3 Nf6 Ng1 Ng8')
    expect(childViews(loop, keyAfter('Nf3 Nf6 Ng1'), 'white')[0]).toMatchObject({
      canonical: false,
    })
  })
})

describe('expansion helpers', () => {
  it('expands shallow positions and everything with children', () => {
    const tree = addLine(addLine(createTree(), 'e4 e5 Nf3'), 'd4')
    expect(expandedToPly(tree, 2)).toEqual(new Set([tree.rootKey, keyAfter('e4'), keyAfter('d4')]))
    expect(allExpandable(tree)).toEqual(new Set([tree.rootKey, keyAfter('e4'), keyAfter('e4 e5')]))
  })
})

describe('overrideCandidates', () => {
  it('lists explorer moves with the automatic pick and the current move (start, real data)', () => {
    const candidates = overrideCandidates(startJson as ExplorerResponse, {
      ply: 0,
      userColor: 'white',
      settings: DEFAULT_PRUNE_SETTINGS,
      currentSan: 'e4',
    })
    expect(candidates.slice(0, 3).map((c) => c.san)).toEqual(['e4', 'd4', 'c4'])
    expect(candidates.find((c) => c.auto)?.san).toBe('d4')
    expect(candidates.find((c) => c.current)?.san).toBe('e4')
    expect(candidates.find((c) => c.san === 'c4')).toMatchObject({ eligible: false })
    expect(candidates.find((c) => c.san === 'd4')?.share).toBeCloseTo(0.257, 3)
  })

  it('skips moves with no games', () => {
    const data = world({ '': [['e4', 1, 0, 0]] })
    const response = data.get(keyAfter('')) as ExplorerResponse
    response.moves.push({ ...response.moves[0], san: 'd4', white: 0 })
    const c = overrideCandidates(response, {
      ply: 0,
      userColor: 'white',
      settings: DEFAULT_PRUNE_SETTINGS,
    })
    expect(c.map((x) => x.san)).toEqual(['e4'])
  })
})

describe('withOverride', () => {
  it('records a non-automatic choice and clears it when the automatic pick is chosen', () => {
    const one = withOverride(undefined, 'k1', 'Bc4', 'Nf3')
    expect(one).toEqual({ k1: 'Bc4' })
    const two = withOverride(one, 'k2', 'c3', 'Nf3')
    expect(two).toEqual({ k1: 'Bc4', k2: 'c3' })
    expect(withOverride(two, 'k1', 'Nf3', 'Nf3')).toEqual({ k2: 'c3' })
    expect(one).toEqual({ k1: 'Bc4' }) // inputs untouched
  })
})

describe('userMoves', () => {
  it("lists the user's moves, shallowest first, with each position's FEN", () => {
    let tree = createTree()
    tree = addLine(tree, 'e4 e5 Nf3 Nc6')
    tree = addLine(tree, 'e4 c5 c3')
    const moves = userMoves(tree, 'white')
    expect(moves.map((m) => m.san)).toEqual(['e4', 'Nf3', 'c3'])
    expect(moves[0].fen).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')
    expect(
      userMoves(tree, 'black')
        .map((m) => m.san)
        .sort(),
    ).toEqual(['Nc6', 'c5', 'e5'])
  })
})
