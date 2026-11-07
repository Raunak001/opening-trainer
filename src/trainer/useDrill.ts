import { Chess } from 'chess.js'
import type { DrawShape } from 'chessground/draw'
import type { Key, SquareClasses } from 'chessground/types'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ARROW_BRUSH, type BoardProps, type PromotionPiece } from '../board'
import {
  createDrill,
  expectedMove,
  playOpponentMove,
  promptedMoveCount,
  requestHint,
  submitMove,
  type DrillState,
  type Line,
} from './drill'
import type { SidePanelProps } from './SidePanel'

/** Pause before the opponent replies, so the user sees their own move land. */
export const OPPONENT_DELAY_MS = 500
/** How long a wrong move stays on the board, flashing red, before snapping back. */
export const WRONG_FLASH_MS = 450
/** chessground's default move animation; input stays locked until it finishes. */
export const ANIMATION_MS = 200
/** Pause between automatic context moves: fast, but each move is still visible. */
export const REPLAY_DELAY_MS = 250

/** How the user did on the line's prompted moves, for grading. */
export interface DrillOutcome {
  /** Wrong moves over all prompted moves. */
  mistakes: number
  hintUsed: boolean
  /** Thinking time: from each prompt (board unlocked) to the correct move, summed. */
  durationMs: number
}

export interface DrillOptions {
  /** Called once when the line is complete. */
  onComplete?: (outcome: DrillOutcome) => void
  /** Coach bubble text before the first move (default: "Let's drill the …"). */
  intro?: string
}

interface WrongMove {
  fen: string
  from: Key
  to: Key
}

const NO_SHAPES: DrawShape[] = []
const NO_CLASSES: SquareClasses = new Map()

function sideName(side: Line['side']) {
  return side === 'white' ? 'White' : 'Black'
}

function startMessage(line: Line) {
  return `Let's drill the ${line.name}. You play ${sideName(line.side)}.`
}

