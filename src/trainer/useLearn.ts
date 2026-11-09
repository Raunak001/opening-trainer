import { Chess } from 'chess.js'
import type { DrawShape } from 'chessground/draw'
import type { Key, SquareClasses } from 'chessground/types'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ARROW_BRUSH, type BoardProps, type PromotionPiece } from '../board'
import type { Score } from '../engine/uci'
import type { OpeningIndex } from '../repertoire/openings'
import type { PositionKey } from '../repertoire/positionKey'
import type { RepertoireTree } from '../repertoire/tree'
import {
  createLearn,
  isFast,
  lastLearnMove,
  learnArrow,
  learnFen,
  learnHintSquare,
  learnTurn,
  playLearnOpponent,
  requestLearnHint,
  showBack,
  showDone,
  showNext,
  startPlay,
  submitLearnMove,
  type LearnLine,
  type LearnState,
} from './learn'
import { lineNarration } from './narration'
import type { SidePanelProps } from './SidePanel'
import { ANIMATION_MS, OPPONENT_DELAY_MS, REPLAY_DELAY_MS, WRONG_FLASH_MS } from './useDrill'

/** Show phase: time to read each move's narration before the next. */
export const SHOW_MOVE_MS = 2200
/** Show phase: how long your move's arrow stays before the move is played. */
export const SHOW_ARROW_MS = 1800

export interface LearnOptions {
  tree?: RepertoireTree
  openings?: OpeningIndex
  /** Cached engine evals by position key (after the move), side to move's view. */
  evals?: ReadonlyMap<PositionKey, Score>
  /** Called once, with the finished state, when the line has been played back. */
  onComplete?: (state: LearnState) => void
}

interface WrongMove {
  fen: string
  from: Key
  to: Key
}

const NO_SHAPES: DrawShape[] = []
const NO_CLASSES: SquareClasses = new Map()
const sideName = (side: 'white' | 'black') => (side === 'white' ? 'White' : 'Black')

