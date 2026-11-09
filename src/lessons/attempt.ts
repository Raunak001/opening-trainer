// One try at a lesson: a pure state machine, like trainer/drill.ts for a single move.

import { Chess, type Square } from 'chess.js'
// Direct module import: the trainer index also re-exports React pages.
import { MISSES_FOR_ARROW, type HintLevel, type MoveInput } from '../trainer/drill'
import type { Lesson } from './lesson'

export type LessonStatus = 'awaitingUser' | 'solved'

export interface LessonAttempt {
  lesson: Lesson
  /** The lesson position, or the position after the solving move. */
  fen: string
  status: LessonStatus
  /** Wrong moves so far. */
  misses: number
  /** Text hints revealed so far (`lesson.hints[0..textHints)`). */
  textHints: number
  /** Board hint: highlight the piece, then the arrow. Comes after the text hints. */
  board: HintLevel
  /** The solving move, once played. */
  solvedBy?: { san: string; from: Square; to: Square }
}

export type LessonMoveResult = 'correct' | 'wrong' | 'illegal' | 'ignored'

export function createAttempt(lesson: Lesson): LessonAttempt {
  return { lesson, fen: lesson.fen, status: 'awaitingUser', misses: 0, textHints: 0, board: 'none' }
}

/** The main answer, resolved: the arrow and piece hints point at it. */
export function mainAnswer(lesson: Lesson): { san: string; from: Square; to: Square } {
  const move = new Chess(lesson.fen).move(lesson.accepted[0])
  return { san: move.san, from: move.from, to: move.to }
}

/** Any accepted move solves the lesson. Wrong and illegal moves leave the position as is. */
export function submitLessonMove(
  state: LessonAttempt,
  input: MoveInput,
): { state: LessonAttempt; result: LessonMoveResult } {
  if (state.status !== 'awaitingUser') return { state, result: 'ignored' }
  let move
  try {
    move = new Chess(state.fen).move(input)
  } catch {
    return { state, result: 'illegal' }
  }
  if (!state.lesson.accepted.includes(move.san)) {
    const misses = state.misses + 1
    const board = misses >= MISSES_FOR_ARROW ? 'arrow' : state.board
    return { state: { ...state, misses, board }, result: 'wrong' }
  }
  return {
    state: {
      ...state,
      fen: move.after,
      status: 'solved',
      solvedBy: { san: move.san, from: move.from, to: move.to },
    },
    result: 'correct',
  }
}

/** Reveals the next hint: each text hint in turn, then the piece, then the arrow. */
export function requestLessonHint(state: LessonAttempt): LessonAttempt {
  if (state.status !== 'awaitingUser') return state
  if (state.textHints < state.lesson.hints.length)
    return { ...state, textHints: state.textHints + 1 }
  if (state.board === 'none') return { ...state, board: 'piece' }
  return { ...state, board: 'arrow' }
}

/** True once there is nothing more to reveal. */
export function hintsExhausted(state: LessonAttempt): boolean {
  return state.textHints >= state.lesson.hints.length && state.board === 'arrow'
}

export function hintUsed(state: LessonAttempt): boolean {
  return state.textHints > 0 || state.board !== 'none'
}
