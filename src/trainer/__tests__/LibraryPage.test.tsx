import 'fake-indexeddb/auto'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TrainerDB } from '../../db'
import { world, fakeClient } from '../../repertoire/__tests__/fakeWorld'
import { CATALOG } from '../../repertoire/catalog'
import { CoursePage } from '../CoursePage'
import { LibraryPage } from '../LibraryPage'

// Caro-Kann for Black: two White replies at move 2, then a short main line each.
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

const dbs: TrainerDB[] = []
function freshDb() {
  const db = new TrainerDB(`library-${crypto.randomUUID()}`)
  dbs.push(db)
  return db
}
afterEach(async () => {
  for (const db of dbs.splice(0)) await db.delete()
})

describe('LibraryPage', () => {
  it('lists the catalog and filters by search, color and first move', async () => {
    const onOpen = vi.fn()
    render(<LibraryPage db={freshDb()} onOpen={onOpen} />)
    const grid = await screen.findByRole('list')
    expect(within(grid).getAllByRole('listitem')).toHaveLength(CATALOG.length)
    expect(
      screen.getByRole('img', { name: 'Caro-Kann Defense start position' }),
    ).toBeInTheDocument()
    expect(screen.getAllByText('Not started')).toHaveLength(CATALOG.length)

    fireEvent.change(screen.getByRole('combobox', { name: 'Color' }), {
      target: { value: 'white' },
    })
    expect(within(grid).getAllByRole('listitem')).toHaveLength(6)
    fireEvent.change(screen.getByRole('combobox', { name: 'First move' }), {
      target: { value: 'd4' },
    })
    expect(
      within(grid)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([expect.stringContaining("Queen's Gambit")])

    fireEvent.change(screen.getByRole('combobox', { name: 'Color' }), { target: { value: 'all' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'First move' }), {
      target: { value: 'all' },
    })
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search openings' }), {
      target: { value: 'caro' },
    })
    const items = within(grid).getAllByRole('listitem')
    expect(items).toHaveLength(1)
    fireEvent.click(within(items[0]).getByRole('button'))
    expect(onOpen).toHaveBeenCalledWith('caro-kann')

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzz' } })
    expect(screen.getByText('No openings match.')).toBeInTheDocument()
  })
})

describe('CoursePage', () => {
  it('starts a course at a tier, lists its lines, previews one, and shows progress in the library', async () => {
    const db = freshDb()
    const { client } = fakeClient(CARO_WORLD)
    render(<CoursePage db={db} client={client} entryId="caro-kann" onBack={() => {}} />)

    expect(await screen.findByRole('radio', { name: /Essentials/ })).toBeChecked()
    fireEvent.click(screen.getByRole('radio', { name: /Advanced/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Start course' }))

    expect(
      await screen.findByText(/^Built: \d+ positions, 5 cards\.$/, {}, { timeout: 5000 }),
    ).toBeInTheDocument()
    const lines = await screen.findByRole('region', { name: 'Lines' }, { timeout: 5000 })
    const rows = within(lines).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    // Most common first: 2.d4 (60%) before 2.Nc3 (30%).
    expect(rows[0]).toHaveTextContent('1.e4 c6 2.d4 d5 3.e5 Bf5')
    expect(rows[0]).toHaveTextContent('New')
    expect(screen.getByText('Advanced')).toBeInTheDocument()
    // Cards sync just after the tree is saved; the Learn button follows them.
    expect(
      await screen.findByRole('button', { name: /^Learn: Caro-Kann Defense/ }, { timeout: 5000 }),
    ).toBeEnabled()

    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Preview' }))
    expect(within(rows[0]).getByText('6/6')).toBeInTheDocument()
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Back' }))
    expect(within(rows[0]).getByText('5/6')).toBeInTheDocument()
  })

  it('opens Learn on the most common line', async () => {
    const db = freshDb()
    const { client } = fakeClient(CARO_WORLD)
    render(<CoursePage db={db} client={client} entryId="caro-kann" onBack={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Start course' }))
    fireEvent.click(await screen.findByRole('button', { name: /^Learn: / }, { timeout: 5000 }))

    expect(
      await screen.findByText(/Watch the line first/, {}, { timeout: 5000 }),
    ).toBeInTheDocument()
    expect(screen.getByText(/3 new moves/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Skip to playing' }))
    expect(screen.getByText(/Now you play it/)).toBeInTheDocument()
    // Playing the line back is covered by the useLearn and learn tests.
    fireEvent.click(screen.getByRole('button', { name: 'Back to course' }))
    expect(await screen.findByRole('region', { name: 'Lines' })).toBeInTheDocument()
  })
})

describe('LibraryPage progress', () => {
  it('shows lines learned and depth once a course is started', async () => {
    const db = freshDb()
    const { client } = fakeClient(CARO_WORLD)
    const { buildCourse } = await import('../../repertoire/courses')
    await buildCourse(
      db,
      CATALOG.find((e) => e.id === 'caro-kann') as (typeof CATALOG)[number],
      'essentials',
      { client },
    )
    render(<LibraryPage db={db} onOpen={() => {}} />)
    await waitFor(
      () => expect(screen.getByText('0/2 lines learned · Essentials')).toBeInTheDocument(),
      { timeout: 5000 },
    )
    expect(screen.getAllByText('Not started')).toHaveLength(CATALOG.length - 1)
    await act(async () => {})
  })
})
