import { Chess } from 'chess.js'
import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { TrainerDB } from '../../db'
import { buildRepertoire, FORCED_MIN_SHARE, forcedPick } from '../builder'
import { catalogEntry, type CatalogEntry } from '../catalog'
import type { ExplorerResponse } from '../explorer'
import { buildCourse } from '../courses'
import { findBySan } from '../tree'
import { fakeClient, keyAfter, world } from './fakeWorld'

// After 1.d4, c4 always scores better than Bf4: only the system makes it Bf4.
const D4_WORLD = world({
  '': [['d4', 50, 0, 50]],
  d4: [
    ['d5', 50, 0, 50],
    ['Nf6', 50, 0, 50],
  ],
  'd4 d5': [
    ['c4', 70, 0, 30],
    ['Bf4', 40, 0, 60],
    ['Nf3', 45, 0, 55],
  ],
  'd4 Nf6': [
    ['c4', 70, 0, 30],
    ['Nf3', 50, 0, 50],
    ['Bf4', 30, 0, 70],
  ],
  'd4 d5 Bf4': [['Nf6', 50, 0, 50]],
  'd4 Nf6 Bf4': [['d5', 50, 0, 50]],
  'd4 d5 Bf4 Nf6': [
    ['Nf3', 70, 0, 30],
    ['e3', 40, 0, 60],
  ],
  'd4 Nf6 Bf4 d5': [
    ['e3', 50, 0, 50],
    ['Nf3', 60, 0, 40],
    ['Bxc7', 99, 0, 1], // legal and popular, but not in the list
  ],
})

const LONDON = catalogEntry('london') as CatalogEntry

const dbs: TrainerDB[] = []
afterEach(async () => {
  for (const db of dbs.splice(0)) await db.delete()
})

describe('forcedPick', () => {
  const fen = (sans: string) => {
    const c = new Chess()
    for (const s of sans.split(' ').filter(Boolean)) c.move(s)
    return c.fen()
  }
  const response = (sans: string) => D4_WORLD.get(keyAfter(sans)) as ExplorerResponse

  it('takes the first legal, played move in list order', () => {
    const r = response('d4 d5 Bf4 Nf6')
    // Bf4 is already played (illegal now): e3 is next.
    expect(forcedPick(r, fen('d4 d5 Bf4 Nf6'), ['Bf4', 'e3', 'Nf3'])).toBe('e3')
  })

  it('skips moves nobody plays in the position', () => {
    const r = {
      ...response('d4 d5'),
      moves: response('d4 d5').moves.filter((m) => m.san !== 'Bf4'),
    }
    expect(forcedPick(r, fen('d4 d5'), ['Bf4'])).toBeUndefined()
    const rare = {
      ...r,
      white: 10_000,
      moves: [...r.moves, { ...response('d4 d5').moves[1], white: 1, black: 0, draws: 0 }],
    }
    expect(1 / (10_000 + 100) < FORCED_MIN_SHARE).toBe(true)
    expect(forcedPick(rare, fen('d4 d5'), ['Bf4'])).toBeUndefined()
  })
})

describe('London course (T7.9)', () => {
  it('plays Bf4 against both 1…d5 and 1…Nf6', async () => {
    const db = new TrainerDB(`systems-${crypto.randomUUID()}`)
    dbs.push(db)
    const { client } = fakeClient(D4_WORLD)
    const { repertoire } = await buildCourse(db, LONDON, 'essentials', { client })
    const { tree } = repertoire
    expect(tree.nodes[keyAfter('d4 d5')].edges.map((e) => e.san)).toEqual(['Bf4'])
    expect(tree.nodes[keyAfter('d4 Nf6')].edges.map((e) => e.san)).toEqual(['Bf4'])
    // Then the next system move, not the better-scoring Nf3 or the popular Bxc7.
    expect(findBySan(tree, ['d4', 'd5', 'Bf4', 'Nf6'])?.edges.map((e) => e.san)).toEqual(['e3'])
    expect(findBySan(tree, ['d4', 'Nf6', 'Bf4', 'd5'])?.edges.map((e) => e.san)).toEqual(['e3'])
    expect(repertoire.forcedMoves).toEqual(['Bf4', 'e3', 'Nf3'])
  })

  it('lets a move swapped in the tree viewer win over the system', async () => {
    const { client } = fakeClient(D4_WORLD)
    const { tree, appliedForced, appliedOverrides } = await buildRepertoire({
      color: 'white',
      startMoves: ['d4'],
      speeds: ['blitz'],
      ratings: [1600],
      forcedMoves: ['Bf4'],
      overrides: { [keyAfter('d4 d5')]: 'Nf3' },
      client,
    })
    expect(tree.nodes[keyAfter('d4 d5')].edges.map((e) => e.san)).toEqual(['Nf3'])
    expect(tree.nodes[keyAfter('d4 Nf6')].edges.map((e) => e.san)).toEqual(['Bf4'])
    expect(appliedOverrides).toEqual([keyAfter('d4 d5')])
    expect(appliedForced).toEqual([keyAfter('d4 Nf6')])
  })
})
