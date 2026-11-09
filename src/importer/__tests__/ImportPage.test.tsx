import 'fake-indexeddb/auto'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { getSettings, TrainerDB } from '../../db'
import { buildAndSave } from '../../repertoire/builder'
import { syncCards } from '../../srs'
import { DEFAULT_PRUNE_SETTINGS } from '../../repertoire/prune'
import { fakeClient, world } from '../../repertoire/__tests__/fakeWorld'
import type { ChesscomClient } from '../chesscom'
import { ImportPage } from '../ImportPage'
import { game } from './fixtures'

const names: string[] = []
const openDb = () => {
  const name = `import-page-test-${names.length}`
  names.push(name)
  return new TrainerDB(name)
}
afterEach(async () => {
  for (const n of names.splice(0)) await Dexie.delete(n)
})

const row = (id: string) => ({
  id: `https://www.chess.com/game/live/${id}`,
  username: 'me',
  archiveId: 'me/2026/11',
  endTime: Date.UTC(2026, 10, Number(id)),
  timeClass: 'blitz' as const,
  color: 'white' as const,
  opponent: 'Rival',
  result: 'win' as const,
  pgn: '',
  sans: [] as string[],
})

const noGrades = async () => ({ grade: 'good' as const, best: null })

const client: ChesscomClient = {
  archives: async () => ['2026/10'],
  month: async () => [
    game({ moves: 'e4 e5 Nf3', url: 'https://www.chess.com/game/live/1' }),
    game({
      moves: 'd4 Nf6',
      color: 'black',
      result: 'loss',
      url: 'https://www.chess.com/game/live/2',
    }),
  ],
}

