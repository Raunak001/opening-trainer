import { Chess } from 'chess.js'
import type { DrawShape } from 'chessground/draw'
import type { Key, SquareClasses } from 'chessground/types'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ARROW_BRUSH, type BoardProps, type PromotionPiece } from '../board'
import type { SidePanelProps } from '../trainer/SidePanel'
import { ANIMATION_MS, WRONG_FLASH_MS, type DrillOutcome } from '../trainer/useDrill'
import {
  createAttempt,
  hintsExhausted,
  hintUsed,
  mainAnswer,
  requestLessonHint,
  submitLessonMove,
  type LessonAttempt,
} from './attempt'
import { conceptLabel, lessonSide, type Lesson } from './lesson'

export interface LessonOptions {
  /** Called once, when the lesson is solved. */
  onSolved?: (outcome: DrillOutcome) => void
  /** Coach bubble before the first move (default: names the concept). */
  intro?: string
}

interface WrongMove {
  fen: string
  from: Key
  to: Key
}

const NO_SHAPES: DrawShape[] = []
const NO_CLASSES: SquareClasses = new Map()

function sideName(side: 'white' | 'black') {
  return side === 'white' ? 'White' : 'Black'
}

function introFor(lesson: Lesson) {
  return `${conceptLabel(lesson.concept)}. Find the move.`
}

/** Drives one lesson: the pure attempt wired to the board and side panel props. */
export function useLesson(lesson: Lesson, options: LessonOptions = {}) {
  const { onSolved, intro } = options
  const [attempt, setAttempt] = useState<LessonAttempt>(() => createAttempt(lesson))
  const [wrong, setWrong] = useState<WrongMove | null>(null)
  const [animating, setAnimating] = useState(false)
  const [message, setMessage] = useState(() => intro ?? introFor(lesson))
  const startedAt = useRef<number | null>(null)
  const reported = useRef(false)
  const onSolvedRef = useRef(onSolved)
  useEffect(() => {
    onSolvedRef.current = onSolved
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

  // The clock starts when the lesson is first shown.
  useEffect(() => {
    startedAt.current ??= Date.now()
  }, [])

  const onMove = useCallback(
    (from: Key, to: Key, promotion?: PromotionPiece) => {
      const input = { from, to, promotion }
      const { state, result } = submitLessonMove(attempt, input)
      if (result === 'correct') {
        setAttempt(state)
        setMessage(`${state.solvedBy?.san} is correct! ${lesson.explanation}`)
        if (!reported.current) {
          reported.current = true
          onSolvedRef.current?.({
            mistakes: state.misses,
            hintUsed: hintUsed(state),
            durationMs: Date.now() - (startedAt.current ?? Date.now()),
          })
        }
      } else if (result === 'wrong') {
        setWrong({ fen: new Chess(attempt.fen).move(input).after, from, to })
        setAttempt(state)
        setMessage(
          state.board === 'arrow' ? 'Not that one. Follow the arrow.' : 'Not quite. Try again.',
        )
        later(() => {
          setWrong(null)
          setAnimating(true)
          later(() => setAnimating(false), ANIMATION_MS)
        }, WRONG_FLASH_MS)
      }
    },
    [attempt, later, lesson.explanation],
  )

  const onHint = useCallback(() => {
    const next = requestLessonHint(attempt)
    setAttempt(next)
    if (next.textHints > attempt.textHints) setMessage(`Hint: ${lesson.hints[next.textHints - 1]}`)
    else
      setMessage(next.board === 'arrow' ? 'Play the move shown by the arrow.' : 'Move this piece.')
  }, [attempt, lesson.hints])

  const restart = useCallback(() => {
    timers.current.forEach(clearTimeout)
    timers.current.clear()
    setAttempt(createAttempt(lesson))
    setWrong(null)
    setAnimating(false)
    setMessage(intro ?? introFor(lesson))
    startedAt.current = Date.now()
    reported.current = false
  }, [lesson, intro])

  const solved = attempt.status === 'solved'
  const answer = useMemo(() => mainAnswer(lesson), [lesson])
  const showArrow = !solved && attempt.board === 'arrow'
  const showPiece = !solved && attempt.board !== 'none'

  const shapes = useMemo<DrawShape[]>(
    () => (showArrow ? [{ orig: answer.from, dest: answer.to, brush: ARROW_BRUSH }] : NO_SHAPES),
    [showArrow, answer],
  )
  const squareClasses = useMemo<SquareClasses>(() => {
    if (wrong) return new Map([[wrong.to, 'wrong']])
    if (showPiece) return new Map([[answer.from, 'hint']])
    return NO_CLASSES
  }, [wrong, showPiece, answer])

  const lastMove = useMemo<[Key, Key] | undefined>(() => {
    if (wrong) return [wrong.from, wrong.to]
    return attempt.solvedBy ? [attempt.solvedBy.from, attempt.solvedBy.to] : undefined
  }, [wrong, attempt.solvedBy])

  const side = lessonSide(lesson)
  const locked = solved || wrong !== null || animating

  const board: BoardProps = {
    fen: wrong ? wrong.fen : attempt.fen,
    orientation: side,
    lastMove,
    shapes,
    squareClasses,
    interactive: !locked,
    onMove,
  }

  /** Challenge numbers and navigation come from the caller. */
  const panel: Pick<SidePanelProps, 'coachMessage' | 'prompt' | 'onHint' | 'hintDisabled'> = {
    coachMessage: message,
    prompt: solved ? 'Solved.' : `${lesson.prompt} You play ${sideName(side)}.`,
    onHint,
    hintDisabled: locked || hintsExhausted(attempt),
  }

  return { attempt, board, panel, restart }
}
