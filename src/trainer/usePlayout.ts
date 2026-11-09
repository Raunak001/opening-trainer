import type { Key } from 'chessground/types'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { BoardProps, PromotionPiece } from '../board'
import { SearchCancelledError, type Engine, type Explanation } from '../engine'
import type { Side } from './drill'
import type { MoveExplainer } from './explainer'
import {
  createPlayout,
  playEngineMove,
  playoutSummary,
  playUserMove,
  setGrade,
  userMovesPlayed,
  type PlayoutState,
} from './playout'
import type { SidePanelProps } from './SidePanel'
import { OPPONENT_DELAY_MS } from './useDrill'

export interface PlayoutOptions {
  /** Position where the drilled line ended. */
  fen: string
  userSide: Side
  /** Start of the drilled line and its SAN moves, for the opening-principle rules. */
  lineStartFen: string
  lineMoves: readonly string[]
  userMoves: number
  /** Weakened engine that plays the other side. */
  opponent: Engine
  /** Search depth for the opponent. */
  depth: number
  /** Full-strength grading of the user's moves. */
  explain: MoveExplainer
}

function article(label: string): string {
  return /^[aeiou]/.test(label) ? 'an' : 'a'
}

/** Coach text for a graded play-out move. Nothing to hide here, so the best move is named. */
export function playoutFeedback(san: string, explanation: Explanation): string {
  if (explanation.grade === 'good' || explanation.grade === 'book') return `${san} is a good move.`
  return [
    `${san} is ${article(explanation.label)} ${explanation.label}.`,
    explanation.reason,
    explanation.best,
  ]
    .filter(Boolean)
    .join(' ')
}

const sideName = (side: Side) => (side === 'white' ? 'White' : 'Black')

export function usePlayout(options: PlayoutOptions) {
  const { fen, userSide, lineStartFen, lineMoves, userMoves, opponent, depth, explain } = options
  const [state, setState] = useState<PlayoutState>(() => createPlayout(fen, userSide, userMoves))
  const [message, setMessage] = useState(
    `Out of book. Play ${userMoves} moves against Stockfish; each one is graded.`,
  )
  const [error, setError] = useState<string>()
  // Grading runs one move at a time so searches on the shared engine never cancel each other.
  const gradingChain = useRef<Promise<unknown>>(Promise.resolve())

  // Opponent reply: search, then play after a short pause so the user's move is seen.
  useEffect(() => {
    if (state.status !== 'awaitingEngine') return
    let live = true
    const started = Date.now()
    opponent
      .search(state.fen, { depth })
      .then((result) => {
        if (!live || !result.bestMove) return
        const move = result.bestMove
        const wait = Math.max(0, OPPONENT_DELAY_MS - (Date.now() - started))
        setTimeout(() => live && setState((s) => playEngineMove(s, move)), wait)
      })
      .catch((err: unknown) => {
        if (live && !(err instanceof SearchCancelledError)) setError(String(err))
      })
    return () => {
      live = false
    }
  }, [state.status, state.fen, opponent, depth])

  const onMove = useCallback(
    (from: Key, to: Key, promotion?: PromotionPiece) => {
      const next = playUserMove(state, { from, to, promotion })
      if (next === state) return
      setState(next)
      const index = next.moves.length - 1
      const move = next.moves[index]
      const previous = [...lineMoves, ...state.moves.map((m) => m.san)]
      gradingChain.current = gradingChain.current
        .then(() =>
          explain({
            fen: move.fenBefore,
            move: { from, to, promotion },
            startFen: lineStartFen,
            previous,
          }),
        )
        .then((explanation) => {
          if (!explanation) return
          setState((s) => setGrade(s, index, explanation.grade))
          setMessage(playoutFeedback(move.san, explanation))
        })
        .catch(() => {
          // Grading is best effort; the game goes on.
        })
    },
    [state, explain, lineMoves, lineStartFen],
  )

  const last = state.moves[state.moves.length - 1]
  const played = userMovesPlayed(state)
  const complete = state.status === 'complete'

  const board: BoardProps = {
    fen: state.fen,
    orientation: userSide,
    lastMove: last ? [last.from, last.to] : undefined,
    interactive: state.status === 'awaitingUser',
    onMove,
  }

  const panel: SidePanelProps = {
    coachMessage: error ? `Stockfish stopped: ${error}` : message,
    prompt: complete
      ? playoutSummary(state)
      : state.status === 'awaitingEngine'
        ? 'Stockfish is thinking…'
        : `Your move as ${sideName(userSide)}.`,
    challenge: Math.min(played + 1, userMoves),
    challengeCount: userMoves,
    completed: played,
    hintDisabled: true,
  }

  return { state, board, panel }
}
