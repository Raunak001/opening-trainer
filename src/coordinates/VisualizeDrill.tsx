import { Chess } from 'chess.js'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CoordRunRow } from '../db'
import { TrainerLayout } from '../trainer/TrainerLayout'
import { CoordBoard, EMPTY_BOARD } from './CoordBoard'
import { RoundSummary } from './RoundSummary'
import type { Square } from './squares'
import { saveRound } from './store'
import type { DrillProps } from './SquareDrill'
import { makeQuestions, type VisualQuestion } from './visualize'

/** Board placement with one white piece, for revealing reach questions. */
function placementWith(piece: 'n' | 'b', square: Square): string {
  const chess = new Chess(`${EMPTY_BOARD} w - - 0 1`, { skipValidation: true })
  chess.put({ type: piece, color: 'w' }, square)
  return chess.fen().split(' ')[0]
}

function revealOf(q: VisualQuestion): { placement: string; marks: Map<Square, string> } {
  const [main, ...rest] = q.reveal
  if (q.kind === 'knight' || q.kind === 'bishop') {
    const marks = new Map<Square, string>(rest.map((s) => [s, 'coord-dot']))
    marks.set(q.answer as Square, 'coord-right')
    return { placement: placementWith(q.kind === 'knight' ? 'n' : 'b', main), marks }
  }
  return { placement: EMPTY_BOARD, marks: new Map(q.reveal.map((s) => [s, 'coord-target'])) }
}

/** Visualize: questions answered without looking, the board revealed after each. */
export function VisualizeDrill({
  db,
  view,
  best,
  onAgain,
  onQuit,
  questions,
}: DrillProps & { questions: number }) {
  const [qs] = useState(() => makeQuestions(questions, Math.random))
  const [index, setIndex] = useState(0)
  const [picked, setPicked] = useState<string>()
  const [results, setResults] = useState<boolean[]>([])
  const [finished, setFinished] = useState<Omit<CoordRunRow, 'id'>>()
  const [mountedAt] = useState(() => performance.now())
  const startedAt = useRef(mountedAt)
  const q = qs[index]

  const choose = useCallback(
    (option: string) => {
      if (picked !== undefined || finished) return
      setPicked(option)
      setResults((r) => [...r, option === q.answer])
    },
    [picked, finished, q],
  )

  const next = useCallback(() => {
    if (picked === undefined) return
    if (index + 1 >= qs.length) {
      const correct = results.filter(Boolean).length
      const run = {
        drill: 'visualize' as const,
        view,
        at: new Date(),
        correct,
        wrong: results.length - correct,
        durationMs: performance.now() - startedAt.current,
      }
      setFinished(run)
      void saveRound(db, run, [])
      return
    }
    setIndex(index + 1)
    setPicked(undefined)
  }, [picked, index, qs.length, results, view, db])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (finished || e.metaKey || e.ctrlKey || e.altKey) return
      const n = Number(e.key)
      if (picked === undefined && n >= 1 && n <= q.options.length) choose(q.options[n - 1])
      else if (picked !== undefined && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault()
        next()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [finished, picked, q, choose, next])

  const reveal = useMemo(() => revealOf(q), [q])
  const answered = picked !== undefined
  const correct = results.filter(Boolean).length

  return (
    <TrainerLayout className="coord-layout">
      <CoordBoard
        view={view}
        hidden={!answered && !finished}
        placement={answered ? reveal.placement : EMPTY_BOARD}
        marks={answered ? reveal.marks : undefined}
      />
      <aside className="side-panel coord-panel">
        <header className="coord-panel__head">
          <span className="coord-panel__title">Visualize</span>
          <span className="coord-muted">
            {index + 1} / {qs.length}
          </span>
        </header>
        {finished ? (
          <RoundSummary run={finished} best={best} missed={[]} onAgain={onAgain} onQuit={onQuit} />
        ) : (
          <>
            <div className="coord-score">
              <span className="coord-score__right">{correct}</span>
              <span className="coord-score__wrong">{results.length - correct}</span>
            </div>
            <p className="coord-prompt">{q.prompt}</p>
            <div className="coord-options">
              {q.options.map((o, i) => (
                <button
                  key={o}
                  type="button"
                  disabled={answered}
                  className={
                    answered && o === q.answer
                      ? 'coord-option coord-option--right'
                      : answered && o === picked
                        ? 'coord-option coord-option--wrong'
                        : 'coord-option'
                  }
                  onClick={() => choose(o)}
                >
                  <span className="coord-option__key">{i + 1}</span> {o}
                </button>
              ))}
            </div>
            {answered && (
              <>
                <p className={picked === q.answer ? 'coord-right-text' : 'coord-wrong-text'}>
                  {picked === q.answer ? 'Right.' : 'Not quite.'} {q.explain}
                </p>
                <div className="coord-actions">
                  <button type="button" className="coord-primary" onClick={next} autoFocus>
                    {index + 1 >= qs.length ? 'Finish' : 'Next'}
                  </button>
                </div>
              </>
            )}
            {!answered && (
              <p className="coord-muted">
                Picture the board; it shows once you answer. Keys 1–{q.options.length}.
              </p>
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
