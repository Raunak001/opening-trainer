import { describe, expect, it } from 'vitest'
import { positionKey } from '../positionKey'
import {
  addMove,
  children,
  createTree,
  findBySan,
  pathTo,
  setNodeStats,
  sideToMove,
  START_FEN,
  TreeError,
  type RepertoireTree,
} from '../tree'
import { ITALIAN_VIA_E4, ITALIAN_VIA_NF3, START_RESPONSE } from './fixtures'

/** Adds a SAN line from the root, returning the tree and the final node key. */
function addLine(tree: RepertoireTree, sans: string[]) {
  let t = tree
  let key = t.rootKey
  for (const san of sans) {
    const r = addMove(t, key, san)
    t = r.tree
    key = r.node.key
  }
  return { tree: t, key }
}

const ITALIAN_KEY = positionKey(ITALIAN_VIA_E4)

describe('createTree', () => {
  it('starts with a single root node', () => {
    const t = createTree()
    expect(t.rootKey).toBe(positionKey(START_FEN))
    expect(Object.keys(t.nodes)).toHaveLength(1)
    expect(t.nodes[t.rootKey]).toMatchObject({ ply: 0, edges: [], parents: [] })
  })
})

describe('addMove', () => {
  it('creates a child node and an edge with SAN, UCI and counts', () => {
    const [e4] = START_RESPONSE.moves
    const r = addMove(createTree(), positionKey(START_FEN), e4.san, e4)

    expect(r.created).toBe(true)
    expect(r.edge).toEqual({
      san: 'e4',
      uci: 'e2e4',
      to: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -',
      white: e4.white,
      draws: e4.draws,
      black: e4.black,
    })
    expect(r.node).toMatchObject({ ply: 1, parents: [{ from: r.tree.rootKey, san: 'e4' }] })
  })

  it('accepts from/to moves and normalises them to SAN', () => {
    const r = addMove(createTree(), positionKey(START_FEN), { from: 'g1', to: 'f3' })
    expect(r.edge).toMatchObject({ san: 'Nf3', uci: 'g1f3' })
  })

  it('updates an existing edge instead of duplicating it', () => {
    let t = addMove(createTree(), positionKey(START_FEN), 'e4').tree
    const r = addMove(t, t.rootKey, 'e4', { white: 5, draws: 1, black: 4 })
    t = r.tree

    expect(r.created).toBe(false)
    expect(t.nodes[t.rootKey].edges).toHaveLength(1)
    expect(t.nodes[t.rootKey].edges[0]).toMatchObject({ white: 5, draws: 1, black: 4 })
    expect(Object.keys(t.nodes)).toHaveLength(2)
  })

  it('rejects illegal moves and unknown positions', () => {
    const t = createTree()
    expect(() => addMove(t, t.rootKey, 'e5')).toThrow(TreeError)
    expect(() => addMove(t, 'nope w - -', 'e4')).toThrow(TreeError)
  })

  it('does not mutate the input tree', () => {
    const t = createTree()
    const snapshot = structuredClone(t)
    addMove(t, t.rootKey, 'e4', { white: 1, draws: 0, black: 0 })
    expect(t).toEqual(snapshot)
  })
})