/** Drives Learn mode: the pure state machine wired to board, side panel and narration. */
export function useLearn(
  line: LearnLine,
  newCards: ReadonlySet<PositionKey>,
  options: LearnOptions = {},
) {
  const { tree, openings, evals, onComplete } = options
  const [learn, setLearn] = useState<LearnState>(() => createLearn(line, newCards))
  const [paused, setPaused] = useState(false)
  const [wrong, setWrong] = useState<WrongMove | null>(null)
  const [animating, setAnimating] = useState(false)
  const [playMessage, setPlayMessage] = useState<string>()
  const promptStart = useRef<number | null>(null)
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

  // Narration per move, worked out once per line.
  const narration = useMemo(
    () => lineNarration(learn.steps, learn.side, { tree, openings, evals }),
    [learn.steps, learn.side, tree, openings, evals],
  )

  // Show phase: step automatically unless paused.
  const autoShow = learn.phase === 'show' && !paused && !showDone(learn)
  useEffect(() => {
    if (!autoShow) return
    const delay = isFast(learn) ? REPLAY_DELAY_MS : learn.arrowShown ? SHOW_ARROW_MS : SHOW_MOVE_MS
    // The first move goes quickly: nothing to read yet.
    const id = setTimeout(
      () => setLearn(showNext),
      learn.ply === 0 && !learn.arrowShown ? 600 : delay,
    )
    return () => clearTimeout(id)
  }, [autoShow, learn])

  // Play phase: the opponent replies after a pause.
  const turn = learnTurn(learn)
  useEffect(() => {
    if (turn !== 'opponent') return
    const ply = learn.ply
    const id = setTimeout(() => {
      setPlayMessage(narration[ply])
      setLearn(playLearnOpponent)
      setAnimating(true)
      later(() => setAnimating(false), ANIMATION_MS)
    }, OPPONENT_DELAY_MS)
    return () => clearTimeout(id)
  }, [turn, learn.ply, later, narration])

  // Start the thinking clock when your move becomes playable.
  useEffect(() => {
    if (turn === 'user' && !animating && promptStart.current === null)
      promptStart.current = Date.now()
  }, [turn, learn.ply, animating])

  useEffect(() => {
    if (learn.phase !== 'complete' || completed.current) return
    completed.current = true
    onCompleteRef.current?.(learn)
  }, [learn])

  const onMove = useCallback(
    (from: Key, to: Key, promotion?: PromotionPiece) => {
      const input = { from, to, promotion }
      const elapsed = promptStart.current === null ? undefined : Date.now() - promptStart.current
      const { state, result } = submitLearnMove(learn, input, elapsed)
      if (result === 'correct') {
        promptStart.current = null
        setLearn(state)
        setPlayMessage(`${learn.steps[learn.ply].san} is right!`)
      } else if (result === 'wrong') {
        setWrong({ fen: new Chess(learnFen(learn)).move(input).after, from, to })
        setLearn(state)
        setPlayMessage(
          state.hint === 'arrow' ? 'Not that one. Follow the arrow.' : 'Not quite. Try again.',
        )
        later(() => {
          setWrong(null)
          setAnimating(true)
          later(() => setAnimating(false), ANIMATION_MS)
        }, WRONG_FLASH_MS)
      }
    },
    [learn, later],
  )

  const onHint = useCallback(() => {
    const next = requestLearnHint(learn)
    setLearn(next)
    setPlayMessage(next.hint === 'arrow' ? 'Play the move shown by the arrow.' : 'Move this piece.')
  }, [learn])

  const back = useCallback(() => {
    setPaused(true)
    setLearn(showBack)
  }, [])
  const forward = useCallback(() => {
    setPaused(true)
    setLearn(showNext)
  }, [])
  const togglePause = useCallback(() => setPaused((p) => !p), [])
  const play = useCallback(() => {
    timers.current.forEach(clearTimeout)
    timers.current.clear()
    setAnimating(false)
    setWrong(null)
    setPlayMessage('Now you play it. Your new moves have arrows; the rest are from memory.')
    setLearn(startPlay)
  }, [])

  const arrow = learnArrow(learn)
  const hintSquare = learnHintSquare(learn)
  const last = lastLearnMove(learn)
  const shapes = useMemo<DrawShape[]>(
    () => (arrow ? [{ orig: arrow.from, dest: arrow.to, brush: ARROW_BRUSH }] : NO_SHAPES),
    [arrow],
  )
  const squareClasses = useMemo<SquareClasses>(() => {
    if (wrong) return new Map([[wrong.to, 'wrong']])
    if (hintSquare) return new Map([[hintSquare, 'hint']])
    return NO_CLASSES
  }, [wrong, hintSquare])
  const lastMove = useMemo<[Key, Key] | undefined>(() => {
    if (wrong) return [wrong.from, wrong.to]
    return last ? [last.from, last.to] : undefined
  }, [wrong, last])

  const locked = turn !== 'user' || wrong !== null || animating
  const board: BoardProps = {
    fen: wrong ? wrong.fen : learnFen(learn),
    orientation: learn.side,
    lastMove,
    shapes,
    squareClasses,
    interactive: !locked,
    onMove,
  }

  const userSteps = learn.steps.filter((s) => s.byUser).length
  const playedMoves = learn.steps.slice(0, learn.ply).map((s) => s.san)
  let coachMessage: string
  let prompt: string
  if (learn.phase === 'show') {
    coachMessage = learn.arrowShown
      ? narration[learn.ply]
      : learn.ply > 0
        ? narration[learn.ply - 1]
        : `Watch the line first. You play ${sideName(learn.side)}.`
    prompt = showDone(learn)
      ? 'That is the line. Now play it yourself.'
      : isFast(learn)
        ? 'Replaying the moves you already know…'
        : learn.arrowShown
          ? 'Your move, shown by the arrow.'
          : 'Watching the line…'
  } else if (learn.phase === 'play') {
    coachMessage = playMessage ?? ''
    prompt = turn === 'user' ? `Your move as ${sideName(learn.side)}.` : 'Opponent is replying…'
  } else {
    coachMessage = 'Line learned. It joins your practice.'
    prompt = 'Line complete.'
  }

  const panel: SidePanelProps = {
    coachMessage,
    prompt,
    challenge: Math.min(learn.records.length + 1, userSteps),
    challengeCount: userSteps,
    completed: learn.phase === 'show' ? 0 : learn.records.length,
    onHint,
    hintDisabled: locked || learn.hint === 'arrow',
    onBack: back,
    onForward: forward,
    canGoBack: learn.phase === 'show' && (learn.ply > 0 || learn.arrowShown),
    canGoForward: learn.phase === 'show' && !showDone(learn),
    moves: { moves: playedMoves, startFen: undefined },
  }

  return { learn, board, panel, paused, togglePause, play }
}
