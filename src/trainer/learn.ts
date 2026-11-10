import { Chess, type Square } from 'chess.js'
import { State, type Grade } from 'ts-fsrs'
import { nodeId, type AppSettings, type CardRow, type ReviewDetails, type TrainerDB } from '../db'
// Direct module imports: the repertoire index also re-exports React pages.
import { lineCards, type CourseLine } from '../repertoire/lines'
import { positionKey, type PositionKey } from '../repertoire/positionKey'
import { autoGrade } from '../srs/grading'
import { reviewCard } from '../srs/scheduler'
import {
  MISSES_FOR_ARROW,
  type HintLevel,
  type MoveInput,
  type MoveResult,
  type Side,
} from './drill'

/**
 * Learn mode (T7.6a): a line is first shown, then played back.
 *
 * show: both sides' moves play one at a time (the UI steps automatically;
 * ‹ › step by hand). Before each of your moves its arrow is drawn first.
 * Moves already learned in an earlier line (the shared prefix) are flagged
 * `fast`: the UI plays them quickly and without arrows.
 *
 * play: from the start, you play your moves and the opponent's are played for
 * you. Your moves that are new in this line get the arrow from the first try;
 * known ones do not (a hint or two misses bring it, as in drills). Wrong moves
 * snap back.
 */
export type LearnPhase = 'show' | 'play' | 'complete'

export interface LearnStep {
  san: string
  from: Square
  to: Square
  promotion?: string
  fenBefore: string
  fenAfter: string
  /** Position key before the move: the card's position for your moves. */
  key: PositionKey
  byUser: boolean
  /** Your move whose card is still new: shown with an arrow and reviewed on completion. */
  isNew: boolean
}

/** How one of your moves went in the play phase. */
export interface LearnRecord {
  ply: number
  misses: number
  /** Hint button pressed (the learn arrow on new moves does not count). */
  hintRequested: boolean
  /** The arrow was shown from the start because the move was new. */
  guided: boolean
  /** From the board unlocking to the right move, when the UI measured it. */
  durationMs?: number
}

export interface LearnState {
  side: Side
  steps: readonly LearnStep[]
  /** Leading plies already learned in earlier lines: fast-played in the show phase. */
  prefix: number
  phase: LearnPhase
  /** Index of the next move. The board shows `steps[ply].fenBefore` (or the end). */
  ply: number
  /** Show phase: the arrow for your next move is drawn, the move not yet played. */
  arrowShown: boolean
  /** Play phase: wrong tries at the current move. */
  misses: number
  /** Play phase: hint level for the current move. */
  hint: HintLevel
  hintRequested: boolean
  records: readonly LearnRecord[]
}

export interface LearnLine {
  side: Side
  moves: readonly string[]
  startFen?: string
}

/**
 * Plies before your first new move that are already known: everything up to
 * and including your last learned move before it. The opponent move that
 * leads into new ground is shown, not skipped. If none of your moves are new
 * (relearning a learned line), nothing is skipped.
 */
export function knownPrefix(steps: readonly Pick<LearnStep, 'byUser' | 'isNew'>[]): number {
  const firstNew = steps.findIndex((s) => s.byUser && s.isNew)
  if (firstNew < 0) return 0
  for (let i = firstNew - 1; i >= 0; i--) if (steps[i].byUser) return i + 1
  return 0
}

/**
 * Starts Learn mode on a line. `newCards`: positions of your moves whose card
 * has never been studied. Throws if a move is illegal.
 */
export function createLearn(line: LearnLine, newCards: ReadonlySet<PositionKey>): LearnState {
  const chess = new Chess(line.startFen)
  const steps: LearnStep[] = line.moves.map((san, i) => {
    const fenBefore = chess.fen()
    const byUser = (chess.turn() === 'w') === (line.side === 'white')
    let move
    try {
      move = chess.move(san)
    } catch {
      throw new Error(`Learn: illegal move ${san} at ply ${i}`)
    }
    const key = positionKey(fenBefore)
    return {
      san: move.san,
      from: move.from,
      to: move.to,
      promotion: move.promotion,
      fenBefore,
      fenAfter: chess.fen(),
      key,
      byUser,
      isNew: byUser && newCards.has(key),
    }
  })
  return {
    side: line.side,
    steps,
    prefix: knownPrefix(steps),
    phase: 'show',
    ply: 0,
    arrowShown: false,
    misses: 0,
    hint: 'none',
    hintRequested: false,
    records: [],
  }
}

/** The board position: before the next move, or the final one. */
export function learnFen(state: LearnState): string {
  const { steps, ply } = state
  if (steps.length === 0) return new Chess().fen()
  return ply < steps.length ? steps[ply].fenBefore : steps[steps.length - 1].fenAfter
}

/** The move just played (for last-move highlighting), if any. */
export function lastLearnMove(state: LearnState): LearnStep | undefined {
  return state.ply > 0 ? state.steps[state.ply - 1] : undefined
}

/** Whether the show phase is in the shared prefix (to be played fast). */
export function isFast(state: LearnState): boolean {
  return state.phase === 'show' && state.ply < state.prefix
}

/** Show phase: every move has been shown. */
export function showDone(state: LearnState): boolean {
  return state.phase === 'show' && state.ply >= state.steps.length
}

/**
 * Show phase, one step forward: draws the arrow for your next move (outside
 * the prefix), or plays the next move. No-op at the end.
 */
export function showNext(state: LearnState): LearnState {
  if (state.phase !== 'show' || state.ply >= state.steps.length) return state
  const step = state.steps[state.ply]
  if (step.byUser && !state.arrowShown && state.ply >= state.prefix)
    return { ...state, arrowShown: true }
  return { ...state, ply: state.ply + 1, arrowShown: false }
}

