import { Chess, type Move } from 'chess.js'

/** One puzzle from the bundled Lichess set. */
export interface Puzzle {
  /** Lichess puzzle id (lichess.org/training/{id}). */
  id: string
  /** Position before the opponent's setup move. */
  fen: string
  /** UCI moves: the opponent's setup move, then user, opponent, user, … ending on a user move. */
  moves: string[]
  rating: number
  themes: string[]
}

export type PuzzlePhase =
  /** Waiting for the user's move. */
  | 'user'
  /** The user moved correctly; the opponent's reply is next (`opponentReply`). */
  | 'opponent'
  /** The last move has been played (by the user, or by `showSolution`). */
  | 'done'

export interface PuzzleState {
  puzzle: Puzzle
  /** Position on the board (before any wrong move shown on top of it). */
  fen: string
  /** Index into `puzzle.moves` of the next move to play. */
  ply: number
  phase: PuzzlePhase
  /** The user played a wrong move, used a hint or asked for the solution: the puzzle is lost. */
  failed: boolean
  hintUsed: boolean
  /** Wrong moves played so far. */
  mistakes: number
  /** The solution was played out for the user. */
  solutionShown: boolean
  /** Last move played on the board, from and to squares. */
  lastMove?: [string, string]
  /** A wrong move on display until `retry`: the position after it, and its squares. */
  wrong?: { fen: string; from: string; to: string }
  /** SAN of every move played on the board, setup move first. */
  sans: string[]
}

export type MoveResult =
  /** Matched the solution; the opponent replies next. */
  | 'correct'
  /** Matched the solution (or mated another way) and ended the puzzle. */
  | 'solved'
  | 'wrong'
  /** Not the user's turn to move, or an illegal move. */
  | 'ignored'

const uciParts = (uci: string) => ({
  from: uci.slice(0, 2),
  to: uci.slice(2, 4),
  promotion: uci.length > 4 ? uci[4] : undefined,
})

function tryMove(chess: Chess, uci: string): Move | null {
  try {
    return chess.move(uciParts(uci))
  } catch {
    return null
  }
}

/** Side the user plays: the side to move after the setup move. */
export function userColor(puzzle: Puzzle): 'white' | 'black' {
  // The setup move is played by the side to move in `fen`; the user is the other side.
  return puzzle.fen.split(' ')[1] === 'w' ? 'black' : 'white'
}

/** Starts a puzzle with the opponent's setup move already played. */
export function startPuzzle(puzzle: Puzzle): PuzzleState {
  if (puzzle.moves.length < 2) throw new Error(`Puzzle ${puzzle.id} has no solution moves.`)
  const chess = new Chess(puzzle.fen)
  const setup = tryMove(chess, puzzle.moves[0])
  if (!setup) throw new Error(`Puzzle ${puzzle.id}: illegal setup move ${puzzle.moves[0]}.`)
  return {
    puzzle,
    fen: chess.fen(),
    ply: 1,
    phase: 'user',
    failed: false,
    hintUsed: false,
    mistakes: 0,
    solutionShown: false,
    lastMove: [setup.from, setup.to],
    sans: [setup.san],
  }
}

/**
 * Checks the user's move against the solution. A different move that mates counts as
 * correct and ends the puzzle. A wrong move marks the puzzle failed and is shown on the
 * board (`wrong`) until `retry`.
 */
export function playUserMove(
  state: PuzzleState,
  uci: string,
): { state: PuzzleState; result: MoveResult } {
  if (state.phase !== 'user' || state.wrong) return { state, result: 'ignored' }
  const chess = new Chess(state.fen)
  const move = tryMove(chess, uci)
  if (!move) return { state, result: 'ignored' }

  const expected = tryMove(new Chess(state.fen), state.puzzle.moves[state.ply])
  const matches = expected !== null && expected.san === move.san
  if (matches || chess.isCheckmate()) {
    const ply = state.ply + 1
    const done = chess.isCheckmate() || ply >= state.puzzle.moves.length
    return {
      state: {
        ...state,
        fen: chess.fen(),
        ply,
        phase: done ? 'done' : 'opponent',
        lastMove: [move.from, move.to],
        sans: [...state.sans, move.san],
      },
      result: done ? 'solved' : 'correct',
    }
  }
  return {
    state: {
      ...state,
      failed: true,
      mistakes: state.mistakes + 1,
      wrong: { fen: chess.fen(), from: move.from, to: move.to },
    },
    result: 'wrong',
  }
}

/** Plays the opponent's next solution move. */
export function opponentReply(state: PuzzleState): PuzzleState {
  if (state.phase !== 'opponent') return state
  const chess = new Chess(state.fen)
  const move = tryMove(chess, state.puzzle.moves[state.ply])
  if (!move) throw new Error(`Puzzle ${state.puzzle.id}: illegal move at ply ${state.ply}.`)
  return {
    ...state,
    fen: chess.fen(),
    ply: state.ply + 1,
    phase: 'user',
    lastMove: [move.from, move.to],
    sans: [...state.sans, move.san],
  }
}

/** Takes back the wrong move on display so the user can try again. */
export function retry(state: PuzzleState): PuzzleState {
  if (!state.wrong) return state
  return { ...state, wrong: undefined }
}

/** The square of the piece to move (hint). Using it fails the puzzle. */
export function hint(state: PuzzleState): { state: PuzzleState; from?: string; to?: string } {
  if (state.phase !== 'user') return { state }
  const { from, to } = uciParts(state.puzzle.moves[state.ply])
  return { state: { ...state, hintUsed: true, failed: true, wrong: undefined }, from, to }
}

/** Plays out the rest of the solution. Fails the puzzle if it was still open. */
export function showSolution(state: PuzzleState): PuzzleState {
  if (state.phase === 'done') return state
  const chess = new Chess(state.fen)
  const sans = [...state.sans]
  let lastMove = state.lastMove
  for (let i = state.ply; i < state.puzzle.moves.length; i++) {
    const move = tryMove(chess, state.puzzle.moves[i])
    if (!move) break
    sans.push(move.san)
    lastMove = [move.from, move.to]
  }
  return {
    ...state,
    fen: chess.fen(),
    ply: state.puzzle.moves.length,
    phase: 'done',
    failed: true,
    solutionShown: true,
    wrong: undefined,
    lastMove,
    sans,
  }
}

/**
 * The rated outcome, once known: lost as soon as anything fails the puzzle, won when it
 * is finished clean. `undefined` while still open.
 */
export function ratedOutcome(state: PuzzleState): 'win' | 'loss' | undefined {
  if (state.failed) return 'loss'
  if (state.phase === 'done') return 'win'
  return undefined
}
