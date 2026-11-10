import { Chess } from 'chess.js'
import type { DrawShape } from 'chessground/draw'
import type { Key, SquareClasses } from 'chessground/types'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ARROW_BRUSH, Board } from '../board'
import type { CoordRunRow } from '../db'
import { TrainerLayout } from '../trainer/TrainerLayout'
import { isPromptMove, pickPrompts, type MovePrompt } from './movePrompts'
import { RoundSummary } from './RoundSummary'
import { catalogPrompts, loadCardPrompts, saveRound } from './store'
import type { DrillProps } from './SquareDrill'

/** Play the move: a SAN prompt from your courses, played on a board without square names. */
export function MoveDrill(props: DrillProps & { questions: number }) {
  const { db, view, questions } = props
  const [prompts, setPrompts] = useState<MovePrompt[]>()
  useEffect(() => {
    let live = true
    loadCardPrompts(db).then((cards) => {
      if (!live) return
      const side = (p: MovePrompt) => p.view === view
      setPrompts(
        pickPrompts(cards.filter(side), catalogPrompts().filter(side), questions, Math.random),
      )
    })
    return () => {
      live = false
    }
  }, [db, view, questions])
  if (!prompts) return <p className="coord-muted coord-loading">Loading positions…</p>
  if (prompts.length === 0)
    return <p className="coord-muted coord-loading">No positions for this side yet.</p>
  return <MoveRound {...props} prompts={prompts} />
}

const NO_CLASSES: SquareClasses = new Map()
const NO_SHAPES: DrawShape[] = []

function after(fen: string, from: string, to: string, promotion?: string): string | undefined {
  try {
    const chess = new Chess(fen)
    chess.move({ from, to, promotion })
    return chess.fen()
  } catch {
    return undefined
  }
}

function MoveRound({
  db,
  view,
  best,
  onAgain,
  onQuit,
  prompts,
}: DrillProps & { prompts: MovePrompt[] }) {
  const [index, setIndex] = useState(0)
  const [shownFen, setShownFen] = useState(prompts[0].fen)
  const [classes, setClasses] = useState<SquareClasses>(NO_CLASSES)
  const [shapes, setShapes] = useState<DrawShape[]>(NO_SHAPES)
  const [locked, setLocked] = useState(false)
  const [results, setResults] = useState<{ prompt: MovePrompt; correct: boolean }[]>([])
  const [finished, setFinished] = useState<Omit<CoordRunRow, 'id'>>()
  const [mountedAt] = useState(() => performance.now())
  const startedAt = useRef(mountedAt)
  const prompt = prompts[index]

  const advance = useCallback(
    (list: { prompt: MovePrompt; correct: boolean }[]) => {
      const nextIndex = index + 1
      setClasses(NO_CLASSES)
      setShapes(NO_SHAPES)
      setLocked(false)
      if (nextIndex >= prompts.length) {
        const run = {
          drill: 'move' as const,
          view,
          at: new Date(),
          correct: list.filter((r) => r.correct).length,
          wrong: list.filter((r) => !r.correct).length,
          durationMs: performance.now() - startedAt.current,
        }
        setFinished(run)
        void saveRound(db, run, [])
        return
      }
      setIndex(nextIndex)
      setShownFen(prompts[nextIndex].fen)
    },
    [index, prompts, view, db],
  )

  const judge = useCallback(
    (correct: boolean, played?: { from: string; to: string; promotion?: string }) => {
      const list = [...results, { prompt, correct }]
      setResults(list)
      setLocked(true)
      const target = after(prompt.fen, prompt.from, prompt.to, prompt.promotion)
      if (correct) {
        if (target) setShownFen(target)
        setClasses(new Map([[prompt.to as Key, 'coord-right']]))
        window.setTimeout(() => advance(list), 600)
        return
      }
      const wrongFen = played && after(prompt.fen, played.from, played.to, played.promotion)
      if (wrongFen) setShownFen(wrongFen)
      const marks: SquareClasses = new Map()
      if (played) marks.set(played.to as Key, 'wrong')
      setClasses(marks)
      setShapes([{ orig: prompt.from as Key, dest: prompt.to as Key, brush: ARROW_BRUSH }])
      // Show the right move from the original position after a moment.
      window.setTimeout(() => setShownFen(prompt.fen), 700)
      window.setTimeout(() => advance(list), 1900)
    },
    [results, prompt, advance],
  )

  const onMove = useCallback(
    (from: Key, to: Key, promotion?: string) => {
      if (locked) return
      judge(isPromptMove(prompt, from, to, promotion), { from, to, promotion })
    },
    [locked, prompt, judge],
  )

  const missed = results.filter((r) => !r.correct).map((r) => r.prompt.san)
  const correct = results.filter((r) => r.correct).length

  return (
    <TrainerLayout className="coord-layout">
      <Board
        key={index}
        fen={shownFen}
        orientation={prompt.view}
        onMove={onMove}
        interactive={!locked && !finished}
        squareClasses={classes}
        shapes={shapes}
        coordinates={false}
        sounds
      />
      <aside className="side-panel coord-panel">
        <header className="coord-panel__head">
          <span className="coord-panel__title">Play the move</span>
          <span className="coord-muted">
            {Math.min(index + 1, prompts.length)} / {prompts.length}
          </span>
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
            <div className="coord-score">
              <span className="coord-score__right">{correct}</span>
              <span className="coord-score__wrong">{results.length - correct}</span>
            </div>
            <p className="coord-prompt">
              {prompt.view === 'white' ? 'White' : 'Black'} plays <strong>{prompt.san}</strong>
            </p>
            <p className="coord-muted">From {prompt.source}</p>
            {locked && !results[results.length - 1]?.correct && (
              <p className="coord-wrong-text">
                {prompt.san} is {prompt.from}–{prompt.to}.
              </p>
            )}
            <div className="coord-actions">
              <button
                type="button"
                className="coord-secondary"
                disabled={locked}
                onClick={() => judge(false)}
              >
                Show me
              </button>
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
