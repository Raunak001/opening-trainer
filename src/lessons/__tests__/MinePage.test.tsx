import 'fake-indexeddb/auto'
import { fireEvent, render, screen, within } from '@testing-library/react'
import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BoardProps } from '../../board'
import { TrainerDB, updateSettings, type GameRow } from '../../db'
import type { Engine } from '../../engine'
import { fakeClient, world } from '../../repertoire/__tests__/fakeWorld'
import { LessonsPage } from '../LessonsPage'
import { MinePage } from '../MinePage'
import { Chess } from 'chess.js'
import { fenAfter } from './fixtures'

const board: { current?: BoardProps } = {}
vi.mock('../../board', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../board')>()),
  Board: (props: BoardProps) => {
    board.current = props
    return <div data-testid="board" data-fen={props.fen} />
  },
}))

const names: string[] = []
afterEach(async () => {
  for (const n of names.splice(0)) await Dexie.delete(n)
  board.current = undefined
})
function openDb() {
  const name = `mine-page-${names.length}`
  names.push(name)
  return new TrainerDB(name)
}

function gameRow(id: string, moves: string, timeClass: GameRow['timeClass'] = 'blitz'): GameRow {
  return {
    id: `https://www.chess.com/game/live/${id}`,
    username: 'me',
    archiveId: 'me/2026/11',
    endTime: Date.UTC(2026, 10, Number(id)),
    timeClass,
    color: 'white',
    opponent: 'Rival',
    result: 'win',
    pgn: '',
    sans: moves.split(' '),
  }
}

/** Scores every position 0.00, so every concept move is as good as the best. */
function levelEngine(): () => Engine {
  const engine: Engine = {
    ready: async () => {},
    search: async (fen, options) => {
      const move = new Chess(fen).moves({ verbose: true })[0]
      const pv = [move.lan]
      return {
        fen,
        bestMove: pv[0],
        lines: [
          { depth: options.depth, multipv: 1, score: { type: 'cp', value: 0 }, bound: 'exact', pv },
        ],
      }
    },
    cancel: () => {},
    setOption: async () => {},
    dispose: () => {},
  }
  return () => engine
}

/** Italian after 4...Nf6, where 5.d4 strikes the center. */
const ITALIAN = 'e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6'

async function withGames() {
  const db = openDb()
  await updateSettings(db, { importer: { username: 'me', timeClasses: ['blitz'] } })
  await db.games.bulkPut([
    gameRow('1', `${ITALIAN} O-O`),
    gameRow('2', `${ITALIAN} d3`),
    gameRow('3', 'e4 e5 Qh5 Nc6'),
    gameRow('4', `${ITALIAN} O-O`, 'bullet'),
  ])
  return db
}

