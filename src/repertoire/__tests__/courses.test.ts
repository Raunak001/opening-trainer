import 'fake-indexeddb/auto'
import { Rating } from 'ts-fsrs'
import { afterEach, describe, expect, it } from 'vitest'
import { TrainerDB } from '../../db'
import { reviewCard } from '../../srs/scheduler'
import { catalogEntry, type CatalogEntry } from '../catalog'
import {
  buildCourse,
  courseRepertoireId,
  findCourse,
  listCourses,
  tierSettings,
  TIERS,
} from '../courses'
import { createExplorerClient, dexieExplorerCache, type FetchFn } from '../explorer'
import { positionKey } from '../positionKey'
import { EMPTY, keyAfter, world, type Row } from './fakeWorld'

const CARO = catalogEntry('caro-kann') as CatalogEntry

// Caro-Kann Advance main line, 18 plies: deep enough for every tier.
const MAIN = 'e4 c6 d4 d5 e5 Bf5 Nf3 e6 Be2 c5 Be3 Nd7 O-O Ne7 c3 Nc6 Nbd2 Be7'.split(' ')

function caroWorld() {
  const spec: Record<string, Row[]> = {}
  for (let i = 0; i < MAIN.length; i++) spec[MAIN.slice(0, i).join(' ')] = [[MAIN[i], 50, 0, 50]]
  // White's second move: coverage decides how many replies each tier keeps.
  spec['e4 c6'] = [
    ['d4', 50, 0, 0], //  50%
    ['Nc3', 15, 0, 0], // 65%
    ['c4', 10, 0, 0], //  75% ≥ 70%: Essentials stops
    ['Nf3', 8, 0, 0], //  83%
    ['d3', 4, 0, 0], //   87% ≥ 85%: Advanced stops
    ['e5', 4, 0, 0], //   91% ≥ 90%: Full stops
    ['Bc4', 3, 0, 0],
    ['g3', 2, 0, 0],
    ['f4', 2, 0, 0],
    ['b3', 2, 0, 0],
  ]
  // Black's answer to each side line, so they reach the next opponent move.
  spec['e4 c6 Nc3'] = [['d5', 50, 0, 50]]
  spec['e4 c6 c4'] = [['d5', 50, 0, 50]]
  spec['e4 c6 Nf3'] = [['d5', 50, 0, 50]]
  spec['e4 c6 d3'] = [['d5', 50, 0, 50]]
  spec['e4 c6 e5'] = [['d6', 50, 0, 50]]
  return world(spec)
}

const dbs: TrainerDB[] = []
afterEach(async () => {
  for (const db of dbs.splice(0)) await db.delete()
})

function setup() {
  const db = new TrainerDB(`courses-${crypto.randomUUID()}`)
  dbs.push(db)
  const data = caroWorld()
  const fetched: string[] = []
  const fetch: FetchFn = async (url) => {
    const fen = new URL(url).searchParams.get('fen') as string
    fetched.push(positionKey(fen))
    return new Response(JSON.stringify(data.get(positionKey(fen)) ?? EMPTY))
  }
  const client = createExplorerClient({ token: 't', cache: dexieExplorerCache(db), fetch })
  return { db, client, fetched }
}

const keys = (r: { tree: { nodes: Record<string, unknown> } }) => new Set(Object.keys(r.tree.nodes))

describe('tierSettings', () => {
  it('counts depth from the end of the start moves', () => {
    expect(tierSettings(CARO, 'essentials')).toMatchObject({ maxPly: 10, opponentCoverage: 0.7 })
    expect(tierSettings(CARO, 'advanced')).toMatchObject({ maxPly: 14, opponentCoverage: 0.85 })
    expect(tierSettings(CARO, 'full')).toMatchObject({ maxPly: 18, opponentCoverage: 0.9 })
    expect(TIERS.essentials.label).toBe('Essentials')
  })
})

describe('buildCourse', () => {
  it('gives nested trees per tier, and rebuilding hits only the cache', async () => {
    const { db, client, fetched } = setup()
    const essentials = (await buildCourse(db, CARO, 'essentials', { client })).repertoire
    const advanced = (await buildCourse(db, CARO, 'advanced', { client })).repertoire
    const full = (await buildCourse(db, CARO, 'full', { client })).repertoire

    const [e, a, f] = [keys(essentials), keys(advanced), keys(full)]
    expect([...e].every((k) => a.has(k))).toBe(true)
    expect([...a].every((k) => f.has(k))).toBe(true)
    expect(e.size).toBeLessThan(a.size)
    expect(a.size).toBeLessThan(f.size)

    // Replies to 1.e4 c6 kept per tier.
    const replies = (r: typeof full) =>
      r.tree.nodes[keyAfter('e4 c6')].edges.map((x) => x.san).sort()
    expect(replies(essentials)).toEqual(['Nc3', 'c4', 'd4'])
    expect(replies(advanced)).toEqual(['Nc3', 'Nf3', 'c4', 'd3', 'd4'])
    expect(replies(full)).toEqual(['Nc3', 'Nf3', 'c4', 'd3', 'd4', 'e5'])
    // Main line depth: Essentials ends on Black's 5th move, Full on the 9th.
    expect(e.has(keyAfter(MAIN.slice(0, 10).join(' ')))).toBe(true)
    expect(e.has(keyAfter(MAIN.slice(0, 11).join(' ')))).toBe(false)
    expect(f.has(keyAfter(MAIN.join(' ')))).toBe(true)

    // Every lookup went to the network once; rebuilding any tier is cache only.
    expect(new Set(fetched).size).toBe(fetched.length)
    const before = fetched.length
    await buildCourse(db, CARO, 'essentials', { client })
    await buildCourse(db, CARO, 'full', { client })
    expect(fetched.length).toBe(before)
  })

  it('stores the course on its repertoire row with settings from app settings', async () => {
    const { db, client } = setup()
    const { repertoire, cards } = await buildCourse(db, CARO, 'essentials', { client })
    expect(repertoire.id).toBe(courseRepertoireId('caro-kann'))
    expect(repertoire).toMatchObject({
      name: 'Caro-Kann Defense',
      courseId: 'caro-kann',
      tier: 'essentials',
      color: 'black',
      startMoves: ['e4', 'c6'],
      ratings: [1600, 1800],
      speeds: ['blitz', 'rapid'],
    })
    expect(cards.added).toBeGreaterThan(0)
    expect((await findCourse(db, 'caro-kann'))?.tier).toBe('essentials')
    expect([...(await listCourses(db)).keys()]).toEqual(['caro-kann'])
  })

  it('keeps card history across tier changes', async () => {
    const { db, client } = setup()
    await buildCourse(db, CARO, 'essentials', { client })
    const id = `${courseRepertoireId('caro-kann')}:${keyAfter('e4 c6 d4')}`
    await reviewCard(db, id, Rating.Good, new Date())

    await buildCourse(db, CARO, 'full', { client })
    expect((await db.cards.get(id))?.reps).toBe(1)
    const deep = `${courseRepertoireId('caro-kann')}:${keyAfter(MAIN.slice(0, 15).join(' '))}`
    expect(await db.cards.get(deep)).toBeDefined()

    // Back down: deep cards are suspended, not deleted; the reviewed card is untouched.
    await buildCourse(db, CARO, 'essentials', { client })
    expect((await db.cards.get(id))?.reps).toBe(1)
    expect((await db.cards.get(deep))?.suspended).toBe(true)
  })
})
