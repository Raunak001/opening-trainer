import { act, fireEvent, render, screen } from '@testing-library/react'
import type { Key } from 'chessground/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BoardProps } from '../../board'
import { LessonsPage } from '../LessonsPage'
import { CENTER, PACK } from './fixtures'

// chessground cannot be dragged in jsdom: stand in for the board and keep its props.
const board: { current?: BoardProps } = {}
vi.mock('../../board', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../board')>()),
  Board: (props: BoardProps) => {
    board.current = props
    return <div data-testid="board" data-fen={props.fen} />
  },
}))

afterEach(() => {
  board.current = undefined
  vi.useRealTimers()
})

const move = (from: string, to: string) =>
  act(() => board.current?.onMove?.(from as Key, to as Key))

function openPack(onSolved = vi.fn()) {
  render(<LessonsPage packs={{ packs: [PACK], errors: [] }} onSolved={onSolved} />)
  fireEvent.click(screen.getByRole('button', { name: /Test pack/ }))
  return onSolved
}

describe('LessonsPage', () => {
  it('lists packs with their concepts and shows load errors', () => {
    render(<LessonsPage packs={{ packs: [PACK], errors: ['bad.json: broken'] }} />)
    expect(screen.getByText(/2 lessons · Strike the center, Punish the early queen/)).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent('bad.json: broken')
  })

  it('explains where packs come from when there are none', () => {
    render(<LessonsPage packs={{ packs: [], errors: [] }} />)
    expect(screen.getByText(/No packs yet/)).toBeInTheDocument()
  })

  it('plays a lesson: wrong move, text hint, then any accepted move solves it', () => {
    vi.useFakeTimers()
    const onSolved = openPack()
    expect(screen.getByText('Challenge 1/2')).toBeInTheDocument()
    expect(screen.getByText('Strike the center. Find the move.')).toBeInTheDocument()
    expect(screen.getByText(/c3 prepared it\. Strike the center\. You play White\./)).toBeVisible()
    expect(board.current?.orientation).toBe('white')

    move('e1', 'g1')
    expect(screen.getByText('Not quite. Try again.')).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(1000))

    fireEvent.click(screen.getByRole('button', { name: 'Hint' }))
    expect(screen.getByText('Hint: Which pawn can challenge e5?')).toBeInTheDocument()

    move('d2', 'd3')
    expect(screen.getByText(/d3 is correct! d4 hits e5/)).toBeInTheDocument()
    expect(board.current?.interactive).toBe(false)
    expect(onSolved).toHaveBeenCalledWith(
      PACK,
      CENTER,
      expect.objectContaining({ mistakes: 1, hintUsed: true }),
    )
  })

  it('shows the piece, then the arrow, once text hints run out', () => {
    openPack()
    fireEvent.click(screen.getByRole('button', { name: 'Forward' }))
    expect(screen.getByText('Challenge 2/2')).toBeInTheDocument()
    expect(board.current?.orientation).toBe('black')

    fireEvent.click(screen.getByRole('button', { name: 'Hint' }))
    expect(board.current?.squareClasses?.get('b8')).toBe('hint')
    fireEvent.click(screen.getByRole('button', { name: 'Hint' }))
    expect(board.current?.shapes).toEqual([{ orig: 'b8', dest: 'c6', brush: 'orange' }])
    expect(screen.getByRole('button', { name: 'Hint' })).toBeDisabled()
  })

  it('moves to the next lesson and completes the pack', () => {
    openPack()
    move('d2', 'd4')
    fireEvent.click(screen.getByRole('button', { name: 'Next lesson' }))
    expect(screen.getByText('Challenge 2/2')).toBeInTheDocument()
    move('b8', 'c6')
    expect(screen.getByRole('status')).toHaveTextContent('Pack complete: all 2 solved.')
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '2')

    fireEvent.click(screen.getByRole('button', { name: 'All packs' }))
    expect(screen.getByRole('heading', { name: 'Lesson packs' })).toBeInTheDocument()
  })

  it('restarts a solved lesson with "Try again"', () => {
    openPack()
    move('d2', 'd4')
    expect(board.current?.interactive).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(board.current?.fen).toBe(CENTER.fen)
    expect(board.current?.interactive).toBe(true)
  })
})
