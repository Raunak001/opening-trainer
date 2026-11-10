import { Rating } from 'ts-fsrs'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Board } from '../board'
import { getDb, getSettings, type AppSettings, type TrainerDB } from '../db'
// Direct module imports: the lessons index re-exports pages that import this one's siblings.
import type { Lesson, LessonPack } from '../lessons/lesson'
import { bundledPacks } from '../lessons/packs'
import { useLesson } from '../lessons/useLesson'
import { loadRepertoire, type Repertoire } from '../repertoire/builder'
import { loadOpeningIndex, openingFor, type OpeningIndex } from '../repertoire/openings'
import {
  answerCurrent,
  answeredCount,
  autoGrade,
  createSession,
  currentCard,
  isFinished,
  isLessonCard,
  lessonForCard,
  loadDueQueue,
  outcomeDetails,
  reviewCard,
  type DueQueue,
  type Session,
} from '../srs'
import type { Line } from './drill'
import { createMoveExplainer, type MoveExplainer } from './explainer'
import { cardLine, gradeFeedback, isPlayable, ratingName } from './review'
import { SidePanel } from './SidePanel'
import { TrainerLayout } from './TrainerLayout'
import { useDrill, type DrillOutcome } from './useDrill'
import './review.css'

/** How long the grade stays on screen before the next card. */
export const NEXT_CARD_DELAY_MS = 1500

export interface ReviewPageProps {
  db?: TrainerDB
  /** Pause after each card; tests shorten it. */
  nextCardDelayMs?: number
  /** Lesson packs for lesson cards; defaults to the bundled ones. */
  packs?: readonly LessonPack[]
  /** Practice one repertoire (a course) only; omitted → every due card. */
  repertoireId?: string
  /** Shows a button to leave, e.g. back to the course page. */
  onExit?: () => void
}

type Loaded = {
  queue: DueQueue
  session: Session
  repertoires: Map<string, Repertoire>
  grading: AppSettings['grading']
}