describe('ImportPage', () => {
  it('syncs a username, remembers it and lists the games', async () => {
    const db = openDb()
    render(<ImportPage db={db} client={client} gradeReply={noGrades} />)
    const input = await screen.findByLabelText('chess.com username')
    await waitFor(() => expect(input).toBeEnabled())
    fireEvent.change(input, { target: { value: 'Me' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sync' }))

    expect(
      await screen.findByText(/Fetched 1 of 1 months: 2 new games.*No cards from games\./),
    ).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Games (2)' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Black vs Rival' })).toBeInTheDocument()
    expect((await getSettings(db)).importer.username).toBe('me')
  })

  it("filters by time class (saved) and by the user's color", async () => {
    const db = openDb()
    const mixed: ChesscomClient = {
      archives: async () => ['2026/10'],
      month: async () => [
        game({ moves: 'e4', timeClass: 'blitz' }),
        game({ moves: 'd4', timeClass: 'bullet' }),
        game({ moves: 'c4', timeClass: 'rapid', color: 'black' }),
      ],
    }
    render(<ImportPage db={db} client={mixed} gradeReply={noGrades} />)
    const input = await screen.findByLabelText('chess.com username')
    await waitFor(() => expect(input).toBeEnabled())
    fireEvent.change(input, { target: { value: 'me' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sync' }))
    expect(await screen.findByRole('heading', { name: 'Games (3)' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('checkbox', { name: 'bullet' }))
    expect(screen.getByRole('heading', { name: 'Games (2 of 3)' })).toBeInTheDocument()
    await waitFor(async () =>
      expect((await getSettings(db)).importer.timeClasses).toEqual(['blitz', 'rapid', 'daily']),
    )

    fireEvent.change(screen.getByLabelText('Your color'), { target: { value: 'black' } })
    expect(screen.getByRole('heading', { name: 'Games (1 of 3)' })).toBeInTheDocument()
  })

  it("lists each game's deviation against the matching repertoire", async () => {
    const db = openDb()
    await buildAndSave(db, {
      name: 'My 1.e4',
      color: 'white',
      startMoves: ['e4'],
      speeds: ['blitz'],
      ratings: [1600],
      settings: { ...DEFAULT_PRUNE_SETTINGS, maxPly: 2 },
      client: fakeClient(
        world({
          '': [['e4', 6, 1, 3]],
          e4: [['e5', 5, 1, 4]],
          'e4 e5': [['Nf3', 6, 0, 4]],
        }),
      ).client,
    })
    await db.games.bulkPut([
      { ...row('1'), sans: ['e4', 'e5', 'Bc4'] },
      { ...row('2'), sans: ['e4', 'c5'] },
      { ...row('3'), sans: ['d4'], color: 'black' },
    ])
    await db.settings.put({
      id: 'app',
      importer: { ...(await getSettings(db)).importer, username: 'me' },
    })

    render(<ImportPage db={db} client={client} />)
    expect(await screen.findByText('You left book: 2.Bc4 (repertoire: Nf3)')).toBeInTheDocument()
    expect(screen.getByText('Opponent left book: 1…c5')).toBeInTheDocument()
    expect(screen.getByText('No repertoire for this color')).toBeInTheDocument()
    expect(screen.getAllByText(/My 1\.e4/)).toHaveLength(2)
  })

  it('a sync fails the card the user left book on and marks the game', async () => {
    const db = openDb()
    const rep = await buildAndSave(db, {
      name: 'My 1.e4',
      color: 'white',
      startMoves: ['e4'],
      speeds: ['blitz'],
      ratings: [1600],
      settings: { ...DEFAULT_PRUNE_SETTINGS, maxPly: 2 },
      client: fakeClient(
        world({
          '': [['e4', 6, 1, 3]],
          e4: [['e5', 5, 1, 4]],
          'e4 e5': [['Nf3', 6, 0, 4]],
        }),
      ).client,
    })
    await syncCards(db, rep.id, new Date(Date.now() - 10 * 86_400_000))
    const recent: ChesscomClient = {
      archives: async () => ['2026/11'],
      month: async () => [game({ moves: 'e4 e5 Bc4', end: Math.floor(Date.now() / 1000) - 3600 })],
    }
    render(<ImportPage db={db} client={recent} gradeReply={noGrades} />)
    const input = await screen.findByLabelText('chess.com username')
    await waitFor(() => expect(input).toBeEnabled())
    fireEvent.change(input, { target: { value: 'me' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sync' }))
    expect(
      await screen.findByText(/From your games: 1 card failed and 0 cards new, due now\./),
    ).toBeInTheDocument()
    expect(await screen.findByText('card failed')).toBeInTheDocument()
  })

  it('lists coverage gaps and adds one to the tree', async () => {
    const db = openDb()
    const explorer = fakeClient(
      world({
        '': [['e4', 50, 10, 40]],
        e4: [
          ['e5', 90, 10, 80],
          ['c5', 2, 1, 2],
        ],
        'e4 e5': [['Nf3', 50, 10, 40]],
        'e4 c5': [['Nf3', 50, 10, 40]],
      }),
    ).client
    await buildAndSave(db, {
      name: 'My 1.e4',
      color: 'white',
      startMoves: ['e4'],
      speeds: ['blitz'],
      ratings: [1600],
      settings: { ...DEFAULT_PRUNE_SETTINGS, maxPly: 2 },
      client: explorer,
    })
    await db.games.bulkPut([
      { ...row('4'), sans: ['e4', 'c5', 'Nf3'], cards: { processedAt: 1, outcome: 'none' } },
      {
        ...row('5'),
        sans: ['e4', 'c5', 'c3'],
        result: 'loss',
        cards: { processedAt: 1, outcome: 'none' },
      },
      { ...row('6'), sans: ['e4', 'd5'], cards: { processedAt: 1, outcome: 'none' } },
    ])
    await db.settings.put({
      id: 'app',
      importer: { ...(await getSettings(db)).importer, username: 'me' },
    })

    render(<ImportPage db={db} client={client} gradeReply={noGrades} explorer={explorer} />)
    expect(await screen.findByRole('heading', { name: 'Coverage gaps (1)' })).toBeInTheDocument()
    expect(screen.getByText('2 games · you scored 50%')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Seen in at least'), { target: { value: '1' } })
    expect(screen.getByRole('heading', { name: 'Coverage gaps (2)' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Add 1.e4 c5 to My 1.e4' }))
    expect(
      await screen.findByText('Added 1.e4 c5 to My 1.e4. New cards are in your review queue.'),
    ).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Coverage gaps (1)' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add 1.e4 c5 to My 1.e4' })).not.toBeInTheDocument()
  })

  it('shows a sync error', async () => {
    const failing: ChesscomClient = {
      archives: async () => {
        throw new Error('No such chess.com player.')
      },
      month: async () => [],
    }
    render(<ImportPage db={openDb()} client={failing} gradeReply={noGrades} />)
    const input = await screen.findByLabelText('chess.com username')
    await waitFor(() => expect(input).toBeEnabled())
    fireEvent.change(input, { target: { value: 'ghost' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sync' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No such chess.com player.')
  })
})
