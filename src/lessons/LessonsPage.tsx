import { useState } from 'react'
import type { DrillOutcome } from '../trainer/useDrill'
import { conceptLabel, type Lesson, type LessonPack } from './lesson'
import { LessonPlayer } from './LessonPlayer'
import { bundledPacks, type LoadedPacks } from './packs'
import './lessons.css'

export interface LessonsPageProps {
  /** Packs to offer; defaults to the bundled ones. */
  packs?: LoadedPacks
  onSolved?: (pack: LessonPack, lesson: Lesson, outcome: DrillOutcome) => void
}

function concepts(pack: LessonPack): string {
  return [...new Set(pack.lessons.map((l) => conceptLabel(l.concept)))].join(', ')
}

/** Pick a pack, then play its lessons. */
export function LessonsPage({ packs: packsProp, onSolved }: LessonsPageProps) {
  const { packs, errors } = packsProp ?? bundledPacks()
  const [packId, setPackId] = useState<string>()
  const pack = packs.find((p) => p.id === packId)

  if (pack)
    return (
      <LessonPlayer
        key={pack.id}
        pack={pack}
        onSolved={(lesson, outcome) => onSolved?.(pack, lesson, outcome)}
        onExit={() => setPackId(undefined)}
      />
    )

  return (
    <div className="lessons">
      <section className="lessons__panel">
        <h1>Lesson packs</h1>
        {packs.length === 0 ? (
          <p className="lessons__muted">
            No packs yet. Export one from the authoring tool and save it in
            <code> src/lessons/packs/</code>.
          </p>
        ) : (
          <ul className="lessons__packs">
            {packs.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => setPackId(p.id)}>
                  <span className="lessons__pack-name">{p.name}</span>
                  <span className="lessons__muted">
                    {p.lessons.length} lessons · {concepts(p)}
                  </span>
                  {p.description && <span className="lessons__muted">{p.description}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
        {errors.length > 0 && (
          <div className="lessons__errors" role="alert">
            <p>Some packs could not be loaded:</p>
            <ul>
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  )
}
