import { Chess } from 'chess.js'
import type { DrawShape } from 'chessground/draw'
import type { Key, SquareClasses } from 'chessground/types'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ARROW_BRUSH, type BoardProps, type PromotionPiece } from '../board'
import {
  createDrill,
  expectedMove,
  playOpponentMove,
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
export function useDrill(line: Line) {
  const [drill, setDrill] = useState<DrillState>(() => createDrill(line))
  const [wrong, setWrong] = useState<WrongMove | null>(null)
  const [animating, setAnimating] = useState(false)
  const [message, setMessage] = useState(() => startMessage(line))

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
  useEffect(() => {
    if (drill.status !== 'awaitingOpponent') return
    const id = setTimeout(() => {
      setDrill(playOpponentMove)
      setAnimating(true)
      later(() => setAnimating(false), ANIMATION_MS)
    }, OPPONENT_DELAY_MS)
    return () => clearTimeout(id)
  }, [drill.status, drill.ply, later])

  const onMove = useCallback(
    (from: Key, to: Key, promotion?: PromotionPiece) => {
      const input = { from, to, promotion }
      const { state, result } = submitMove(drill, input)
      if (result === 'correct') {
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
    setMessage(startMessage(line))
  }, [line])

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

  const userMoves = drill.steps.filter((s) => s.byUser).length
  const completed = drill.records.length

  const panel: SidePanelProps = {
    // Covers lines that end on either side's move.
    coachMessage: drill.status === 'complete' ? 'Line complete. Well played!' : message,
    prompt:
      drill.status === 'complete'
        ? 'Line complete.'
        : drill.status === 'awaitingOpponent'
          ? 'Opponent is replying…'
          : `Your move as ${sideName(line.side)}.`,
    challenge: Math.min(completed + 1, userMoves),
    challengeCount: userMoves,
    completed,
    onHint,
    hintDisabled: drill.status !== 'awaitingUser' || drill.hint === 'arrow' || locked,
  }

  return { drill, board, panel, restart }
}
