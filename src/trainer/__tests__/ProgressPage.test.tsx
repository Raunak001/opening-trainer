import 'fake-indexeddb/auto'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import Dexie from 'dexie'
import { Rating } from 'ts-fsrs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TrainerDB } from '../../db'
import { buildAndSave } from '../../repertoire/builder'
import { DEFAULT_PRUNE_SETTINGS } from '../../repertoire/prune'
import { fakeClient, keyAfter, world, type Row } from '../../repertoire/__tests__/fakeWorld'
import { loadProgress, reviewCard, syncCards } from '../../srs'
import { LINES_SHOWN, ProgressPage } from '../ProgressPage'

const WAIT = { timeout: 4000 }
const names: string[] = []
afterEach(async () => {
  for (const n of names.splice(0)) await Dexie.delete(n)
})

function openDb() {
  const name = `progress-page-${names.length}`
  names.push(name)
  return new TrainerDB(name)
}

async function buildFrom(db: TrainerDB, spec: Record<string, Row[]>, maxPly: number) {
  const rep = await buildAndSave(db, {
    name: 'My 1.e4',
    color: 'white',
    startMoves: ['e4'],
    speeds: ['blitz'],
    ratings: [1600],
    settings: { ...DEFAULT_PRUNE_SETTINGS, maxPly },
    client: fakeClient(world(spec)).client,
  })
  await syncCards(db, rep.id)
  return rep
}

// Two lines: 1.e4 e5 2.Nf3 and 1.e4 c5 2.c3 (Alapin). Cards: 1.e4, 2.Nf3, 2.c3.
const TWO_LINES: Record<string, Row[]> = {
  '': [['e4', 60, 10, 30]],
  e4: [
    ['e5', 30, 10, 20],
    ['c5', 15, 5, 10],
  ],
  'e4 e5': [['Nf3', 60, 0, 40]],
  'e4 c5': [['c3', 50, 0, 50]],
}

describe('ProgressPage', () => {
  it('asks for a repertoire when there is none', async () => {
    render(<ProgressPage db={openDb()} />)
    expect(
      await screen.findByText(
        'No courses yet. Start one from the Library, then come back here.',
        {},
        WAIT,
      ),
    ).toBeInTheDocument()
  })

  it('shows today, streak and mastery per line, and starts a review', async () => {
    const db = openDb()
    const rep = await buildFrom(db, TWO_LINES, 2)
    const now = new Date()
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12)
    await reviewCard(db, `${rep.id}:${keyAfter('')}`, Rating.Easy, yesterday) // 1.e4, due in days
    await reviewCard(db, `${rep.id}:${keyAfter('e4 e5')}`, Rating.Good, now) // 2.Nf3, learning

    const onStartReview = vi.fn()
    render(<ProgressPage db={db} onStartReview={onStartReview} />)

    const tile = async (label: string) =>
      within(await screen.findByRole('group', { name: label }, WAIT))
    // 2.Nf3 was rated Good just now: a learning step due in 10 minutes, i.e. today
    // (unless the test runs in the last 10 minutes before midnight).
    const learning = new Date(now.getTime() + 10 * 60_000).getDate() === now.getDate() ? 1 : 0
    const due = await tile('Due today')
    expect(due.getByText(String(learning))).toBeInTheDocument()
    expect(due.getByText(`0 reviews · ${learning} learning`)).toBeInTheDocument()
    expect((await tile('New cards')).getByText('1')).toBeInTheDocument()
    expect((await tile('New cards')).getByText('not yet studied')).toBeInTheDocument()
    expect((await tile('Streak')).getByText('2 days')).toBeInTheDocument()
    expect((await tile('Streak')).getByText(/Studied today · longest 2/)).toBeInTheDocument()

    // Lines, weakest first, named once the opening index loads.
    const section = within(screen.getByRole('region', { name: 'My 1.e4' }))
    expect(section.getByText('Lines, weakest first (2)')).toBeInTheDocument()
    const rows = section.getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('1.e4 c5 2.c3')
    expect(rows[1]).toHaveTextContent('1.e4 e5 2.Nf3')
    await waitFor(
      () => expect(rows[0]).toHaveTextContent('Sicilian Defense: Alapin Variation'),
      WAIT,
    )
    expect(section.getByText('2/3 cards studied')).toBeInTheDocument()
    const bars = section.getAllByRole('meter')
    expect(bars[0]).toHaveAccessibleName('My 1.e4 mastery')

    fireEvent.click(screen.getByRole('button', { name: /Practice all/ }))
    expect(onStartReview).toHaveBeenCalledOnce()
  })

  it('matches loadProgress', async () => {
    const db = openDb()
    const rep = await buildFrom(db, TWO_LINES, 2)
    await reviewCard(db, `${rep.id}:${keyAfter('')}`, Rating.Easy, new Date())
    const p = await loadProgress(db, new Date())
    expect(p.today).toMatchObject({ newTotal: 2 })
    expect(p.streak).toEqual({ current: 1, longest: 1, studiedToday: true })
    expect(p.repertoires[0]).toMatchObject({ name: 'My 1.e4', cards: 3, studied: 1 })
    expect(p.repertoires[0].lines).toHaveLength(2)
    expect(p.mastery).toBeGreaterThan(0)
    expect(p.masteredAfterDays).toBe(21)
  })

  it(`shows the ${LINES_SHOWN} weakest lines, then all on request`, async () => {
    // Ten equal replies to 1.e4: 85% coverage is reached at the ninth → nine lines.
    const replies = ['e5', 'c5', 'e6', 'c6', 'd5', 'd6', 'g6', 'Nf6', 'Nc6', 'b6']
    const db = openDb()
    await buildFrom(db, { '': [['e4', 60, 10, 30]], e4: replies.map((r): Row => [r, 5, 0, 5]) }, 2)
    render(<ProgressPage db={db} />)
    const section = within(await screen.findByRole('region', { name: 'My 1.e4' }, WAIT))
    expect(section.getByText('Lines, weakest first (9)')).toBeInTheDocument()
    expect(section.getAllByRole('listitem')).toHaveLength(LINES_SHOWN)
    fireEvent.click(section.getByRole('button', { name: 'Show all 9 lines' }))
    expect(section.getAllByRole('listitem')).toHaveLength(9)
    fireEvent.click(section.getByRole('button', { name: 'Show fewer' }))
    expect(section.getAllByRole('listitem')).toHaveLength(LINES_SHOWN)
  })
})
