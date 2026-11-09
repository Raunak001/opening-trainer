import 'fake-indexeddb/auto'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Chess } from 'chess.js'
import { TrainerDB } from '../../db'
import { stubEngine } from '../../engine/__tests__/stubEngine'
import { positionKey } from '../positionKey'
import { buildAndSave } from '../builder'
import { DEFAULT_PRUNE_SETTINGS } from '../prune'
import { TreeViewer } from '../TreeViewer'
import { fakeClient, keyAfter, world } from './fakeWorld'

// White after 1.e4; 2.Nf3 is the automatic pick after 1...e5, 2.Bc4 the alternative.
const WORLD = world({
  '': [['e4', 60, 10, 30]],
  e4: [
    ['e5', 30, 10, 20],
    ['c5', 15, 5, 10],
    ['d5', 5, 1, 4],
  ],
  'e4 e5': [
    ['Nf3', 60, 0, 40],
    ['Bc4', 50, 0, 50],
  ],
  'e4 c5': [['c3', 50, 0, 50]],
  'e4 e5 Nf3': [['Nc6', 50, 0, 50]],
  'e4 e5 Bc4': [['Nf6', 50, 0, 50]],
  'e4 c5 c3': [['d5', 50, 0, 50]],
})

const SETTINGS = { ...DEFAULT_PRUNE_SETTINGS, maxPly: 4 }

let db: TrainerDB | undefined
let n = 0

afterEach(async () => {
  await db?.delete()
  db = undefined
})

const fenAfter = (sans: string[]) => {
  const chess = new Chess()
  for (const san of sans) chess.move(san)
  return chess.fen()
}

/** Engine prefers 2.Bc4 to the repertoire's 2.Nf3 by 0.9 pawns; everything else is the engine move. */
function sanityEngine() {
  const at = (sans: string[]) => positionKey(fenAfter(sans))
  return stubEngine({
    [at([])]: { score: { type: 'cp', value: 30 }, pv: ['e2e4'] },
    [at(['e4', 'e5'])]: { score: { type: 'cp', value: 60 }, pv: ['f1c4'] },
    [at(['e4', 'e5', 'Nf3'])]: { score: { type: 'cp', value: 30 }, pv: ['b8c6'] },
    [at(['e4', 'c5'])]: { score: { type: 'cp', value: 25 }, pv: ['c2c3'] },
  })
}

async function setup(overrides: Record<string, string> = {}) {
  db = new TrainerDB(`tree-viewer-${++n}`)
  const fake = fakeClient(WORLD)
  await buildAndSave(db, {
    name: 'Test 1.e4',
    color: 'white',
    startMoves: ['e4'],
    speeds: ['blitz'],
    ratings: [1600],
    settings: SETTINGS,
    overrides,
    client: fake.client,
  })
  const sanity = sanityEngine()
  render(<TreeViewer db={db} client={fake.client} engine={() => sanity.engine} />)
  await screen.findByText('Start position')
  return { db, fake, sanity }
}

const row = (label: string) => {
  const move = screen.getAllByText(label, { selector: '.tree-viewer__move' })[0]
  return move.closest('.tree-viewer__row') as HTMLElement
}