/** Drives a drill: wires the pure state machine to the board and side panel. */
export function useDrill(line: Line, options: DrillOptions = {}) {
  const { onComplete, intro } = options
  const [drill, setDrill] = useState<DrillState>(() => createDrill(line))
  const [wrong, setWrong] = useState<WrongMove | null>(null)
  const [animating, setAnimating] = useState(false)
  const [message, setMessage] = useState(() => intro ?? startMessage(line))
  // Thinking-time clock: started when the board unlocks for a prompt.
  const promptStart = useRef<number | null>(null)
  const thinkingMs = useRef(0)
  const completed = useRef(false)
  const onCompleteRef = useRef(onComplete)
  useEffect(() => {
    onCompleteRef.current = onComplete
  })

  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  const later = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      timers.current.delete(id)
      fn()
    }, ms)
    timers.current.add(id)
  }, [])

  useEffect(() => {
    const pending = timers.current
    return () => {
      pending.forEach(clearTimeout)
      pending.clear()
    }
  }, [])

  // Opponent auto-reply, after a pause. Also covers the first move when the user plays Black.
  // Context moves (line-context playback) use the same path, faster.
  useEffect(() => {
    if (drill.status !== 'awaitingOpponent' && drill.status !== 'replaying') return
    const delay = drill.status === 'replaying' ? REPLAY_DELAY_MS : OPPONENT_DELAY_MS
    const id = setTimeout(() => {
      setDrill(playOpponentMove)
      setAnimating(true)
      later(() => setAnimating(false), ANIMATION_MS)
    }, delay)
    return () => clearTimeout(id)
  }, [drill.status, drill.ply, later])

  // Start the clock when a prompt becomes playable.
  useEffect(() => {
    if (drill.status === 'awaitingUser' && !animating && promptStart.current === null)
      promptStart.current = Date.now()
  }, [drill.status, drill.ply, animating])

  // Report the outcome once, when the line is done.
  useEffect(() => {
    if (drill.status !== 'complete' || completed.current) return
    completed.current = true
    onCompleteRef.current?.({
      mistakes: drill.records.reduce((n, r) => n + r.misses, 0),
      hintUsed: drill.records.some((r) => r.hintUsed),
      durationMs: thinkingMs.current,
    })
  }, [drill.status, drill.records])

  const onMove = useCallback(
    (from: Key, to: Key, promotion?: PromotionPiece) => {
      const input = { from, to, promotion }
      const { state, result } = submitMove(drill, input)
      if (result === 'correct') {
        if (promptStart.current !== null) thinkingMs.current += Date.now() - promptStart.current
        promptStart.current = null
        setDrill(state)
        const san = drill.steps[drill.ply].san
        setMessage(`${san} is correct!`)
      } else if (result === 'wrong') {
        // Keep the wrong move on the board briefly, then snap back.
        setWrong({ fen: new Chess(drill.fen).move(input).after, from, to })
        setDrill(state)
        setMessage(
          state.hint === 'arrow' ? 'Not that one. Follow the arrow.' : 'Not quite. Try again.',
        )
        later(() => {
          setWrong(null)
          setAnimating(true)
          later(() => setAnimating(false), ANIMATION_MS)
        }, WRONG_FLASH_MS)
      }
    },
    [drill, later],
  )

  const onHint = useCallback(() => {
    const next = requestHint(drill)
    setDrill(next)
    setMessage(next.hint === 'arrow' ? 'Play the move shown by the arrow.' : 'Move this piece.')
  }, [drill])

  const restart = useCallback(() => {
    timers.current.forEach(clearTimeout)
    timers.current.clear()
    setDrill(createDrill(line))
    setWrong(null)
    setAnimating(false)
    setMessage(intro ?? startMessage(line))
    promptStart.current = null
    thinkingMs.current = 0
    completed.current = false
  }, [line, intro])

  const step = expectedMove(drill)
  const hintFrom = step && drill.hint !== 'none' ? step.from : undefined
  const arrow = step && drill.hint === 'arrow' ? step : undefined

  const shapes = useMemo<DrawShape[]>(
    () => (arrow ? [{ orig: arrow.from, dest: arrow.to, brush: ARROW_BRUSH }] : NO_SHAPES),
    [arrow],
  )

  const squareClasses = useMemo<SquareClasses>(() => {
    if (wrong) return new Map([[wrong.to, 'wrong']])
    if (hintFrom) return new Map([[hintFrom, 'hint']])
    return NO_CLASSES
  }, [wrong, hintFrom])

  const lastMove = useMemo<[Key, Key] | undefined>(() => {
    if (wrong) return [wrong.from, wrong.to]
    return drill.lastMove ? [drill.lastMove.from, drill.lastMove.to] : undefined
  }, [wrong, drill.lastMove])

  const locked = drill.status !== 'awaitingUser' || wrong !== null || animating

  const board: BoardProps = {
    fen: wrong ? wrong.fen : drill.fen,
    orientation: line.side,
    lastMove,
    shapes,
    squareClasses,
    interactive: !locked,
    onMove,
  }

  const userMoves = promptedMoveCount(drill)
  const answered = drill.records.length

  const panel: SidePanelProps = {
    // Covers lines that end on either side's move.
    coachMessage: drill.status === 'complete' ? 'Line complete. Well played!' : message,
    prompt:
      drill.status === 'complete'
        ? 'Line complete.'
        : drill.status === 'replaying'
          ? 'Playing the moves that lead here…'
          : drill.status === 'awaitingOpponent'
            ? 'Opponent is replying…'
            : `Your move as ${sideName(line.side)}.`,
    challenge: Math.min(answered + 1, userMoves),
    challengeCount: userMoves,
    completed: answered,
    onHint,
    hintDisabled: drill.status !== 'awaitingUser' || drill.hint === 'arrow' || locked,
  }

  return { drill, board, panel, restart }
}