/** Study today's due cards, each played in the context of its line. */
export function ReviewPage({
  db: dbProp,
  nextCardDelayMs = NEXT_CARD_DELAY_MS,
  packs: packsProp,
  repertoireId,
  onExit,
}: ReviewPageProps) {
  const db = dbProp ?? getDb()
  const packs = packsProp ?? bundledPacks().packs
  const explain = useMemo(() => createMoveExplainer(db), [db])
  const [loaded, setLoaded] = useState<Loaded>()
  const [error, setError] = useState<string>()
  const [openings, setOpenings] = useState<OpeningIndex>()
  const [feedback, setFeedback] = useState<string>()
  // Bumped for every card shown, so a retried card gets a fresh drill.
  const [turn, setTurn] = useState(0)
  const [reloads, setReloads] = useState(0)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => () => clearTimeout(timer.current), [])

  useEffect(() => {
    let live = true
    ;(async () => {
      const now = new Date()
      const [queue, settings] = await Promise.all([
        loadDueQueue(db, now, repertoireId),
        getSettings(db),
      ])
      const repertoires = new Map<string, Repertoire>()
      for (const id of new Set(
        queue.cards.filter((c) => !isLessonCard(c)).map((c) => c.repertoireId),
      )) {
        const rep = await loadRepertoire(db, id)
        if (rep) repertoires.set(id, rep)
      }
      // Leave out cards whose position cannot be reached in their tree (they
      // stay due; the next card sync suspends them), and lesson cards whose lesson
      // is no longer bundled.
      const showable = queue.cards.filter((c) => {
        if (isLessonCard(c)) return lessonForCard(c, packs) !== undefined
        const rep = repertoires.get(c.repertoireId)
        return rep !== undefined && isPlayable(c, rep.tree)
      })
      if (!live) return
      setLoaded({
        queue,
        session: createSession({ ...queue, cards: showable }),
        repertoires,
        grading: settings.grading,
      })
      // Opening names only label the cards, and building the index is CPU work:
      // do it after the queue is on screen, and only if there is something to study.
      if (showable.length > 0) {
        const index = await loadOpeningIndex()
        if (live) setOpenings(index)
      }
    })().catch((err: unknown) => live && setError(String(err)))
    return () => {
      live = false
    }
  }, [db, reloads, packs, repertoireId])

  const session = loaded?.session
  const card = session && currentCard(session)
  const repertoire = card && loaded?.repertoires.get(card.repertoireId)
  const lesson = card && isLessonCard(card) ? lessonForCard(card, packs) : undefined

  const line = useMemo<Line | undefined>(() => {
    if (!card || !repertoire) return undefined
    const label = openings && openingFor(repertoire.tree, openings, card.positionKey)
    const name = card.origin === 'game' ? `${repertoire.name}: from your game` : undefined
    return cardLine(card, repertoire, name ?? label?.opening.name ?? repertoire.name, turn)
  }, [card, repertoire, openings, turn])

  const onComplete = useCallback(
    (outcome: DrillOutcome) => {
      if (!card || !loaded) return
      const grade = autoGrade(outcome, loaded.grading)
      const now = new Date()
      reviewCard(db, card.id, grade.rating, now, outcomeDetails(outcome))
        .then(({ card: updated }) => {
          setFeedback(
            gradeFeedback(grade, outcome.durationMs, updated.due.getTime() - now.getTime()),
          )
          timer.current = setTimeout(() => {
            setFeedback(undefined)
            setLoaded(
              (l) => l && { ...l, session: answerCurrent(l.session, updated, grade.rating) },
            )
            setTurn((t) => t + 1)
          }, nextCardDelayMs)
        })
        .catch((err: unknown) => setError(String(err)))
    },
    [card, loaded, db, nextCardDelayMs],
  )

  const exit = onExit && (
    <button type="button" onClick={onExit}>
      Back to course
    </button>
  )

  if (error) return <p className="review__message review__message--error">Error: {error}</p>
  if (!loaded || !session) return <p className="review__message">Loading your cards…</p>

  if (session.pending.length === 0 && answeredCount(session) === 0) {
    const { heldBack } = loaded.queue
    return (
      <div className="review__message">
        <p>Nothing is due right now.</p>
        {heldBack.reviews > 0 && (
          <p className="review__muted">
            Today&apos;s review limit is reached: {heldBack.reviews} review cards wait for tomorrow.
          </p>
        )}
        <button type="button" onClick={() => setReloads((n) => n + 1)}>
          Check again
        </button>
        {exit}
      </div>
    )
  }

  if (isFinished(session)) {
    const a = session.answered
    return (
      <div className="review__message">
        <p>Session complete: {answeredCount(session)} answers.</p>
        <p className="review__muted">
          {[Rating.Again, Rating.Hard, Rating.Good, Rating.Easy]
            .map((r) => `${ratingName(r)} ${a[r]}`)
            .join(' · ')}
        </p>
        <button type="button" onClick={() => setReloads((n) => n + 1)}>
          Check for more
        </button>
        {exit}
      </div>
    )
  }

  const answered = answeredCount(session)
  const progress = { current: answered + 1, total: answered + session.pending.length, answered }
  const controls = exit && <div className="drill-controls">{exit}</div>
  if (card && lesson)
    return (
      <>
        <LessonCardDrill
          key={`${card.id}#${turn}`}
          lesson={lesson}
          onComplete={onComplete}
          feedback={feedback}
          progress={progress}
        />
        {controls}
      </>
    )
  if (!line || !repertoire) return null
  return (
    <>
      <CardDrill
        key={`${line.id}`}
        line={line}
        intro={
          line.autoPlay
            ? `${line.name}. Watch the moves, then find yours.`
            : `${line.name}. Play your first move.`
        }
        onComplete={onComplete}
        explain={explain}
        feedback={feedback}
        progress={progress}
      />
      {controls}
    </>
  )
}

/** A lesson card: the lesson position on its own, any accepted move counts. */
function LessonCardDrill({
  lesson,
  onComplete,
  feedback,
  progress,
}: {
  lesson: Lesson
  onComplete: (outcome: DrillOutcome) => void
  feedback: string | undefined
  progress: { current: number; total: number; answered: number }
}) {
  const { board, panel } = useLesson(lesson, { onSolved: onComplete })
  return (
    <TrainerLayout>
      <Board {...board} />
      <SidePanel
        {...panel}
        // Keep the lesson's explanation beside the grade.
        coachMessage={feedback ? `${feedback} ${lesson.explanation}` : panel.coachMessage}
        prompt={feedback ? 'Next card coming up…' : panel.prompt}
        challenge={progress.current}
        challengeCount={progress.total}
        completed={progress.answered}
      />
    </TrainerLayout>
  )
}

function CardDrill({
  line,
  intro,
  onComplete,
  explain,
  feedback,
  progress,
}: {
  line: Line
  intro: string
  onComplete: (outcome: DrillOutcome) => void
  explain: MoveExplainer
  feedback: string | undefined
  progress: { current: number; total: number; answered: number }
}) {
  const { board, panel } = useDrill(line, { onComplete, intro, explain })
  return (
    <TrainerLayout>
      <Board {...board} />
      <SidePanel
        {...panel}
        coachMessage={feedback ?? panel.coachMessage}
        prompt={feedback ? 'Next card coming up…' : panel.prompt}
        challenge={progress.current}
        challengeCount={progress.total}
        completed={progress.answered}
      />
    </TrainerLayout>
  )
}
