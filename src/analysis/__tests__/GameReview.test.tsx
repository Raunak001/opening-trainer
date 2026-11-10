import 'fake-indexeddb/auto'
import { fireEvent, render, screen } from '@testing-library/react'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { TrainerDB, type AnalysisEval, type GameRow } from '../../db'
import { analysisRow } from '../analyze'
import { GameReview } from '../GameReview'

const names: string[] = []
const openDb = () => {
  const name = `game-review-test-${names.length}`
  names.push(name)
  return new TrainerDB(name)
}
afterEach(async () => {
  for (const n of names.splice(0)) await Dexie.delete(n)
})

const sans = ['e4', 'e5', 'Nf3', 'Nc6']
const game: GameRow = {
  id: 'https://www.chess.com/game/live/1',
  username: 'me',
  archiveId: 'me/2026/11',
  endTime: Date.UTC(2026, 10, 1),
  timeClass: 'blitz',
  color: 'white',
  opponent: 'Rival',
  result: 'draw',
  pgn: '',
  sans,
}
const cp = (value: number, best: string): AnalysisEval => ({
  score: { type: 'cp', value },
  best,
  pv: [best],
})
const evals = [cp(30, 'e2e4'), cp(-30, 'e7e5'), cp(30, 'g1f3'), cp(-30, 'b8c6'), cp(30, 'f1b5')]

const currentMove = () =>
  document.querySelector('.review-moves [aria-current="true"]')?.textContent ?? null

describe('GameReview', () => {
  it('steps through the game with the arrow keys without focusing the board', async () => {
    const db = openDb()
    await db.analyses.put(analysisRow(game.id, sans, evals, 10, 0))
    render(<GameReview game={game} db={db} onBack={() => {}} />)
    await screen.findByText(/Step through the game/, {}, { timeout: 5000 })
    expect(currentMove()).toBeNull()

    fireEvent.keyDown(window, { key: 'ArrowRight' })
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(currentMove()).toBe('e5')

    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(currentMove()).toBe('e4')

    fireEvent.keyDown(window, { key: 'End' })
    expect(currentMove()).toBe('Nc6')
    fireEvent.keyDown(window, { key: 'ArrowRight' }) // stays on the last move
    expect(currentMove()).toBe('Nc6')

    fireEvent.keyDown(window, { key: 'Home' })
    expect(currentMove()).toBeNull()
  }, 10_000)
})