describe('TreeViewer', () => {
  it('says so when there is nothing to show', async () => {
    db = new TrainerDB(`tree-viewer-${++n}`)
    render(<TreeViewer db={db} client={fakeClient(WORLD).client} />)
    expect(await screen.findByText('No repertoires yet. Build one first.')).toBeInTheDocument()
  })

  it('shows the tree with stats, opening names and a summary', async () => {
    await setup()

    expect(screen.getByText('White · 8 positions · 3 of your moves')).toBeInTheDocument()
    // Expanded to ply 3 by default.
    expect(row('1.e4')).toHaveTextContent('100')
    expect(row('1…e5')).toHaveTextContent('60%')
    expect(row('2.Nf3')).toBeInTheDocument()
    expect(screen.queryByText('2…Nc6')).not.toBeInTheDocument() // ply 4, collapsed
    // Opening names load asynchronously.
    await waitFor(() => expect(row('1…c5')).toHaveTextContent('B20 Sicilian Defense'))
    expect(within(row('1…e5')).getByRole('img')).toHaveAccessibleName(
      'White 50% · Draw 17% · Black 33%',
    )
  })

  it('expands and collapses lines', async () => {
    await setup()

    fireEvent.click(screen.getByRole('button', { name: 'Expand 2.Nf3' }))
    expect(row('2…Nc6')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Collapse 1…e5' }))
    expect(screen.queryByText('2.Nf3')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }))
    expect(row('2…d5')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }))
    expect(screen.queryByText('1…e5')).not.toBeInTheDocument()
  })

  it('offers Change only on your moves after the start line', async () => {
    await setup()
    expect(within(row('1.e4')).queryByRole('button', { name: 'Change' })).toBeNull()
    expect(within(row('1…e5')).queryByRole('button', { name: 'Change' })).toBeNull()
    expect(within(row('2.Nf3')).getByRole('button', { name: 'Change' })).toBeInTheDocument()
  })

  it('swaps a move, rebuilds that line and persists the choice', async () => {
    const { db: database, fake } = await setup()

    fireEvent.click(within(row('2.Nf3')).getByRole('button', { name: 'Change' }))
    const panel = await screen.findByRole('group', { name: 'Choose your move' })
    const nf3 = within(panel).getByRole('button', { name: /2\.Nf3/ })
    expect(nf3).toBeDisabled()
    expect(nf3).toHaveTextContent('auto pick')
    expect(nf3).toHaveTextContent('current')
    // The panel reads the same cached query the builder used.
    expect(fake.queries.at(-1)).toMatchObject({ speeds: ['blitz'], ratings: [1600], topGames: 0 })

    fireEvent.click(within(panel).getByRole('button', { name: /2\.Bc4/ }))

    expect(await screen.findByText('Now playing 2.Bc4.')).toBeInTheDocument()
    // The tree reloads from the nodes table just after the save.
    await waitFor(() => expect(screen.queryByText('2.Nf3')).not.toBeInTheDocument())
    expect(row('2.Bc4')).toHaveTextContent('your choice')
    expect(row('2…Nf6')).toBeInTheDocument() // the swapped line opens
    expect(screen.getByText(/1 changed by you/)).toBeInTheDocument()

    const [saved] = await database.repertoires.toArray()
    expect(saved.overrides).toEqual({ [keyAfter('e4 e5')]: 'Bc4' })
  })

  it('choosing the automatic pick again removes the override', async () => {
    const { db: database } = await setup({ [keyAfter('e4 e5')]: 'Bc4' })
    expect(row('2.Bc4')).toHaveTextContent('your choice')

    fireEvent.click(within(row('2.Bc4')).getByRole('button', { name: 'Change' }))
    const panel = await screen.findByRole('group', { name: 'Choose your move' })
    fireEvent.click(within(panel).getByRole('button', { name: /2\.Nf3/ }))

    expect(await screen.findByText('Back to the automatic pick, 2.Nf3.')).toBeInTheDocument()
    await waitFor(() => expect(row('2.Nf3')).not.toHaveTextContent('your choice'))
    expect((await database.repertoires.toArray())[0].overrides).toEqual({})
  })

  it('resets all changes', async () => {
    const { db: database } = await setup({ [keyAfter('e4 e5')]: 'Bc4' })

    fireEvent.click(screen.getByRole('button', { name: 'Reset changes' }))

    expect(await screen.findByText('All your changes were cleared.')).toBeInTheDocument()
    await waitFor(() => expect(row('2.Nf3')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Reset changes' })).not.toBeInTheDocument()
    expect((await database.repertoires.toArray())[0].overrides).toEqual({})
  })

  it('checks the chosen moves with the engine and flags the bad one', async () => {
    const { sanity } = await setup()
    fireEvent.click(screen.getByRole('button', { name: 'Check with engine' }))
    expect(
      await screen.findByText(
        "1 of your 3 moves lose more than 0.5 pawns against the engine's best. Use Change to pick another.",
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('-0.3 · best 2.Bc4 +0.6', { exact: false })).toBeInTheDocument()
    expect(row('2.Nf3')).toHaveTextContent('−0.9 vs Bc4')
    expect(row('2.c3')).not.toHaveTextContent('vs')
    // Engine moves need one search each; the flagged move needs two.
    expect(sanity.searched).toHaveLength(4)
  })

  it('shows engine errors', async () => {
    db = new TrainerDB(`tree-viewer-${++n}`)
    const fake = fakeClient(WORLD)
    await buildAndSave(db, {
      name: 'Test 1.e4',
      color: 'white',
      startMoves: ['e4'],
      speeds: ['blitz'],
      ratings: [1600],
      settings: SETTINGS,
      client: fake.client,
    })
    render(
      <TreeViewer
        db={db}
        client={fake.client}
        engine={() => {
          throw new Error('Web Workers are not available')
        }}
      />,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Check with engine' }))
    expect(
      await screen.findByText('Engine check failed: Web Workers are not available'),
    ).toBeInTheDocument()
  })
})
