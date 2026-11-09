import { useState } from 'react'
import type { DrillOutcome } from '../trainer/useDrill'
import { AuthorPage, type AuthorPageProps } from './AuthorPage'
import { conceptLabel, type Lesson, type LessonPack } from './lesson'
import { LessonPlayer } from './LessonPlayer'
import { MinePage, type MinePageProps } from './MinePage'
import type { MinedCandidate } from './mining'
import { bundledPacks, type LoadedPacks } from './packs'
import './lessons.css'

export interface LessonsPageProps {
  /** Packs to offer; defaults to the bundled ones. */
  packs?: LoadedPacks
  onSolved?: (pack: LessonPack, lesson: Lesson, outcome: DrillOutcome) => void
  /** Passed to the authoring tool (tests inject an engine). */
  author?: Omit<AuthorPageProps, 'packs' | 'pack' | 'onPackChange' | 'load'>
  /** Passed to the miner (tests inject a database and explorer client). */
  mine?: Omit<MinePageProps, 'onOpen'>
}

type Tab = 'play' | 'author' | 'mine'

const TABS: { id: Tab; label: string }[] = [
  { id: 'play', label: 'Play' },
  { id: 'author', label: 'Author' },
  { id: 'mine', label: 'Mine' },
]

function concepts(pack: LessonPack): string {
  return [...new Set(pack.lessons.map((l) => conceptLabel(l.concept)))].join(', ')
}

/** Play lesson packs, or author new ones. */
export function LessonsPage({ packs: packsProp, onSolved, author, mine }: LessonsPageProps) {
  const loaded = packsProp ?? bundledPacks()
  const [tab, setTab] = useState<Tab>('play')
  // Kept here so the pack being authored survives a trip to the miner.
  const [draft, setDraft] = useState<LessonPack>({ id: '', name: '', lessons: [] })
  const [load, setLoad] = useState<{ fen: string; concept: string; nonce: number }>()

  const open = (candidate: MinedCandidate) => {
    setLoad((l) => ({ fen: candidate.fen, concept: candidate.concept, nonce: (l?.nonce ?? 0) + 1 }))
    setTab('author')
  }

  return (
    <>
      <nav className="lessons-tabs" aria-label="Lessons">
        {TABS.map((t) => (
          <button key={t.id} type="button" aria-pressed={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
      {tab === 'play' && <PackPicker loaded={loaded} onSolved={onSolved} />}
      {tab === 'author' && (
        <AuthorPage
          {...author}
          packs={loaded.packs}
          pack={draft}
          onPackChange={setDraft}
          load={load}
        />
      )}
      {tab === 'mine' && <MinePage {...mine} onOpen={open} />}
    </>
  )
}

function PackPicker({
  loaded: { packs, errors },
  onSolved,
}: {
  loaded: LoadedPacks
  onSolved?: LessonsPageProps['onSolved']
}) {
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
            No packs yet. Export one from the Author tab and save it in
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