describe('MinePage', () => {
  it('mines your games, checks with Stockfish and lists candidates per concept', async () => {
    const onOpen = vi.fn()
    render(<MinePage db={await withGames()} engine={levelEngine()} onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Castle early' }))
    fireEvent.click(screen.getByRole('button', { name: 'Find positions' }))

    expect(
      await screen.findByText('3 games: 4 candidates, 4 pass the Stockfish check.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Castle early' })).not.toBeInTheDocument()
    const strike = screen.getByRole('region', { name: 'Strike the center' })
    const italian = within(strike)
      .getAllByRole('listitem')
      .find((li) => li.textContent?.includes('4.c3 Nf6'))
    if (!italian) throw new Error('Italian position not listed')
    expect(italian).toHaveTextContent(
      'Concept moves: d4 · missed in 2 of 2 games (100%) · played instead: d3 (1), O-O (1)',
    )
    expect(italian).toHaveTextContent(/Stockfish: best .* · d4 /)
    expect(
      within(screen.getByRole('region', { name: 'Punish the early queen' })).getByText(
        'Nothing found.',
      ),
    ).toBeInTheDocument()

    fireEvent.click(within(italian).getByRole('button', { name: 'Open in Author' }))
    expect(onOpen).toHaveBeenCalledWith(
      expect.objectContaining({ concept: 'strike-center', fen: fenAfter(ITALIAN) }),
    )
  })

  it('can skip the Stockfish check', async () => {
    render(<MinePage db={await withGames()} />)
    fireEvent.click(screen.getByRole('checkbox', { name: /Check with Stockfish/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Find positions' }))
    expect(await screen.findByText('3 games: 6 candidates.')).toBeInTheDocument()
  })

  it('lists unchecked candidates when there is no engine', async () => {
    render(<MinePage db={await withGames()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Find positions' }))
    expect(
      await screen.findByText(
        /^3 games: 6 candidates, not checked \(Web Workers are not available\)\.$/,
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Castle early' })).toBeInTheDocument()
  })

  it('asks for a username first', async () => {
    render(<MinePage db={openDb()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Find positions' }))
    expect(await screen.findByText(/No chess.com username yet/)).toBeInTheDocument()
  })

  it('mines the explorer with the chosen filters', async () => {
    const { client, queries } = fakeClient(
      world({
        '': [['e4', 50, 10, 40]],
        e4: [['e5', 50, 10, 40]],
        'e4 e5': [['Qh5', 15, 0, 15]],
        'e4 e5 Qh5': [['Nc6', 20, 5, 15]],
      }),
    )
    render(<MinePage db={openDb()} client={client} engine={levelEngine()} />)
    fireEvent.click(screen.getByRole('radio', { name: 'Lichess explorer' }))
    fireEvent.change(screen.getByLabelText('Rating to'), { target: { value: '2000' } })
    fireEvent.change(screen.getByLabelText('Start moves'), { target: { value: '1. e4 e5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Find positions' }))

    expect(
      await screen.findByText(/^3 explorer positions: 2 candidates, 2 pass the Stockfish check\.$/),
    ).toBeInTheDocument()
    expect(queries[0]).toMatchObject({ ratings: [1600, 1800, 2000], speeds: ['blitz', 'rapid'] })
    const queen = screen.getByRole('region', { name: 'Punish the early queen' })
    expect(within(queen).getByText('1.e4 e5 2.Qh5')).toBeInTheDocument()
  })

  it('reports bad start moves', async () => {
    render(<MinePage db={openDb()} client={fakeClient(new Map()).client} />)
    fireEvent.click(screen.getByRole('radio', { name: 'Lichess explorer' }))
    fireEvent.change(screen.getByLabelText('Start moves'), { target: { value: 'e4 Ke7' } })
    fireEvent.click(screen.getByRole('button', { name: 'Find positions' }))
    expect(await screen.findByRole('status')).toHaveTextContent(/Ke7/)
  })
})

describe('LessonsPage mining → authoring', () => {
  it('opens a mined position in the authoring tool and keeps the draft pack', async () => {
    const db = await withGames()
    render(
      <LessonsPage
        packs={{ packs: [], errors: [] }}
        author={{ db }}
        mine={{ db, engine: levelEngine() }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Author' }))
    fireEvent.change(screen.getByLabelText('Pack name'), { target: { value: 'My pack' } })

    fireEvent.click(screen.getByRole('button', { name: 'Mine' }))
    fireEvent.click(screen.getByRole('button', { name: 'Find positions' }))
    const develop = await screen.findByRole('region', { name: 'Develop before attacking' })
    fireEvent.click(within(develop).getByRole('button', { name: 'Open in Author' }))

    expect(board.current?.fen).toBe(fenAfter('e4 e5'))
    expect(screen.getByLabelText('Concept')).toHaveValue('develop-before-attacking')
    expect(screen.getByLabelText('Id')).toHaveValue('attacking-01')
    expect(screen.getByLabelText('Pack name')).toHaveValue('My pack')
    expect(screen.getByRole('status')).toHaveTextContent('Loaded a mined position')
  })
})
