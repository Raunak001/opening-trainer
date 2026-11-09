import 'fake-indexeddb/auto'
import { Rating, State } from 'ts-fsrs'
import { afterEach, describe, expect, it } from 'vitest'
import { TrainerDB } from '../../db'
import { fakeClient, world } from '../../repertoire/__tests__/fakeWorld'
import { saveRepertoire } from '../../repertoire/builder'
import { catalogEntry, type CatalogEntry } from '../../repertoire/catalog'
import { buildCourse } from '../../repertoire/courses'
import { addMove, createTree } from '../../repertoire/tree'
import { loadDueQueue, syncCards } from '../../srs/scheduler'
import { loadCourse } from '../courseData'
import { saveLearnedLine } from '../learn'

const CARO_WORLD = world({
  '': [['e4', 50, 0, 50]],
  e4: [['c6', 50, 0, 50]],
  'e4 c6': [
    ['d4', 60, 0, 40],
    ['Nc3', 30, 0, 20],
  ],
  'e4 c6 d4': [['d5', 40, 10, 50]],
  'e4 c6 Nc3': [['d5', 40, 10, 50]],
  'e4 c6 d4 d5': [['e5', 50, 0, 50]],
  'e4 c6 Nc3 d5': [['Nf3', 50, 0, 50]],
  'e4 c6 d4 d5 e5': [['Bf5', 40, 10, 50]],
  'e4 c6 Nc3 d5 Nf3': [['Bg4', 40, 10, 50]],
})

const DAY = 86_400_000
const dbs: TrainerDB[] = []
afterEach(async () => {
  for (const db of dbs.splice(0)) await db.delete()
})

describe('course practice', () => {
  it('brings a learned line back in the course’s Practice when due; new course cards stay out', async () => {
    const db = new TrainerDB(`course-practice-${crypto.randomUUID()}`)
    dbs.push(db)
    const now = new Date(2026, 10, 9, 10)
    const { client } = fakeClient(CARO_WORLD)
    const { repertoire } = await buildCourse(
      db,
      catalogEntry('caro-kann') as CatalogEntry,
      'essentials',
      { client, now },
    )

    // A plain (non-course) repertoire's new cards still reach Practice all.
    let tree = createTree()
    tree = addMove(tree, tree.rootKey, 'd4').tree
    const plain = await saveRepertoire(db, {
      name: 'Plain',
      color: 'white',
      startMoves: [],
      speeds: ['blitz'],
      ratings: [1600],
      settings: repertoire.settings,
      tree,
    })
    await syncCards(db, plain, now)

    const before = await loadDueQueue(db, now, repertoire.id)
    expect(before.cards).toEqual([])
    expect((await loadDueQueue(db, now)).cards.map((c) => c.repertoireId)).toEqual([plain])

    // Learn the most common line.
    const course = await loadCourse(db, 'caro-kann', now)
    const line = course?.next.line
    expect(line?.moves).toEqual(['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5'])
    const lineKeys = (line?.positions ?? []).filter((k) => course?.cards.get(k))
    await saveLearnedLine(
      db,
      repertoire.id,
      lineKeys.map((positionKey) => ({ positionKey, rating: Rating.Good, details: {} })),
      now,
    )
    const learned = await loadCourse(db, 'caro-kann', now)
    expect(learned?.lines.find((l) => l.id === line?.id)?.status).toBe('learned')
    expect(learned?.counts.learned).toBe(1)

    // The next day those cards are due in the course's Practice, and only those.
    const tomorrow = new Date(now.getTime() + DAY)
    const due = await loadDueQueue(db, tomorrow, repertoire.id)
    expect(due.cards.map((c) => c.positionKey).sort()).toEqual([...lineKeys].sort())
    expect(due.cards.every((c) => c.state !== State.New)).toBe(true)
    expect((await loadCourse(db, 'caro-kann', tomorrow))?.counts.due).toBe(3)
  })
})
