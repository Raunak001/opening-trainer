import 'fake-indexeddb/auto'
import { act, render, screen, waitFor } from '@testing-library/react'
import type { Key } from 'chessground/types'
import Dexie from 'dexie'
import { Rating } from 'ts-fsrs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BoardProps } from '../../board'
import { TrainerDB } from '../../db'
import { CENTER, PACK } from '../../lessons/__tests__/fixtures'
import { lessonCardId, newLessonCard } from '../../srs'
import { ReviewPage } from '../ReviewPage'

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
  const name = `review-lesson-${names.length}`
  names.push(name)
  return new TrainerDB(name)
}

const PACKS = [PACK]
const WAIT = { timeout: 4000 }

describe('ReviewPage with lesson cards', () => {
  it('plays a due lesson card on its own position; any accepted move counts', async () => {
    const db = openDb()
    await db.cards.put(newLessonCard(PACK, CENTER, new Date(Date.now() - 1000)))
    render(<ReviewPage db={db} packs={PACKS} nextCardDelayMs={10} />)

    expect(await screen.findByText('Challenge 1/1', {}, WAIT)).toBeInTheDocument()
    expect(screen.getByText('Strike the center. Find the move.')).toBeInTheDocument()
    await waitFor(() => expect(board.current?.interactive).toBe(true), WAIT)
    expect(board.current?.fen).toBe(CENTER.fen)
    act(() => board.current?.onMove?.('d2' as Key, 'd3' as Key))

    expect(await screen.findByText(/^Easy: Instant.*d4 hits e5/, {}, WAIT)).toBeInTheDocument()
    expect(await screen.findByText('Session complete: 1 answers.', {}, WAIT)).toBeInTheDocument()
    const logs = await db.reviewLogs.toArray()
    expect(logs).toMatchObject([
      { cardId: lessonCardId(PACK.id, CENTER.fen), rating: Rating.Easy, mistakes: 0 },
    ])
  })

  it('skips lesson cards whose lesson is no longer bundled', async () => {
    const db = openDb()
    await db.cards.put(newLessonCard(PACK, CENTER, new Date(Date.now() - 1000)))
    render(<ReviewPage db={db} packs={[]} />)
    expect(await screen.findByText('Nothing is due right now.', {}, WAIT)).toBeInTheDocument()
  })
})
