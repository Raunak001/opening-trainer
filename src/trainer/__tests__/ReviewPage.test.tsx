import 'fake-indexeddb/auto'
import { act, render, screen, waitFor } from '@testing-library/react'
import type { Key } from 'chessground/types'
import Dexie from 'dexie'
import { Rating, State } from 'ts-fsrs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BoardProps } from '../../board'
import { TrainerDB, updateSettings } from '../../db'
import { buildAndSave } from '../../repertoire/builder'
import { DEFAULT_PRUNE_SETTINGS } from '../../repertoire/prune'
import { fakeClient, keyAfter, world } from '../../repertoire/__tests__/fakeWorld'
import { syncCards } from '../../srs'
import { ReviewPage } from '../ReviewPage'

// chessground cannot be dragged in jsdom: stand in for the board and keep its props.
const board: { current?: BoardProps } = {}
vi.mock('../../board', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../board')>()),
  Board: (props: BoardProps) => {
    board.current = props
    return <div data-testid="board" data-fen={props.fen} />
  },
}))

// White after 1.e4: 2.Nf3 against 1...e5, 2.c3 against 1...c5. Cards: 1.e4, 2.Nf3, 2.c3.
const WORLD = world({
  '': [['e4', 60, 10, 30]],
  e4: [
    ['e5', 30, 10, 20],
    ['c5', 15, 5, 10],
  ],
  'e4 e5': [['Nf3', 60, 0, 40]],
  'e4 c5': [['c3', 50, 0, 50]],
})

const names: string[] = []
afterEach(async () => {
  for (const n of names.splice(0)) await Dexie.delete(n)
  board.current = undefined
})

async function setup() {
  const name = `review-page-${names.length}`
  names.push(name)
  const db = new TrainerDB(name)
  const rep = await buildAndSave(db, {
    name: 'My 1.e4',
    color: 'white',
    startMoves: ['e4'],
    speeds: ['blitz'],
    ratings: [1600],
    settings: { ...DEFAULT_PRUNE_SETTINGS, maxPly: 2 },
    client: fakeClient(WORLD).client,
  })
  await syncCards(db, rep.id)
  return { db, rep }
}

// Generous: these run on real timers and IndexedDB, slow when the whole suite runs.
const WAIT = { timeout: 10_000 }

/** Waits until the board accepts a move in the given position, then plays it. */
async function play(fenStart: string, from: string, to: string) {
  await waitFor(() => {
    expect(board.current?.fen.startsWith(fenStart)).toBe(true)
    expect(board.current?.interactive).toBe(true)
  }, WAIT)
  act(() => board.current?.onMove?.(from as Key, to as Key))
}

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w'
const AFTER_E5 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w'
const AFTER_C5 = 'rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w'

describe('ReviewPage', () => {
  it('says when nothing is due, and why', async () => {
    const { db } = await setup()
    await updateSettings(db, { daily: { newCards: 0 } })
    render(<ReviewPage db={db} />)
    expect(await screen.findByText('Nothing is due right now.', {}, WAIT)).toBeInTheDocument()
    expect(
      screen.getByText(/Today's limits are reached: 3 new and 0 review cards wait/),
    ).toBeInTheDocument()
  })

  it('plays each card in its line context, grades it, requeues Again, and saves reviews', async () => {
    const { db, rep } = await setup()
    // "Instant" must not depend on how loaded the test machine is.
    await updateSettings(db, { grading: { easyUnderMs: 60_000 } })
    render(<ReviewPage db={db} nextCardDelayMs={500} />)

    // Card 1: the start position, no context. Answered at once → Easy.
    expect(await screen.findByText('Challenge 1/3', {}, WAIT)).toBeInTheDocument()
    expect(screen.getByText('My 1.e4. Play your first move.')).toBeInTheDocument()
    await play(START, 'e2', 'e4')
    expect(await screen.findByText(/^Easy: Instant/, {}, WAIT)).toBeInTheDocument()

    // Card 2: 1.e4 c5 or 1.e4 e5, replayed as context first. Wrong once → Again.
    await screen.findByText('Challenge 2/3', {}, WAIT)
    expect(board.current?.interactive).toBe(false) // replaying the context
    await waitFor(() => expect(board.current?.interactive).toBe(true), WAIT)
    const first = board.current?.fen.startsWith(AFTER_E5) ? 'e5' : 'c5'
    act(() => board.current?.onMove?.('a2' as Key, 'a3' as Key)) // wrong
    await waitFor(() => expect(board.current?.interactive).toBe(true), WAIT)
    if (first === 'e5') act(() => board.current?.onMove?.('g1' as Key, 'f3' as Key))
    else act(() => board.current?.onMove?.('c2' as Key, 'c3' as Key))
    expect(await screen.findByText(/^Again: Not first time/, {}, WAIT)).toBeInTheDocument()

    // Card 3: the other reply. The failed card is put back after it (4 answers in all).
    await screen.findByText('Challenge 3/4', {}, WAIT)
    if (first === 'e5') await play(AFTER_C5, 'c2', 'c3')
    else await play(AFTER_E5, 'g1', 'f3')
    await screen.findByText(/^Easy: Instant/, {}, WAIT)

    // Retry of the failed card, clean this time.
    await screen.findByText('Challenge 4/4', {}, WAIT)
    if (first === 'e5') await play(AFTER_E5, 'g1', 'f3')
    else await play(AFTER_C5, 'c2', 'c3')

    expect(await screen.findByText('Session complete: 4 answers.', {}, WAIT)).toBeInTheDocument()
    expect(screen.getByText('Again 1 · Hard 0 · Good 0 · Easy 3')).toBeInTheDocument()

    const logs = await db.reviewLogs.orderBy('id').toArray()
    expect(logs.map((l) => l.rating)).toEqual([Rating.Easy, Rating.Again, Rating.Easy, Rating.Easy])
    expect(logs[1]).toMatchObject({ mistakes: 1, hintUsed: false })
    const failed = await db.cards.get(`${rep.id}:${keyAfter(`e4 ${first}`)}`)
    expect(failed).toMatchObject({ reps: 2, state: State.Review })
  }, 20_000)
})
