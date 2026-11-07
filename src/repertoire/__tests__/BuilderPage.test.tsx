import 'fake-indexeddb/auto'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TrainerDB } from '../../db'
import { BuilderPage } from '../BuilderPage'
import { saveRepertoire } from '../builder'
import type { ExplorerClient, ExplorerQuery, ExplorerResponse } from '../explorer'
import { positionKey } from '../positionKey'
import { createTree } from '../tree'

const AFTER_E4 = positionKey('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1')

const move = (uci: string, san: string, white: number, draws: number, black: number) => ({
  uci,
  san,
  white,
  draws,
  black,
  averageRating: 1700,
  opening: null,
})

const START: ExplorerResponse = {
  white: 60,
  draws: 10,
  black: 30,
  moves: [move('e2e4', 'e4', 60, 10, 30)],
  opening: null,
}
const E4: ExplorerResponse = {
  white: 50,
  draws: 10,
  black: 40,
  moves: [move('e7e5', 'e5', 50, 10, 40)],
  opening: null,
}
const EMPTY: ExplorerResponse = { white: 0, draws: 0, black: 0, moves: [], opening: null }

function fakeClient(impl?: (q: ExplorerQuery, signal?: AbortSignal) => Promise<ExplorerResponse>) {
  const get = vi.fn<ExplorerClient['get']>(
    impl ??
      (async (q) => {
        const key = positionKey(q.fen)
        return key === AFTER_E4 ? E4 : key.startsWith('rnbqkbnr/pppppppp/8/8/8/8') ? START : EMPTY
      }),
  )
  return { get }
}

let db: TrainerDB | undefined
let dbCount = 0
function freshDb() {
  db = new TrainerDB(`builder-page-${++dbCount}`)
  return db
}

afterEach(async () => {
  await db?.delete()
  db = undefined
})

const typeInto = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } })

