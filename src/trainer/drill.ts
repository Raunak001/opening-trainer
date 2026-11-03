import { Chess, type Square } from 'chess.js'

export type Side = 'white' | 'black'

/** A line to drill: SAN moves from a start position, played by both sides. */
export interface Line {
  id: string
  name: string
  /** The side the user plays. */
  side: Side
  /** Moves in SAN, alternating sides, starting with the side to move in `startFen`. */
  moves: string[]
  /** Defaults to the standard start position. */
  startFen?: string
}

/** One move of the line, resolved once with chess.js. */
export interface Step {
  san: string
  from: Square
  to: Square
  promotion?: string
  fenBefore: string
  fenAfter: string
  /** True when it is the user's move. */
  byUser: boolean
}

export interface MoveInput {
  from: string
  to: string
  promotion?: string
}

/**
 * none: no hint shown. piece: highlight the piece to move. arrow: show the full move.
 * Requests escalate one level at a time; a second miss jumps straight to arrow.
 */
export type HintLevel = 'none' | 'piece' | 'arrow'

export type DrillStatus = 'awaitingUser' | 'awaitingOpponent' | 'complete'

/** Outcome of one user move, for grading later. */
export interface MoveRecord {
  ply: number
  misses: number
  hintUsed: boolean
}

export interface DrillState {
  line: Line
  steps: readonly Step[]
  /** Index of the next move to play. */
  ply: number
  /** Position before `steps[ply]`, or the final position when complete. */
  fen: string
  status: DrillStatus
  /** Wrong attempts at the current user move. */
  misses: number
  hint: HintLevel
  /** The last move played on the board, for highlighting. */
  lastMove?: { from: Square; to: Square }
  records: readonly MoveRecord[]
}

export type MoveResult = 'correct' | 'wrong' | 'illegal' | 'ignored'

/** Misses on one move before the hint arrow appears. */
export const MISSES_FOR_ARROW = 2

const DEFAULT_FEN = new Chess().fen()

/** Resolves a line's SAN moves into steps. Throws if any move is illegal. */
export function resolveLine(line: Line): Step[] {
  const chess = new Chess(line.startFen ?? DEFAULT_FEN)
  return line.moves.map((san, i) => {
    const fenBefore = chess.fen()
    const byUser = (chess.turn() === 'w') === (line.side === 'white')
    let move
    try {
      move = chess.move(san)
    } catch {
      throw new Error(`Line ${line.id}: illegal move ${san} at ply ${i}`)
    }
    return {
      san: move.san,
      from: move.from,
      to: move.to,
      promotion: move.promotion,
      fenBefore,
      fenAfter: chess.fen(),
      byUser,
    }
  })
}

function statusAt(steps: readonly Step[], ply: number): DrillStatus {
  if (ply >= steps.length) return 'complete'
  return steps[ply].byUser ? 'awaitingUser' : 'awaitingOpponent'
}

/** Moves past `ply`: resets per-move state and sets the next status. */
function advance(state: DrillState): DrillState {
  const step = state.steps[state.ply]
  const ply = state.ply + 1
  return {
    ...state,
    ply,
    fen: step.fenAfter,
    status: statusAt(state.steps, ply),
    misses: 0,
    hint: 'none',
    lastMove: { from: step.from, to: step.to },
  }
}

export function createDrill(line: Line): DrillState {
  const steps = resolveLine(line)
  return {
    line,
    steps,
    ply: 0,
    fen: line.startFen ?? DEFAULT_FEN,
    status: statusAt(steps, 0),
    misses: 0,
    hint: 'none',
    records: [],
  }
}

/** The move the user is expected to play now, or undefined if it is not their turn. */
export function expectedMove(state: DrillState): Step | undefined {
  return state.status === 'awaitingUser' ? state.steps[state.ply] : undefined
}

/** Checks the user's move against the line. Wrong and illegal moves leave the position as is. */
export function submitMove(
  state: DrillState,
  input: MoveInput,
): { state: DrillState; result: MoveResult } {
  const step = expectedMove(state)
  if (!step) return { state, result: 'ignored' }

  let san: string
  try {
    san = new Chess(state.fen).move(input).san
  } catch {
    return { state, result: 'illegal' }
  }

  if (san !== step.san) {
    const misses = state.misses + 1
    const hint = misses >= MISSES_FOR_ARROW ? 'arrow' : state.hint
    return { state: { ...state, misses, hint }, result: 'wrong' }
  }

  const record: MoveRecord = {
    ply: state.ply,
    misses: state.misses,
    hintUsed: state.hint !== 'none',
  }
  return {
    state: advance({ ...state, records: [...state.records, record] }),
    result: 'correct',
  }
}

/** Plays the opponent's reply from the line. No-op unless it is the opponent's turn. */
export function playOpponentMove(state: DrillState): DrillState {
  return state.status === 'awaitingOpponent' ? advance(state) : state
}

/** Raises the hint one level for the current user move. */
export function requestHint(state: DrillState): DrillState {
  if (state.status !== 'awaitingUser') return state
  const hint: HintLevel = state.hint === 'none' ? 'piece' : 'arrow'
  return { ...state, hint }
}
