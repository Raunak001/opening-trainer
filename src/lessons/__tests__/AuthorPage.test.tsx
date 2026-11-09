import 'fake-indexeddb/auto'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { Key } from 'chessground/types'
import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BoardProps } from '../../board'
import { TrainerDB, updateSettings } from '../../db'
import type { Engine, SearchOptions } from '../../engine'
import type { InfoLine } from '../../engine/uci'
import { AuthorPage } from '../AuthorPage'
import { validatePack } from '../lesson'
import { CENTER, fenAfter, PACK } from './fixtures'

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
  const name = `author-page-${names.length}`
  names.push(name)
  return new TrainerDB(name)
}

const ITALIAN: InfoLine[] = [
  { depth: 18, multipv: 1, score: { type: 'cp', value: 45 }, bound: 'exact', pv: ['d2d4', 'e5d4'] },
  { depth: 18, multipv: 2, score: { type: 'cp', value: 30 }, bound: 'exact', pv: ['e1g1'] },
  { depth: 18, multipv: 3, score: { type: 'cp', value: -20 }, bound: 'exact', pv: ['d1e2'] },
]

function fakeEngine(lines: InfoLine[]) {
  const calls: { fen: string; options: SearchOptions }[] = []
  const engine: Engine = {
    ready: async () => {},
    async search(fen, options, callbacks) {
      calls.push({ fen, options })
      for (const l of lines) callbacks?.onInfo?.(l)
      return { fen, bestMove: lines[0].pv[0], lines }
    },
    cancel: () => {},
    setOption: async () => {},
    dispose: () => {},
  }
  return { engine: () => engine, calls }
}

const move = (from: string, to: string) =>
  act(() => board.current?.onMove?.(from as Key, to as Key))

describe('AuthorPage', () => {
  it('sets up a position, analyses it, auto-accepts close moves and exports a pack', async () => {
    const db = openDb()
    await updateSettings(db, { lessons: { depth: 12, multiPv: 3 } })
    const { engine, calls } = fakeEngine(ITALIAN)
    const saveFile = vi.fn()
    render(<AuthorPage db={db} engine={engine} packs={[]} saveFile={saveFile} />)

    fireEvent.change(screen.getByLabelText('FEN'), {
      target: { value: fenAfter('e4 e5 Nf3 Nc6 Bc4 Bc5 c3') },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Load FEN' }))
    move('g8', 'f6')
    expect(board.current?.fen).toBe(CENTER.fen)
    expect(board.current?.orientation).toBe('white')

    await waitFor(() => expect(screen.getByText(/Depth 12, 3 lines/)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Analyse' }))
    const lines = await screen.findByRole('list', { name: 'Engine lines' })
    expect(calls).toEqual([{ fen: CENTER.fen, options: { depth: 12, multiPv: 3 } }])
    expect(within(lines).getByRole('checkbox', { name: /d4/ })).toBeChecked()
    expect(within(lines).getByRole('checkbox', { name: /O-O/ })).toBeChecked()
    expect(within(lines).getByRole('checkbox', { name: /Qe2/ })).not.toBeChecked()
    expect(screen.getByLabelText('Explanation')).toHaveValue(
      'Best is d4 (+0.5). Also good: O-O (+0.3).',
    )
    expect(board.current?.shapes).toEqual([
      { orig: 'd2', dest: 'd4', brush: 'orange' },
      { orig: 'e1', dest: 'g1', brush: 'green' },
    ])

    // Drop castling, add d3 by hand, and make it the main answer.
    fireEvent.click(within(lines).getByRole('checkbox', { name: /O-O/ }))
    fireEvent.change(screen.getByLabelText('Add move'), { target: { value: 'd3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    fireEvent.click(screen.getByRole('button', { name: 'Make main' }))
    const accepted = screen.getByRole('list', { name: 'Accepted moves' })
    expect(
      within(accepted)
        .getAllByRole('listitem')
        .map((li) => li.firstChild?.textContent),
    ).toEqual(['d3 (main)', 'd4'])

    expect(screen.getByLabelText('Id')).toHaveValue('center-01')
    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'Hit the center.' } })
    fireEvent.change(screen.getByLabelText('Hints (one per line)'), {
      target: { value: 'Look at e5.\nc3 helps.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save to pack' }))
    expect(screen.getByRole('status')).toHaveTextContent('Saved center-01 to the pack.')
    expect(screen.getByRole('heading', { name: 'Pack (1 lessons)' })).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Pack name'), { target: { value: 'Strike the Center' } })
    fireEvent.click(screen.getByRole('button', { name: 'Export JSON' }))
    expect(saveFile).toHaveBeenCalledTimes(1)
    const [file, text] = saveFile.mock.calls[0] as [string, string]
    expect(file).toBe('strike-the-center.json')
    const result = validatePack(JSON.parse(text))
    expect(result.ok && result.pack.lessons[0]).toEqual({
      id: 'center-01',
      concept: 'strike-center',
      fen: CENTER.fen,
      prompt: 'Hit the center.',
      accepted: ['d3', 'd4'],
      hints: ['Look at e5.', 'c3 helps.'],
      explanation: 'Best is d4 (+0.5). Also good: O-O (+0.3).',
    })
    expect(screen.getByLabelText('Pack JSON')).toHaveValue(text)
  })

  it('shows validation errors instead of saving', () => {
    render(<AuthorPage db={openDb()} packs={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save to pack' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/"prompt" must be a non-empty string/)
    fireEvent.change(screen.getByLabelText('Add move'), { target: { value: 'Ke2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Ke2 is not legal here')
  })

  it('reports an unavailable engine', async () => {
    const engine = () => {
      throw new Error('Web Workers are not available')
    }
    render(<AuthorPage db={openDb()} packs={[]} engine={engine} />)
    fireEvent.click(screen.getByRole('button', { name: 'Analyse' }))
    expect(await screen.findByText('Engine: Web Workers are not available')).toBeInTheDocument()
  })

  it('undoes moves and rejects a bad FEN', () => {
    render(<AuthorPage db={openDb()} packs={[]} />)
    const start = board.current?.fen
    move('e2', 'e4')
    expect(board.current?.orientation).toBe('black')
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(board.current?.fen).toBe(start)
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('FEN'), { target: { value: 'nonsense' } })
    fireEvent.click(screen.getByRole('button', { name: 'Load FEN' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/Invalid FEN/)
  })

  it('opens a bundled pack, edits a lesson and removes one', () => {
    render(<AuthorPage db={openDb()} packs={[PACK]} />)
    fireEvent.change(screen.getByLabelText('Edit a bundled pack'), { target: { value: PACK.id } })
    expect(screen.getByRole('heading', { name: 'Pack (2 lessons)' })).toBeInTheDocument()
    expect(screen.getByLabelText('Pack name')).toHaveValue('Test pack')

    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[1])
    expect(board.current?.fen).toBe(PACK.lessons[1].fen)
    expect(screen.getByLabelText('Id')).toHaveValue('queen-01')
    expect(screen.getByLabelText('Prompt')).toHaveValue(PACK.lessons[1].prompt)

    fireEvent.click(screen.getByRole('button', { name: 'Remove center-01' }))
    expect(screen.getByRole('heading', { name: 'Pack (1 lessons)' })).toBeInTheDocument()
  })
})
