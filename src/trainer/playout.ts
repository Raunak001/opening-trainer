// Play-out after a drilled line: N user moves against a weakened engine, each graded.
// Pure state machine: no React, no engine.

import { Chess, type Square } from 'chess.js'
import type { MoveGrade } from '../engine'
import type { MoveInput, Side } from './drill'

export interface PlayoutMove {
  san: string
  uci: string
  from: Square
  to: Square
  byUser: boolean
  /** Position before the move. */
  fenBefore: string
  /** Set once the engine has graded a user move. */
  grade?: MoveGrade
}

export type PlayoutStatus = 'awaitingUser' | 'awaitingEngine' | 'complete'

export type PlayoutEnd = 'moves' | 'checkmate' | 'stalemate' | 'draw'

export interface PlayoutState {
  userSide: Side
  startFen: string
  fen: string
  /** User moves to play in total. */
  userMoves: number
  moves: PlayoutMove[]
  status: PlayoutStatus
  end?: PlayoutEnd
}

function sideOf(fen: string): Side {
  return fen.split(' ')[1] === 'b' ? 'black' : 'white'
}

function settle(state: PlayoutState): PlayoutState {
  const chess = new Chess(state.fen)
  let end: PlayoutEnd | undefined
  if (chess.isCheckmate()) end = 'checkmate'
  else if (chess.isStalemate()) end = 'stalemate'
  else if (chess.isDraw()) end = 'draw'
  else if (userMovesPlayed(state) >= state.userMoves && sideOf(state.fen) === state.userSide)
    end = 'moves'
  if (end) return { ...state, status: 'complete', end }
  return {
    ...state,
    status: sideOf(state.fen) === state.userSide ? 'awaitingUser' : 'awaitingEngine',
  }
}

export function createPlayout(fen: string, userSide: Side, userMoves: number): PlayoutState {
  return settle({ userSide, startFen: fen, fen, userMoves, moves: [], status: 'awaitingUser' })
}

export function userMovesPlayed(state: Pick<PlayoutState, 'moves'>): number {
  return state.moves.filter((m) => m.byUser).length
}

function apply(state: PlayoutState, move: MoveInput | string, byUser: boolean): PlayoutState {
  const chess = new Chess(state.fen)
  let played
  try {
    played =
      typeof move === 'string'
        ? chess.move({ from: move.slice(0, 2), to: move.slice(2, 4), promotion: move[4] })
        : chess.move(move)
  } catch {
    return state
  }
  const record: PlayoutMove = {
    san: played.san,
    uci: played.from + played.to + (played.promotion ?? ''),
    from: played.from,
    to: played.to,
    byUser,
    fenBefore: state.fen,
  }
  return settle({ ...state, fen: chess.fen(), moves: [...state.moves, record] })
}

/** The user's move; ignored unless it is their turn and the move is legal. */
export function playUserMove(state: PlayoutState, input: MoveInput): PlayoutState {
  return state.status === 'awaitingUser' ? apply(state, input, true) : state
}

/** The engine's reply as UCI; ignored unless it is the engine's turn and the move is legal. */
export function playEngineMove(state: PlayoutState, uci: string): PlayoutState {
  return state.status === 'awaitingEngine' ? apply(state, uci, false) : state
}

/** Records the grade of the move at `index` (a user move). */
export function setGrade(state: PlayoutState, index: number, grade: MoveGrade): PlayoutState {
  if (!state.moves[index]?.byUser) return state
  const moves = state.moves.map((m, i) => (i === index ? { ...m, grade } : m))
  return { ...state, moves }
}

export type GradeCounts = Record<MoveGrade, number>

export function gradeCounts(state: Pick<PlayoutState, 'moves'>): GradeCounts {
  const counts: GradeCounts = { book: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 }
  for (const m of state.moves) if (m.byUser && m.grade) counts[m.grade]++
  return counts
}

const END_TEXT: Record<PlayoutEnd, string> = {
  moves: 'Play-out finished.',
  checkmate: 'Checkmate.',
  stalemate: 'Stalemate.',
  draw: 'Drawn position.',
}

const PLURAL: Record<MoveGrade, [string, string]> = {
  book: ['book move', 'book moves'],
  good: ['good move', 'good moves'],
  inaccuracy: ['inaccuracy', 'inaccuracies'],
  mistake: ['mistake', 'mistakes'],
  blunder: ['blunder', 'blunders'],
}

/** "Play-out finished. 7 good moves, 2 inaccuracies, 1 mistake." */
export function playoutSummary(state: PlayoutState): string {
  const counts = gradeCounts(state)
  const parts = (Object.keys(PLURAL) as MoveGrade[])
    .filter((g) => counts[g] > 0)
    .map((g) => `${counts[g]} ${PLURAL[g][counts[g] === 1 ? 0 : 1]}`)
  const head = END_TEXT[state.end ?? 'moves']
  return parts.length > 0 ? `${head} ${parts.join(', ')}.` : head
}
