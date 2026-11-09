import { Chess } from 'chess.js'
import { useEffect, useMemo, useState } from 'react'
import { Board } from '../board'
import { getSettings, type TrainerDB } from '../db'
import { dexieEvalCache } from '../engine/evalCache'
import type { Score } from '../engine/uci'
import type { CourseLine } from '../repertoire/lines'
import type { OpeningIndex } from '../repertoire/openings'
import { positionKey, type PositionKey } from '../repertoire/positionKey'
import type { RepertoireTree } from '../repertoire/tree'
import { fensAlong } from './moveRows'
import { createMoveExplainer } from './explainer'
import { learnFen, learnReviews, newCardCount, saveLearnedLine, type LearnState } from './learn'
import { PlayoutView } from './PlayoutView'
import { SidePanel } from './SidePanel'
import { TrainerLayout } from './TrainerLayout'
import { useLearn } from './useLearn'

export interface LearnViewProps {
  db: TrainerDB
  repertoireId: string
  side: 'white' | 'black'
  tree: RepertoireTree
  line: CourseLine
  /** Positions of your moves whose cards are still new. */
  newCards: ReadonlySet<PositionKey>
  openings?: OpeningIndex
  /** Back to the course page. */
  onExit: () => void
  /** Offered once the line is saved, when there may be another line to learn. */
  onNext?: () => void
}

type Saved =
  { kind: 'saving' } | { kind: 'saved'; cards: number } | { kind: 'error'; message: string }

/** Cached evals (any depth) of the positions after each move of the line. */
function useLineEvals(db: TrainerDB, moves: readonly string[]) {
  const [evals, setEvals] = useState<Map<PositionKey, Score>>()
  useEffect(() => {
    let live = true
    const cache = dexieEvalCache(db)
    const keys = fensAlong(moves).slice(1).map(positionKey)
    Promise.all(keys.map((k) => cache.get(k, 1).then((e) => [k, e] as const)))
      .then((found) => {
        if (!live) return
        const map = new Map<PositionKey, Score>()
        for (const [k, e] of found) if (e) map.set(k, e.score)
        setEvals(map)
      })
      .catch(() => {
        // Evals only add a sentence to the narration.
      })
    return () => {
      live = false
    }
  }, [db, moves])
  return evals
}

/** Learn mode for one line: shown move by move, then played back by you. */
export function LearnView(props: LearnViewProps) {
  const evals = useLineEvals(props.db, props.line.moves)
  // Wait for the evals so narration is worked out once, complete.
  if (!evals) return <p className="course__muted">Loading…</p>
  return <LearnSession {...props} evals={evals} />
}

function LearnSession({
  db,
  repertoireId,
  side,
  tree,
  line,
  newCards,
  openings,
  onExit,
  onNext,
  evals,
}: LearnViewProps & { evals: ReadonlyMap<PositionKey, Score> }) {
  const [saved, setSaved] = useState<Saved>()
  const [playingOut, setPlayingOut] = useState(false)
  const explain = useMemo(() => createMoveExplainer(db), [db])
  const learnLine = useMemo(() => ({ side, moves: line.moves }), [side, line.moves])
  const onComplete = (state: LearnState) => {
    setSaved({ kind: 'saving' })
    getSettings(db)
      .then(async (settings) => {
        const reviews = learnReviews(state, settings.grading)
        await saveLearnedLine(db, repertoireId, reviews)
        setSaved({ kind: 'saved', cards: reviews.length })
      })
      .catch((err: unknown) => setSaved({ kind: 'error', message: String(err) }))
  }
  const { learn, board, panel, paused, togglePause, play } = useLearn(learnLine, newCards, {
    tree,
    openings,
    evals,
    onComplete,
  })
  const fresh = newCardCount(learn)
  const finalFen = learnFen(learn)
  const gameOver = new Chess(finalFen).isGameOver()

  return (
    <>
      {playingOut ? (
        <PlayoutView
          db={db}
          fen={finalFen}
          userSide={side}
          lineStartFen={new Chess().fen()}
          lineMoves={line.moves}
          explain={explain}
        />
      ) : (
        <TrainerLayout>
          <Board {...board} />
          <SidePanel {...panel} />
        </TrainerLayout>
      )}
      <div className="drill-controls">
        <button type="button" onClick={onExit}>
          Back to course
        </button>
        {learn.phase === 'show' && (
          <>
            <button type="button" onClick={togglePause}>
              {paused ? 'Resume' : 'Pause'}
            </button>
            <button type="button" onClick={play}>
              {learn.ply >= learn.steps.length ? 'Play it now' : 'Skip to playing'}
            </button>
          </>
        )}
        {learn.phase === 'complete' && !gameOver && !playingOut && (
          <button type="button" onClick={() => setPlayingOut(true)}>
            Play on vs Stockfish
          </button>
        )}
        {saved?.kind === 'saved' && onNext && (
          <button type="button" onClick={onNext}>
            Next line
          </button>
        )}
        <span role="status">
          {learn.phase !== 'complete'
            ? `${line.name ?? 'Line'} · ${fresh} new ${fresh === 1 ? 'move' : 'moves'}`
            : saved?.kind === 'saved'
              ? `Learned: ${saved.cards} ${saved.cards === 1 ? 'card' : 'cards'} scheduled for practice.`
              : saved?.kind === 'error'
                ? `Could not save: ${saved.message}`
                : 'Saving…'}
        </span>
      </div>
    </>
  )
}
