import { useState } from 'react'
import { Board } from '../board'
import { SidePanel } from '../trainer/SidePanel'
import { TrainerLayout } from '../trainer/TrainerLayout'
import type { DrillOutcome } from '../trainer/useDrill'
import type { Lesson, LessonPack } from './lesson'
import { useLesson } from './useLesson'

export interface LessonPlayerProps {
  pack: LessonPack
  /** Called each time a lesson is solved (every solve, including replays). */
  onSolved?: (lesson: Lesson, outcome: DrillOutcome) => void
  /** Back to the pack list. */
  onExit?: () => void
}

/** Plays a pack's lessons in order. Back/forward move between lessons. */
export function LessonPlayer({ pack, onSolved, onExit }: LessonPlayerProps) {
  const [index, setIndex] = useState(0)
  const [solved, setSolved] = useState<ReadonlySet<string>>(() => new Set())
  // Bumped by "Try again" so the same lesson restarts with a fresh attempt.
  const [round, setRound] = useState(0)
  const lesson = pack.lessons[index]
  const last = index === pack.lessons.length - 1
  const done = solved.size === pack.lessons.length

  const handleSolved = (l: Lesson, outcome: DrillOutcome) => {
    setSolved((s) => new Set(s).add(l.id))
    onSolved?.(l, outcome)
  }

  return (
    <>
      <LessonView
        key={`${lesson.id}#${round}`}
        lesson={lesson}
        onSolved={handleSolved}
        challenge={index + 1}
        challengeCount={pack.lessons.length}
        completed={solved.size}
        onBack={() => setIndex((i) => Math.max(0, i - 1))}
        onForward={() => setIndex((i) => Math.min(pack.lessons.length - 1, i + 1))}
        canGoBack={index > 0}
        canGoForward={!last}
      />
      <div className="drill-controls">
        {onExit && (
          <button type="button" onClick={onExit}>
            All packs
          </button>
        )}
        <button type="button" onClick={() => setRound((r) => r + 1)}>
          Try again
        </button>
        {solved.has(lesson.id) && !last && (
          <button type="button" onClick={() => setIndex(index + 1)}>
            Next lesson
          </button>
        )}
        {done && <span role="status">Pack complete: all {pack.lessons.length} solved.</span>}
      </div>
    </>
  )
}

interface LessonViewProps {
  lesson: Lesson
  onSolved: (lesson: Lesson, outcome: DrillOutcome) => void
  challenge: number
  challengeCount: number
  completed: number
  onBack: () => void
  onForward: () => void
  canGoBack: boolean
  canGoForward: boolean
}

function LessonView({ lesson, onSolved, ...panelProps }: LessonViewProps) {
  const { board, panel } = useLesson(lesson, { onSolved: (o) => onSolved(lesson, o) })
  return (
    <TrainerLayout>
      <Board {...board} />
      <SidePanel {...panel} {...panelProps} />
    </TrainerLayout>
  )
}
