import 'fake-indexeddb/auto'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { getSettings, TrainerDB } from '../../db'
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
    render(<ImportPage db={db} client={client} />)
    const input = await screen.findByLabelText('chess.com username')
    await waitFor(() => expect(input).toBeEnabled())
    fireEvent.change(input, { target: { value: 'Me' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sync' }))

    expect(await screen.findByText(/Fetched 1 of 1 months: 2 new games/)).toBeInTheDocument()
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
    render(<ImportPage db={db} client={mixed} />)
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

  it('shows a sync error', async () => {
    const failing: ChesscomClient = {
      archives: async () => {
        throw new Error('No such chess.com player.')
      },
      month: async () => [],
    }
    render(<ImportPage db={openDb()} client={failing} />)
    const input = await screen.findByLabelText('chess.com username')
    await waitFor(() => expect(input).toBeEnabled())
    fireEvent.change(input, { target: { value: 'ghost' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sync' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No such chess.com player.')
  })
})