describe('BuilderPage', () => {
  it('shows the defaults and a live reading of the start moves', () => {
    render(<BuilderPage db={freshDb()} client={fakeClient()} />)

    expect(screen.getByRole('heading', { name: 'New repertoire' })).toBeInTheDocument()
    expect(screen.getByLabelText('Start moves')).toHaveValue('1.e4')
    expect(screen.getByText('Every line starts 1.e4')).toBeInTheDocument()
    expect(screen.getByLabelText('Rating from')).toHaveValue('1600')
    expect(screen.getByLabelText('Rating to')).toHaveValue('1800')
    expect(
      within(screen.getByLabelText('Rating to')).getByRole('option', { name: '1999' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Blitz' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Bullet' })).not.toBeChecked()
    expect(screen.getByLabelText('Coverage %')).toHaveValue(85)
    expect(screen.getByLabelText('Floor %')).toHaveValue(3)
    expect(screen.getByLabelText('Depth (plies)')).toHaveValue(6)

    typeInto('Start moves', '1.e4 e5 2.Ke3')
    expect(screen.getByText('"Ke3" is not a legal move after 1.e4 e5.')).toBeInTheDocument()
  })

  it('shows validation errors and does not build', async () => {
    const client = fakeClient()
    render(<BuilderPage db={freshDb()} client={client} />)

    fireEvent.click(screen.getByRole('checkbox', { name: 'Blitz' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Rapid' }))
    fireEvent.click(screen.getByRole('button', { name: 'Build & save' }))

    expect(await screen.findByText('Give the repertoire a name.')).toBeInTheDocument()
    expect(screen.getByText('Pick at least one time control.')).toBeInTheDocument()
    expect(client.get).not.toHaveBeenCalled()
  })

  it('builds with the chosen settings, saves, and lists the repertoire', async () => {
    const client = fakeClient()
    const database = freshDb()
    render(<BuilderPage db={database} client={client} />)

    typeInto('Name', 'My 1.e4')
    fireEvent.click(screen.getByRole('radio', { name: 'Black' }))
    fireEvent.change(screen.getByLabelText('Rating from'), { target: { value: '1400' } })
    fireEvent.change(screen.getByLabelText('Rating to'), { target: { value: '2000' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Blitz' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Classical' }))
    typeInto('Coverage %', '90')
    typeInto('Floor %', '2')
    typeInto('Depth (plies)', '4')
    fireEvent.click(screen.getByRole('button', { name: 'Build & save' }))

    expect(await screen.findByText('Saved “My 1.e4” · 3 positions · 1 card')).toBeInTheDocument()
    expect(client.get.mock.calls[0][0]).toMatchObject({
      speeds: ['rapid', 'classical'],
      ratings: [1400, 1600, 1800, 2000],
    })

    const rows = await database.repertoires.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      name: 'My 1.e4',
      color: 'black',
      startMoves: ['e4'],
      settings: { opponentCoverage: 0.9, opponentMinShare: 0.02, maxPly: 4 },
    })

    // Now editing the saved repertoire.
    expect(screen.getByRole('heading', { name: 'Edit repertoire' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Rebuild & save' })).toBeInTheDocument()
    const saved = screen.getByRole('complementary', { name: 'Saved repertoires' })
    expect(await within(saved).findByText('My 1.e4')).toBeInTheDocument()
    expect(within(saved).getByText('Black · 1.e4 · 3 positions')).toBeInTheDocument()
  })

  it('rebuilding an edited repertoire overwrites it instead of adding another', async () => {
    const database = freshDb()
    render(<BuilderPage db={database} client={fakeClient()} />)

    typeInto('Name', 'First')
    fireEvent.click(screen.getByRole('button', { name: 'Build & save' }))
    await screen.findByText(/Saved “First”/)

    typeInto('Name', 'Renamed')
    fireEvent.click(screen.getByRole('button', { name: 'Rebuild & save' }))
    await screen.findByText(/Saved “Renamed”/)

    expect((await database.repertoires.toArray()).map((r) => r.name)).toEqual(['Renamed'])

    fireEvent.click(screen.getByRole('button', { name: 'New' }))
    expect(screen.getByRole('heading', { name: 'New repertoire' })).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveValue('')
  })

  it('loads a saved repertoire into the form', async () => {
    const database = freshDb()
    await saveRepertoire(database, {
      name: 'Caro-Kann',
      color: 'black',
      startMoves: ['e4', 'c6'],
      speeds: ['bullet'],
      ratings: [2000, 2200],
      settings: { userMinShare: 0.05, opponentCoverage: 0.8, opponentMinShare: 0.04, maxPly: 10 },
      tree: createTree(),
    })
    render(<BuilderPage db={database} client={fakeClient()} />)

    fireEvent.click(await screen.findByRole('button', { name: /Caro-Kann/ }))

    expect(screen.getByLabelText('Name')).toHaveValue('Caro-Kann')
    expect(screen.getByRole('radio', { name: 'Black' })).toBeChecked()
    expect(screen.getByLabelText('Start moves')).toHaveValue('1.e4 c6')
    expect(screen.getByLabelText('Rating from')).toHaveValue('2000')
    expect(screen.getByLabelText('Rating to')).toHaveValue('2200')
    expect(screen.getByRole('checkbox', { name: 'Bullet' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Blitz' })).not.toBeChecked()
    expect(screen.getByLabelText('Coverage %')).toHaveValue(80)
    expect(screen.getByLabelText('Floor %')).toHaveValue(4)
    expect(screen.getByLabelText('Depth (plies)')).toHaveValue(10)
  })

  it('shows progress and can cancel a build without saving', async () => {
    let release: () => void = () => {}
    const client = fakeClient(
      (q, signal) =>
        new Promise((resolve, reject) => {
          signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError')),
          )
          release = () => resolve(positionKey(q.fen) === AFTER_E4 ? E4 : START)
        }),
    )
    const database = freshDb()
    render(<BuilderPage db={database} client={client} />)

    typeInto('Name', 'Cancel me')
    fireEvent.click(screen.getByRole('button', { name: 'Build & save' }))

    expect(await screen.findByText('Building…')).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toBeDisabled()
    await act(async () => release()) // start position (start-line lookup)
    await waitFor(() => expect(client.get).toHaveBeenCalledTimes(2))
    await act(async () => release()) // after 1.e4
    expect(await screen.findByText(/Building… 3 positions/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(await screen.findByText('Build cancelled. Nothing was saved.')).toBeInTheDocument()
    expect(await database.repertoires.count()).toBe(0)
    expect(screen.getByRole('button', { name: 'Build & save' })).toBeEnabled()
  })

  it('reports a failed build', async () => {
    const client = fakeClient(async () => {
      throw new Error('VITE_LICHESS_TOKEN is not set (see .env.example)')
    })
    render(<BuilderPage db={freshDb()} client={client} />)

    typeInto('Name', 'No token')
    fireEvent.click(screen.getByRole('button', { name: 'Build & save' }))

    expect(
      await screen.findByText('Build failed: VITE_LICHESS_TOKEN is not set (see .env.example)'),
    ).toBeInTheDocument()
  })
})
