import type { DrawShape } from 'chessground/draw'
import type { Key, SquareClasses } from 'chessground/types'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ARROW_BRUSH, Board, type PromotionPiece } from '../board'
import { getDb, type PuzzleAttemptRow, type PuzzleRow, type TrainerDB } from '../db'
import { MoveList } from '../trainer/MoveList'
import { TrainerLayout } from '../trainer/TrainerLayout'
import {
  hint as takeHint,
  opponentReply,
  playUserMove,
  ratedOutcome,
  retry,
  showSolution,
  startPuzzle,
  userColor,
  type MoveResult,
  type PuzzleState,
} from './solution'
import { themeLabel } from './stats'
import { ensurePuzzles, loadAttempts, nextPuzzle, recordAttempt } from './store'
import { currentRating } from './stats'

/** Pause before the opponent's reply, so the user sees their move land. */
const REPLY_DELAY_MS = 450

type Load =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'empty' }
  | { kind: 'ready'; puzzle: PuzzleRow; key: number }

export interface PuzzleSolverProps {
  db?: TrainerDB
}

/** Rated puzzles, one after another, picked near the user's rating. */
export function PuzzleSolver({ db = getDb() }: PuzzleSolverProps) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  const [rating, setRating] = useState<number>()
  const counter = useRef(0)

  const next = useCallback(async () => {
    setLoad({ kind: 'loading' })
    try {
      await ensurePuzzles(db)
      const [puzzle, attempts] = await Promise.all([nextPuzzle(db), loadAttempts(db)])
      setRating(currentRating(attempts).rating)
      setLoad(puzzle ? { kind: 'ready', puzzle, key: ++counter.current } : { kind: 'empty' })
    } catch (error) {
      setLoad({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }, [db])

  useEffect(() => {
    // Loading on mount is the effect's purpose; state is set once the db answers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void next()
  }, [next])

  if (load.kind !== 'ready')
    return (
      <div className="puzzles__message" role="status">
        {load.kind === 'loading' && 'Loading puzzle…'}
        {load.kind === 'error' && `Could not load puzzles: ${load.message}`}
        {load.kind === 'empty' && 'No puzzles available.'}
      </div>
    )

  return (
    <PuzzleView
      key={load.key}
      db={db}
      puzzle={load.puzzle}
      rating={rating ?? 1000}
      onRated={(row) => setRating(row.ratingAfter)}
      onNext={() => void next()}
    />
  )
}

type Feedback = { kind: 'none' } | { kind: 'correct' } | { kind: 'wrong' } | { kind: 'hint' }

interface PuzzleViewProps {
  db: TrainerDB
  puzzle: PuzzleRow
  rating: number
  onRated: (row: PuzzleAttemptRow) => void
  onNext: () => void
}

function PuzzleView({ db, puzzle, rating, onRated, onNext }: PuzzleViewProps) {
  const [state, setState] = useState<PuzzleState>(() => startPuzzle(puzzle))
  const [feedback, setFeedback] = useState<Feedback>({ kind: 'none' })
  const [hintSquares, setHintSquares] = useState<{ from: string; to: string; arrow: boolean }>()
  const [attempt, setAttempt] = useState<PuzzleAttemptRow>()
  const [saveError, setSaveError] = useState<string>()
  const [startedAt] = useState(() => Date.now())
  const recording = useRef(false)
  const color = userColor(puzzle)

  // Opponent replies after a correct move.
  useEffect(() => {
    if (state.phase !== 'opponent') return
    const t = setTimeout(() => setState((s) => opponentReply(s)), REPLY_DELAY_MS)
    return () => clearTimeout(t)
  }, [state.phase, state.ply])

  // Record the rated result the first time it is known.
  const outcome = ratedOutcome(state)
  useEffect(() => {
    if (!outcome || recording.current) return
    recording.current = true
    recordAttempt(db, {
      puzzle,
      solved: outcome === 'win',
      hintUsed: state.hintUsed,
      mistakes: state.mistakes,
      durationMs: Date.now() - startedAt,
    })
      .then((row) => {
        setAttempt(row)
        onRated(row)
      })
      .catch((error: unknown) => setSaveError(String(error)))
  }, [outcome, db, puzzle, state.hintUsed, state.mistakes, onRated, startedAt])

  const handleMove = (orig: Key, dest: Key, promotion?: PromotionPiece) => {
    const { state: nextState, result } = playUserMove(state, `${orig}${dest}${promotion ?? ''}`)
    if (result === 'ignored') return
    setState(nextState)
    setHintSquares(undefined)
    setFeedback(feedbackFor(result))
  }

  const handleHint = () => {
    const { state: hinted, from, to } = takeHint(state)
    if (!from || !to) return
    setState(hinted)
    setFeedback({ kind: 'hint' })
    // First press: the piece to move. Second press: the whole move.
    setHintSquares((prev) => ({ from, to, arrow: prev !== undefined }))
  }

  const done = state.phase === 'done'
  const boardFen = state.wrong?.fen ?? state.fen
  const lastMove = (state.wrong ? [state.wrong.from, state.wrong.to] : state.lastMove) as
    [Key, Key] | undefined
  const squareClasses: SquareClasses = new Map()
  if (state.wrong) squareClasses.set(state.wrong.to as Key, 'wrong')
  if (hintSquares && !hintSquares.arrow) squareClasses.set(hintSquares.from as Key, 'hint')
  const shapes: DrawShape[] = hintSquares?.arrow
    ? [{ orig: hintSquares.from as Key, dest: hintSquares.to as Key, brush: ARROW_BRUSH }]
    : []

  const delta = attempt ? Math.round(attempt.ratingAfter) - Math.round(attempt.ratingBefore) : 0
  const side = color === 'white' ? 'White' : 'Black'

  let status: { tone: 'neutral' | 'good' | 'bad'; title: string; detail?: string }
  if (done && !state.failed) status = { tone: 'good', title: 'Solved!', detail: 'Well played.' }
  else if (done && state.solutionShown)
    status = { tone: 'bad', title: 'Solution shown', detail: 'Try the next one.' }
  else if (done)
    status = { tone: 'good', title: 'Completed', detail: 'Solved after a retry or hint.' }
  else if (state.wrong)
    status = { tone: 'bad', title: 'Incorrect', detail: 'That is not the best move.' }
  else if (feedback.kind === 'correct')
    status = { tone: 'good', title: 'Best move!', detail: 'Keep going.' }
  else if (feedback.kind === 'hint')
    status = {
      tone: 'neutral',
      title: 'Hint',
      detail: hintSquares?.arrow ? 'Play the arrow.' : 'Move the highlighted piece.',
    }
  else status = { tone: 'neutral', title: `${side} to move`, detail: 'Find the best move.' }

  return (
    <TrainerLayout className="puzzles__layout">
      <Board
        fen={boardFen}
        orientation={color}
        onMove={handleMove}
        lastMove={lastMove}
        interactive={state.phase === 'user' && !state.wrong}
        squareClasses={squareClasses}
        shapes={shapes}
      />
      <aside className="side-panel puzzle-panel" aria-label="Puzzle panel">
        <header className="puzzle-panel__header">
          <span className="puzzle-panel__title">Puzzles</span>
          <span className="puzzle-panel__rating" aria-label="Your puzzle rating">
            {Math.round(attempt ? attempt.ratingAfter : rating)}
            {attempt && (
              <span
                className={`puzzle-panel__delta puzzle-panel__delta--${delta >= 0 ? 'up' : 'down'}`}
              >
                {delta >= 0 ? `+${delta}` : `${delta}`}
              </span>
            )}
          </span>
        </header>

        <div className={`puzzle-panel__status puzzle-panel__status--${status.tone}`} role="status">
          {!done && !state.wrong && feedback.kind === 'none' && (
            <span className={`puzzle-panel__swatch puzzle-panel__swatch--${color}`} aria-hidden />
          )}
          <div>
            <p className="puzzle-panel__status-title">{status.title}</p>
            {status.detail && <p className="puzzle-panel__status-detail">{status.detail}</p>}
          </div>
        </div>

        {outcome && (
          <p className="puzzle-panel__info">
            Puzzle rated {puzzle.rating}
            {done && puzzle.themes.length > 0 && (
              <>
                {' · '}
                {puzzle.themes
                  .filter((t) => !['short', 'long', 'veryLong', 'oneMove'].includes(t))
                  .slice(0, 4)
                  .map(themeLabel)
                  .join(', ')}
              </>
            )}
          </p>
        )}
        {saveError && <p className="puzzle-panel__info">Could not save: {saveError}</p>}

        <MoveList moves={state.sans} startFen={puzzle.fen} />

        <footer className="puzzle-panel__footer">
          {state.wrong ? (
            <button
              type="button"
              className="puzzle-panel__primary"
              onClick={() => {
                setState(retry(state))
                setFeedback({ kind: 'none' })
              }}
            >
              Retry
            </button>
          ) : done ? (
            <button type="button" className="puzzle-panel__primary" onClick={onNext}>
              Next puzzle
            </button>
          ) : (
            <button type="button" onClick={handleHint} disabled={state.phase !== 'user'}>
              Hint
            </button>
          )}
          {!done && (
            <button
              type="button"
              onClick={() => {
                setState(showSolution(state))
                setHintSquares(undefined)
              }}
            >
              Solution
            </button>
          )}
          {!done && outcome && (
            <button type="button" onClick={onNext}>
              Next puzzle
            </button>
          )}
        </footer>
      </aside>
    </TrainerLayout>
  )
}

function feedbackFor(result: MoveResult): Feedback {
  if (result === 'wrong') return { kind: 'wrong' }
  if (result === 'correct' || result === 'solved') return { kind: 'correct' }
  return { kind: 'none' }
}