/** Show phase, one move back (an arrow being shown is taken back first). */
export function showBack(state: LearnState): LearnState {
  if (state.phase !== 'show') return state
  if (state.arrowShown) return { ...state, arrowShown: false }
  if (state.ply === 0) return state
  return { ...state, ply: state.ply - 1, arrowShown: false }
}

function playStatus(state: LearnState): LearnState {
  if (state.ply >= state.steps.length) return { ...state, phase: 'complete' }
  const step = state.steps[state.ply]
  return {
    ...state,
    misses: 0,
    hintRequested: false,
    hint: step.byUser && step.isNew ? 'arrow' : 'none',
  }
}

/** Ends the show phase (allowed at any point) and starts the play phase from move one. */
export function startPlay(state: LearnState): LearnState {
  if (state.phase !== 'show') return state
  return playStatus({ ...state, phase: 'play', ply: 0, arrowShown: false, records: [] })
}

export type LearnTurn = 'user' | 'opponent' | undefined

/** Play phase: whose move is next (undefined outside the play phase). */
export function learnTurn(state: LearnState): LearnTurn {
  if (state.phase !== 'play') return undefined
  return state.steps[state.ply].byUser ? 'user' : 'opponent'
}

/** Play phase: plays the opponent's next move. No-op when it is your move. */
export function playLearnOpponent(state: LearnState): LearnState {
  if (learnTurn(state) !== 'opponent') return state
  return playStatus({ ...state, ply: state.ply + 1 })
}

/** Play phase: checks your move. Wrong and illegal moves leave the position as is. */
export function submitLearnMove(
  state: LearnState,
  input: MoveInput,
  durationMs?: number,
): { state: LearnState; result: MoveResult } {
  if (learnTurn(state) !== 'user') return { state, result: 'ignored' }
  const step = state.steps[state.ply]
  let san: string
  try {
    san = new Chess(step.fenBefore).move(input).san
  } catch {
    return { state, result: 'illegal' }
  }
  if (san !== step.san) {
    const misses = state.misses + 1
    return {
      state: { ...state, misses, hint: misses >= MISSES_FOR_ARROW ? 'arrow' : state.hint },
      result: 'wrong',
    }
  }
  const record: LearnRecord = {
    ply: state.ply,
    misses: state.misses,
    hintRequested: state.hintRequested,
    guided: step.isNew,
    durationMs,
  }
  return {
    state: playStatus({ ...state, ply: state.ply + 1, records: [...state.records, record] }),
    result: 'correct',
  }
}

/** Play phase: raises the hint one level for your current move. */
export function requestLearnHint(state: LearnState): LearnState {
  if (learnTurn(state) !== 'user' || state.hint === 'arrow') return state
  return { ...state, hint: state.hint === 'none' ? 'piece' : 'arrow', hintRequested: true }
}

/** The arrow to draw now, if any: the show-phase arrow or the play-phase hint. */
export function learnArrow(state: LearnState): LearnStep | undefined {
  if (state.phase === 'show') return state.arrowShown ? state.steps[state.ply] : undefined
  if (learnTurn(state) === 'user' && state.hint === 'arrow') return state.steps[state.ply]
  return undefined
}

/** The square to ring as a piece hint, if any. */
export function learnHintSquare(state: LearnState): Square | undefined {
  return learnTurn(state) === 'user' && state.hint === 'piece'
    ? state.steps[state.ply].from
    : undefined
}

/** One first review to record when a line is learned. */
export interface LearnReview {
  positionKey: PositionKey
  rating: Grade
  details: ReviewDetails
}

/**
 * The first FSRS review for each new card of a completed line, graded as in
 * Review (wrong → Again, hint → Hard, otherwise by time). Moves played with
 * the learn arrow are not timed: following an arrow fast is not recall, so
 * they grade Good at best.
 */
export function learnReviews(state: LearnState, grading: AppSettings['grading']): LearnReview[] {
  if (state.phase !== 'complete') return []
  const reviews: LearnReview[] = []
  for (const r of state.records) {
    const step = state.steps[r.ply]
    if (!step.isNew) continue
    const durationMs = r.guided ? Number.NaN : (r.durationMs ?? Number.NaN)
    const { rating } = autoGrade(
      { mistakes: r.misses, hintUsed: r.hintRequested, durationMs },
      grading,
    )
    reviews.push({
      positionKey: step.key,
      rating,
      details: {
        mistakes: r.misses,
        hintUsed: r.hintRequested,
        ...(r.durationMs !== undefined && { durationMs: r.durationMs }),
      },
    })
  }
  return reviews
}

/** New cards on a line. */
export function newCardCount(state: Pick<LearnState, 'steps'>): number {
  return new Set(state.steps.filter((s) => s.isNew).map((s) => s.key)).size
}

/** The next line to learn, or none when every line is learned. */
export type NextLine = { line: CourseLine; newCards: number } | { line: undefined }

/**
 * The next line to learn: the most frequent line that still has new cards.
 * `lines` must be in frequency order (as `enumerateLines` returns them).
 */
export function nextLineToLearn(
  lines: readonly CourseLine[],
  cards: ReadonlyMap<PositionKey, CardRow>,
): NextLine {
  for (const line of lines) {
    const fresh = lineCards(line, cards).filter((c) => c.state === State.New).length
    if (fresh > 0) return { line, newCards: fresh }
  }
  return { line: undefined }
}

/** Records the first review of each new card of a learned line. */
export async function saveLearnedLine(
  db: TrainerDB,
  repertoireId: string,
  reviews: readonly LearnReview[],
  now: Date = new Date(),
): Promise<void> {
  for (const r of reviews)
    await reviewCard(db, nodeId(repertoireId, r.positionKey), r.rating, now, r.details)
}
