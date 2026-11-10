import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CoordRunRow, DrillMode, TrainerDB } from '../db'
import { TrainerLayout } from '../trainer/TrainerLayout'
import { CoordBoard } from './CoordBoard'
import { pickSquare } from './pick'
import { RoundSummary } from './RoundSummary'
import { FILES, RANKS, type Square, type View } from './squares'
import { heatmap, type Answer } from './stats'
import { saveRound } from './store'
import { useCountdown } from './useCountdown'

export interface DrillProps {
  db: TrainerDB
  view: View
  best?: CoordRunRow
  onAgain: () => void
  onQuit: () => void
}

/** Find / Name the square: a timed round of single squares. */
export function SquareDrill(props: DrillProps & { mode: DrillMode; seconds: number }) {
  const { db, mode, view } = props
  const [cells, setCells] = useState<ReturnType<typeof heatmap>>()
  useEffect(() => {
    let live = true
    db.coordStats
      .where('mode')
      .equals(mode)
      .toArray()
      .then((rows) => live && setCells(heatmap(rows, { view, modes: [mode] })))
    return () => {
      live = false
    }
  }, [db, mode, view])
  if (!cells) return <p className="coord-muted coord-loading">Loading…</p>
  return <SquareRound {...props} cells={cells} />
}

const FEEDBACK_MS = 650

function SquareRound({
  db,
  mode,
  view,
  seconds,
  best,
  onAgain,
  onQuit,
  cells,
}: DrillProps & { mode: DrillMode; seconds: number; cells: ReturnType<typeof heatmap> }) {
  const [target, setTarget] = useState<Square>(() => pickSquare(cells, Math.random))
  const recent = useRef<Square[]>([])
  const [mountedAt] = useState(() => performance.now())
  const promptAt = useRef(mountedAt)
  const [answers, setAnswers] = useState<Answer[]>([])
  const [marks, setMarks] = useState<Map<Square, string>>(new Map())
  const [typed, setTypedState] = useState('')
  // Read by the key handler, which may run again before a re-render when typing fast.
  const typedRef = useRef('')
  const setTyped = useCallback((v: string) => {
    typedRef.current = v
    setTypedState(v)
  }, [])
  const [locked, setLocked] = useState(false)
  const [finished, setFinished] = useState<Omit<CoordRunRow, 'id'>>()
  const answersRef = useRef(answers)
  useEffect(() => {
    answersRef.current = answers
  }, [answers])

  const finish = useCallback(() => {
    const list = answersRef.current
    const run = {
      drill: mode,
      view,
      at: new Date(),
      correct: list.filter((a) => a.correct).length,
      wrong: list.filter((a) => !a.correct).length,
      durationMs: seconds * 1000,
    }
    setFinished(run)
    void saveRound(db, run, list)
  }, [db, mode, view, seconds])

  const left = useCountdown(seconds * 1000, finish)
  const running = !finished

  const next = useCallback(
    (prev: Square) => {
      recent.current = [prev, ...recent.current].slice(0, 4)
      setTarget(pickSquare(cells, Math.random, recent.current))
      setTyped('')
      setMarks(new Map())
      setLocked(false)
      promptAt.current = performance.now()
    },
    [cells, setTyped],
  )

  const answer = useCallback(
    (given: Square) => {
      if (!running || locked) return
      const correct = given === target
      setAnswers((a) => [
        ...a,
        {
          mode,
          view,
          square: target,
          correct,
          ms: performance.now() - promptAt.current,
          at: Date.now(),
        },
      ])
      if (correct) {
        if (mode === 'find') {
          setMarks(new Map([[target, 'coord-right']]))
          window.setTimeout(() => setMarks(new Map()), 200)
        }
        next(target)
        return
      }
      setLocked(true)
      setMarks(
        new Map(
          mode === 'find'
            ? [
                [given, 'coord-wrong'],
                [target, 'coord-right'],
              ]
            : [[target, 'coord-wrong']],
        ),
      )
      window.setTimeout(() => next(target), FEEDBACK_MS)
    },
    [running, locked, target, mode, view, next],
  )

  // Name the square: type a file then a rank.
  const press = useCallback(
    (key: string) => {
      if (mode !== 'name' || !running || locked) return
      if (/^[a-h]$/.test(key)) setTyped(key)
      else if (/^[1-8]$/.test(key) && typedRef.current.length === 1) {
        const sq = `${typedRef.current}${key}` as Square
        setTyped(sq)
        answer(sq)
      } else if (key === 'Backspace') setTyped('')
    },
    [mode, running, locked, setTyped, answer],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      press(e.key.length === 1 ? e.key.toLowerCase() : e.key)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [press])

  const nameMarks = useMemo(
    () => (mode === 'name' && marks.size === 0 ? new Map([[target, 'coord-target']]) : marks),
    [mode, marks, target],
  )

  const correct = answers.filter((a) => a.correct).length
  const wrong = answers.length - correct
  const missed = answers.filter((a) => !a.correct).map((a) => a.square)

  return (
    <TrainerLayout className="coord-layout">
      <CoordBoard
        view={view}
        marks={nameMarks}
        overlay={mode === 'find' && running ? target : undefined}
        onSquare={mode === 'find' ? answer : undefined}
      />
      <aside className="side-panel coord-panel">
        <header className="coord-panel__head">
          <span className="coord-panel__title">
            {mode === 'find' ? 'Find the square' : 'Name the square'}
          </span>
          <span className="coord-muted">{view === 'white' ? 'White' : 'Black'} at the bottom</span>
        </header>
        {finished ? (
          <RoundSummary
            run={finished}
            best={best}
            missed={missed}
            onAgain={onAgain}
            onQuit={onQuit}
          />
        ) : (
          <>
            <div className="coord-timer" role="timer" aria-label="Time left">
              <span
                className="coord-timer__fill"
                style={{ width: `${(left / (seconds * 1000)) * 100}%` }}
              />
            </div>
            <div className="coord-score">
              <span className="coord-score__right">{correct}</span>
              <span className="coord-score__wrong">{wrong}</span>
              <span className="coord-muted">{Math.ceil(left / 1000)}s</span>
            </div>
            {mode === 'find' ? (
              <p className="coord-prompt">
                Click <strong>{target}</strong>
              </p>
            ) : (
              <>
                <p className="coord-prompt">
                  Name the marked square:{' '}
                  <strong className="coord-typed">{typed.padEnd(2, '_')}</strong>
                </p>
                {locked && <p className="coord-wrong-text">It was {target}.</p>}
                <div className="coord-keys" aria-label="Files">
                  {FILES.map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => press(f)}
                      aria-pressed={typed === f}
                    >
                      {f}
                    </button>
                  ))}
                </div>
                <div className="coord-keys" aria-label="Ranks">
                  {RANKS.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => press(r)}
                      disabled={typed.length !== 1}
                    >
                      {r}
                    </button>
                  ))}
                </div>
                <p className="coord-muted">Or type it: a letter, then a number.</p>
              </>
            )}
            <div className="coord-actions">
              <button type="button" className="coord-secondary" onClick={onQuit}>
                Stop
              </button>
            </div>
          </>
        )}
      </aside>
    </TrainerLayout>
  )
}
