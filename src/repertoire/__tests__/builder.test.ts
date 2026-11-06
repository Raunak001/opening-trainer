import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TrainerDB } from '../../db'
import {
  buildAndSave,
  buildRepertoire,
  listRepertoires,
  loadRepertoire,
  saveRepertoire,
  type BuildProgress,
} from '../builder'
import { createExplorerClient, dexieExplorerCache, type FetchFn } from '../explorer'
import { positionKey } from '../positionKey'
import { DEFAULT_PRUNE_SETTINGS } from '../prune'
import { findBySan, pathTo } from '../tree'
import { EMPTY, fakeClient, keyAfter, world } from './fakeWorld'

// White repertoire after 1.e4. Opponent shares are chosen so 85% coverage keeps two replies.
const E4_WORLD = world({
  '': [['e4', 60, 10, 30]],
  e4: [
    ['e5', 30, 10, 20], // 60%
    ['c5', 15, 5, 10], //  30% → 90% ≥ 85%, stop
    ['d5', 5, 1, 4], //    10% (cut)
  ],
  'e4 e5': [
    ['Nf3', 60, 0, 40], // scores 0.60
    ['Bc4', 50, 0, 50], // scores 0.50
  ],
  'e4 c5': [['Nf3', 50, 0, 50]],
  'e4 e5 Nf3': [['Nc6', 50, 0, 50]],
  'e4 c5 Nf3': [['d6', 50, 0, 50]],
  'e4 e5 Nf3 Nc6': [['Bc4', 50, 0, 50]],
  'e4 c5 Nf3 d6': [['d4', 50, 0, 50]],
  'e4 e5 Nf3 Nc6 Bc4': [['Bc5', 50, 0, 50]],
  'e4 c5 Nf3 d6 d4': [['cxd4', 50, 0, 50]],
  'e4 e5 Nf3 Nc6 Bc4 Bc5': [['c3', 50, 0, 50]],
  'e4 c5 Nf3 d6 d4 cxd4': [['Nxd4', 50, 0, 50]],
  // Deeper data exists but must never be requested at maxPly 6.
  'e4 e5 Nf3 Nc6 Bc4 Bc5 c3': [['Nf6', 50, 0, 50]],
  'e4 c5 Nf3 d6 d4 cxd4 Nxd4': [['Nf6', 50, 0, 50]],
  // Only reached when the user overrides 2.Nf3 with 2.Bc4.
  'e4 e5 Bc4': [
    ['Nf6', 30, 0, 30],
    ['Bc5', 20, 0, 20],
  ],
  'e4 e5 Bc4 Nf6': [['d3', 50, 0, 50]],
  'e4 e5 Bc4 Bc5': [['Qg4', 50, 0, 50]],
})

const BASE = {
  color: 'white' as const,
  startMoves: ['e4'],
  speeds: ['blitz', 'rapid'] as const,
  ratings: [1600, 1800] as const,
  settings: { ...DEFAULT_PRUNE_SETTINGS, maxPly: 6 },
}