describe('transpositions', () => {
  it('two move orders reach one node', () => {
    const viaE4 = addLine(createTree(), ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'])
    const both = addLine(viaE4.tree, ['Nf3', 'Nc6', 'e4', 'e5', 'Bc4'])
    const t = both.tree

    expect(viaE4.key).toBe(ITALIAN_KEY)
    expect(both.key).toBe(ITALIAN_KEY)
    // Positions: root, 1.e4, 1...e5, 2.Nf3, 2...Nc6, Italian (6)
    // + 1.Nf3, 1...Nc6, 2.e4 (3). 2...e5 transposes into 1.e4 e5 2.Nf3 Nc6.
    expect(Object.keys(t.nodes)).toHaveLength(9)

    const italian = t.nodes[ITALIAN_KEY]
    // Both orders merge already at 1.e4 e5 2.Nf3 Nc6, so the Italian has a single parent.
    expect(italian.parents).toEqual([{ from: expect.any(String), san: 'Bc4' }])
    const beforeBc4 = t.nodes[italian.parents[0].from]
    expect(beforeBc4.parents.map((p) => p.san).sort()).toEqual(['Nc6', 'e5'])

    // Both SAN paths resolve to the very same node object.
    expect(findBySan(t, ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'])).toBe(italian)
    expect(findBySan(t, ['Nf3', 'Nc6', 'e4', 'e5', 'Bc4'])).toBe(italian)
  })

  it('merges when the last move is the one that transposes', () => {
    // 1.d4 Nf6 2.c4 e6  vs  1.c4 e6 2.d4 Nf6
    const a = addLine(createTree(), ['d4', 'Nf6', 'c4', 'e6'])
    const b = addLine(a.tree, ['c4', 'e6', 'd4', 'Nf6'])

    expect(b.key).toBe(a.key)
    expect(b.tree.nodes[a.key].parents.map((p) => p.san).sort()).toEqual(['Nf6', 'e6'])
    expect(b.tree.nodes[a.key].edges).toEqual([])
  })

  it('lowers plies below a node when a shorter route to it is found', () => {
    // 1.e3 e6 2.e4 e5 reaches the position after 1.e4 e5, but at ply 4 instead of 2.
    const long = addLine(createTree(), ['e3', 'e6', 'e4', 'e5', 'Nf3'])
    const afterE5 = long.tree.nodes[long.key].parents[0].from
    expect(long.tree.nodes[afterE5].ply).toBe(4)
    expect(long.tree.nodes[long.key].ply).toBe(5)

    const short = addLine(long.tree, ['e4', 'e5'])
    expect(short.key).toBe(afterE5)
    expect(short.tree.nodes[afterE5].ply).toBe(2)
    expect(short.tree.nodes[long.key].ply).toBe(3)
    expect(pathTo(short.tree, long.key)).toEqual(['e4', 'e5', 'Nf3'])
  })

  it('treats a line that returns to the start as reaching the root', () => {
    const { tree } = addLine(createTree(), ['Nf3', 'Nf6', 'Ng1', 'Ng8'])
    expect(findBySan(tree, ['Nf3', 'Nf6', 'Ng1', 'Ng8'])).toBe(tree.nodes[tree.rootKey])
    expect(tree.nodes[tree.rootKey].ply).toBe(0)
    expect(Object.keys(tree.nodes)).toHaveLength(4)
  })
})

describe('queries', () => {
  it('pathTo returns a shortest SAN line from the root', () => {
    const viaE4 = addLine(createTree(), ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'])
    const t = addLine(viaE4.tree, ['Nf3', 'Nc6', 'e4', 'e5', 'Bc4']).tree

    const path = pathTo(t, ITALIAN_KEY)
    expect(path).toHaveLength(5)
    expect(findBySan(t, path)?.key).toBe(ITALIAN_KEY)
    expect(pathTo(t, t.rootKey)).toEqual([])
  })

  it('pathTo terminates when a line cycles back to the root', () => {
    const { tree, key } = addLine(createTree(), ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'd4'])
    expect(pathTo(tree, key)).toEqual(['d4'])
  })

  it('children lists edges with their target nodes', () => {
    let t = addMove(createTree(), positionKey(START_FEN), 'e4').tree
    t = addMove(t, t.rootKey, 'd4').tree
    expect(children(t, t.rootKey).map((c) => [c.edge.san, c.node.ply])).toEqual([
      ['e4', 1],
      ['d4', 1],
    ])
  })

  it('sets node totals and reports side to move', () => {
    const t = setNodeStats(createTree(), positionKey(START_FEN), START_RESPONSE)
    expect(t.nodes[t.rootKey]).toMatchObject({ white: 1_200_000, draws: 110_000, black: 1_100_000 })
    expect(t.nodes[t.rootKey]).not.toHaveProperty('moves')
    expect(sideToMove(t.rootKey)).toBe('white')
    expect(sideToMove(positionKey(ITALIAN_VIA_NF3))).toBe('black')
  })

  it('round-trips through JSON (storable as plain data)', () => {
    const { tree } = addLine(createTree(), ['e4', 'e5', 'Nf3'])
    expect(JSON.parse(JSON.stringify(tree))).toEqual(tree)
  })
})