describe('buildRepertoire', () => {
  it('builds the pruned tree breadth-first from the start moves', async () => {
    const { client, calls } = fakeClient(E4_WORLD)
    const { tree, lookups } = await buildRepertoire({ ...BASE, client })

    expect(findBySan(tree, ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'])).toBeDefined()
    expect(findBySan(tree, ['e4', 'c5', 'Nf3', 'd6', 'd4'])).toBeDefined()
    expect(findBySan(tree, ['e4', 'd5'])).toBeUndefined() // under coverage
    expect(findBySan(tree, ['e4', 'e5', 'Bc4'])).toBeUndefined() // not the best user move
    expect(findBySan(tree, ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3'])).toBeDefined()
    // Root + two lines of 7 plies sharing 1.e4 = 1 + 1 + 2 × 6 = 14 positions.
    expect(Object.keys(tree.nodes)).toHaveLength(14)
    expect(lookups).toBe(calls.length)
    // Breadth-first: plies never decrease in lookup order.
    const plies = calls.map((k) => tree.nodes[k].ply)
    expect(plies).toEqual([...plies].sort((a, b) => a - b))
  })

  it('ends every line on a user move and never looks up past the depth limit', async () => {
    const { client, calls } = fakeClient(E4_WORLD)
    const { tree } = await buildRepertoire({ ...BASE, client })

    const leaves = Object.values(tree.nodes).filter((n) => n.edges.length === 0)
    expect(leaves.map((n) => pathTo(tree, n.key).length)).toEqual([7, 7])
    for (const leaf of leaves) expect(calls).not.toContain(leaf.key)
  })

  it('records explorer counts on edges and node totals, including the start move', async () => {
    const { client } = fakeClient(E4_WORLD)
    const { tree } = await buildRepertoire({ ...BASE, client })

    expect(tree.nodes[tree.rootKey].edges[0]).toMatchObject({
      san: 'e4',
      white: 60,
      draws: 10,
      black: 30,
    })
    const afterE4 = findBySan(tree, ['e4'])
    expect(afterE4).toMatchObject({ white: 50, draws: 16, black: 34 })
    expect(afterE4?.edges.map((e) => e.san)).toEqual(['e5', 'c5'])
  })

  it('sends the rating/speed filter and skips game lists', async () => {
    const { client, queries } = fakeClient(E4_WORLD)
    await buildRepertoire({ ...BASE, client })
    expect(queries[0]).toMatchObject({
      speeds: ['blitz', 'rapid'],
      ratings: [1600, 1800],
      topGames: 0,
      recentGames: 0,
    })
  })

  it('looks up a transposed position only once', async () => {
    // 1.d4 Nf6 2.c4 e6 and 1.d4 e6 2.c4 Nf6 reach the same position.
    const data = world({
      '': [['d4', 50, 0, 50]],
      d4: [
        ['Nf6', 30, 0, 30],
        ['e6', 20, 0, 20],
      ],
      'd4 Nf6': [['c4', 50, 0, 50]],
      'd4 e6': [['c4', 50, 0, 50]],
      'd4 Nf6 c4': [['e6', 50, 0, 50]],
      'd4 e6 c4': [['Nf6', 50, 0, 50]],
      'd4 Nf6 c4 e6': [['Nc3', 50, 0, 50]],
    })
    const { client, calls } = fakeClient(data)
    const { tree } = await buildRepertoire({
      ...BASE,
      startMoves: [],
      settings: { ...DEFAULT_PRUNE_SETTINGS, maxPly: 4 },
      client,
    })

    const merged = findBySan(tree, ['d4', 'Nf6', 'c4', 'e6'])
    expect(merged).toBe(findBySan(tree, ['d4', 'e6', 'c4', 'Nf6']))
    expect(calls.filter((k) => k === merged?.key)).toHaveLength(1)
    expect(merged?.edges.map((e) => e.san)).toEqual(['Nc3'])
  })

  it('builds for Black, choosing Black moves and keeping White replies', async () => {
    const data = world({
      '': [['e4', 60, 0, 40]],
      e4: [
        ['e5', 45, 0, 55], // Black scores 0.55
        ['c5', 40, 0, 60], // Black scores 0.60
      ],
      'e4 c5': [
        ['Nf3', 50, 0, 50],
        ['c3', 50, 0, 50],
      ],
    })
    const { client } = fakeClient(data)
    const { tree } = await buildRepertoire({
      ...BASE,
      color: 'black',
      settings: { ...DEFAULT_PRUNE_SETTINGS, maxPly: 3 },
      client,
    })
    expect(findBySan(tree, ['e4'])?.edges.map((e) => e.san)).toEqual(['c5'])
    expect(findBySan(tree, ['e4', 'c5'])?.edges.map((e) => e.san)).toEqual(['Nf3', 'c3'])
  })

  it('reports progress after each lookup', async () => {
    const { client } = fakeClient(E4_WORLD)
    const progress: BuildProgress[] = []
    const { tree, lookups } = await buildRepertoire({
      ...BASE,
      client,
      onProgress: (p) => progress.push(p),
    })

    // One report per BFS lookup (the start-line lookup has none).
    expect(progress).toHaveLength(lookups - 1)
    expect(progress.map((p) => p.expanded)).toEqual(progress.map((_, i) => i + 2))
    expect(progress.at(-1)).toMatchObject({
      positions: Object.keys(tree.nodes).length,
      queued: 0,
    })
  })

  it('stops with an AbortError when cancelled', async () => {
    const { client, calls } = fakeClient(E4_WORLD)
    const controller = new AbortController()
    const build = buildRepertoire({
      ...BASE,
      client,
      signal: controller.signal,
      onProgress: (p) => {
        if (p.expanded === 3) controller.abort()
      },
    })

    await expect(build).rejects.toMatchObject({ name: 'AbortError' })
    expect(calls).toHaveLength(3)
  })
})

describe('overrides', () => {
  const AFTER_E5 = keyAfter('e4 e5')

  it('plays the overridden move and builds its subtree instead', async () => {
    const { client } = fakeClient(E4_WORLD)
    const { tree, appliedOverrides } = await buildRepertoire({
      ...BASE,
      overrides: { [AFTER_E5]: 'Bc4' },
      client,
    })

    expect(appliedOverrides).toEqual([AFTER_E5])
    expect(tree.nodes[AFTER_E5].edges.map((e) => [e.san, e.white])).toEqual([['Bc4', 50]])
    expect(findBySan(tree, ['e4', 'e5', 'Nf3'])).toBeUndefined()
    expect(findBySan(tree, ['e4', 'e5', 'Bc4', 'Nf6', 'd3'])).toBeDefined()
    expect(findBySan(tree, ['e4', 'e5', 'Bc4', 'Bc5', 'Qg4'])).toBeDefined()
    // The other branch is untouched.
    expect(findBySan(tree, ['e4', 'c5', 'Nf3', 'd6', 'd4'])).toBeDefined()
  })

  it('accepts a legal move the explorer does not list, with zero counts', async () => {
    const { client } = fakeClient(E4_WORLD)
    const { tree } = await buildRepertoire({
      ...BASE,
      overrides: { [AFTER_E5]: 'Qh5' },
      client,
    })
    expect(tree.nodes[AFTER_E5].edges).toMatchObject([{ san: 'Qh5', white: 0, draws: 0, black: 0 }])
  })

  it('ignores illegal, opponent-side and unreached overrides', async () => {
    const { client } = fakeClient(E4_WORLD)
    const plain = await buildRepertoire({ ...BASE, client })
    const r = await buildRepertoire({
      ...BASE,
      overrides: {
        [AFTER_E5]: 'Ke3', // illegal
        [keyAfter('e4')]: 'd5', // opponent to move: overrides only apply to user moves
        [keyAfter('d4')]: 'c4', // never reached
      },
      client,
    })
    expect(r.appliedOverrides).toEqual([])
    expect(r.tree).toEqual(plain.tree)
  })

  it('rebuilding with a swap only fetches the new subtree from the network', async () => {
    const db = new TrainerDB('builder-override-test')
    try {
      const fetched: string[] = []
      const fetch = vi.fn<FetchFn>(async (url) => {
        const fen = new URL(url).searchParams.get('fen') as string
        fetched.push(positionKey(fen))
        return new Response(JSON.stringify(E4_WORLD.get(positionKey(fen)) ?? EMPTY))
      })
      const client = createExplorerClient({ token: 't', cache: dexieExplorerCache(db), fetch })

      const first = await buildAndSave(db, { ...BASE, client, name: 'swap' })
      expect(first.overrides).toEqual({})
      fetched.length = 0

      const swapped = await buildAndSave(db, {
        ...BASE,
        client,
        name: 'swap',
        id: first.id,
        overrides: { [AFTER_E5]: 'Bc4' },
      })

      expect(swapped.overrides).toEqual({ [AFTER_E5]: 'Bc4' })
      // Only positions in the new 2.Bc4 subtree; everything else came from the cache.
      expect(fetched.sort()).toEqual(
        ['e4 e5 Bc4', 'e4 e5 Bc4 Nf6', 'e4 e5 Bc4 Bc5', 'e4 e5 Bc4 Nf6 d3', 'e4 e5 Bc4 Bc5 Qg4']
          .map(keyAfter)
          .sort(),
      )
      expect(await listRepertoires(db)).toHaveLength(1)
    } finally {
      await db.delete()
    }
  })
})

describe('persistence', () => {
  let db: TrainerDB | undefined

  afterEach(async () => {
    await db?.delete()
    db = undefined
  })

  it('saves and reloads a built repertoire; rebuilding makes zero network calls', async () => {
    db = new TrainerDB('builder-test')
    // Real client over a fake network serving E4_WORLD.
    const fetch = vi.fn<FetchFn>(async (url) => {
      const fen = new URL(url).searchParams.get('fen') as string
      return new Response(JSON.stringify(E4_WORLD.get(positionKey(fen)) ?? EMPTY))
    })
    const client = createExplorerClient({ token: 't', cache: dexieExplorerCache(db), fetch })

    const saved = await buildAndSave(db, { ...BASE, client, name: '1.e4 test' })
    const networkCalls = fetch.mock.calls.length
    expect(networkCalls).toBeGreaterThan(0)

    const loaded = await loadRepertoire(db, saved.id)
    expect(loaded).toMatchObject({ name: '1.e4 test', color: 'white', startMoves: ['e4'] })
    expect(loaded?.tree).toEqual(saved.tree)
    expect(loaded?.settings.maxPly).toBe(6)

    // Rebuild into the same id with a fresh client on the same cache.
    const fetch2 = vi.fn<FetchFn>()
    const client2 = createExplorerClient({
      token: 't',
      cache: dexieExplorerCache(db),
      fetch: fetch2,
    })
    const rebuilt = await buildAndSave(db, {
      ...BASE,
      client: client2,
      name: '1.e4 test',
      id: saved.id,
    })
    expect(fetch2).not.toHaveBeenCalled()
    expect(rebuilt.tree).toEqual(saved.tree)
    expect(rebuilt.createdAt).toBe(saved.createdAt)
    expect(await listRepertoires(db)).toHaveLength(1)
  })

  it('lists repertoires newest first', async () => {
    db = new TrainerDB('builder-list-test')
    const { client } = fakeClient(E4_WORLD)
    const { tree } = await buildRepertoire({ ...BASE, client })
    const row = {
      color: 'white' as const,
      startMoves: ['e4'],
      speeds: [...BASE.speeds],
      ratings: [...BASE.ratings],
      settings: BASE.settings,
      tree,
    }
    vi.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(2000)
    await saveRepertoire(db, { ...row, name: 'old' })
    await saveRepertoire(db, { ...row, name: 'new' })
    vi.restoreAllMocks()
    expect((await listRepertoires(db)).map((r) => r.name)).toEqual(['new', 'old'])
  })
})

describe('schema migration', () => {
  const NAME = 'migration-test'

  afterEach(async () => {
    await Dexie.delete(NAME)
  })

  it('upgrades a v1 database to v2 without losing the explorer cache', async () => {
    const v1 = new Dexie(NAME)
    v1.version(1).stores({ explorerCache: 'key, positionKey' })
    await v1.table('explorerCache').put({
      key: 'k',
      positionKey: 'p',
      params: '',
      response: EMPTY,
      fetchedAt: 1,
    })
    v1.close()

    const v2 = new TrainerDB(NAME)
    expect(await v2.explorerCache.get('k')).toMatchObject({ positionKey: 'p', fetchedAt: 1 })
    expect(await v2.repertoires.count()).toBe(0)
    expect(v2.verno).toBe(2)
    v2.close()
  })
})
