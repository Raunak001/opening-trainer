import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { MiniBoard } from '../board'
import { getDb, type TrainerDB } from '../db'
import { formatLine } from '../repertoire/builderForm'
import { firstMove, type CatalogEntry } from '../repertoire/catalog'
import { TIERS } from '../repertoire/courses'
import { fensAlong } from './moveRows'
import { loadLibrary, type LibraryItem } from './courseData'
import './library.css'

export interface LibraryPageProps {
  db?: TrainerDB
  /** Opens a catalog entry's course page. */
  onOpen: (entryId: string) => void
}

type ColorFilter = 'all' | 'white' | 'black'

const FIRST_MOVES = ['e4', 'd4', 'c4'] as const

/** Text the search box matches against. */
function haystack(entry: CatalogEntry): string {
  return `${entry.name} ${entry.blurb} ${formatLine(entry.startMoves)}`.toLowerCase()
}

/** The opening library: a card per catalog entry, with search and filters. */
export function LibraryPage({ db: dbProp, onOpen }: LibraryPageProps) {
  const db = dbProp ?? getDb()
  const items = useLiveQuery(() => loadLibrary(db, new Date()), [db])
  const [query, setQuery] = useState('')
  const [color, setColor] = useState<ColorFilter>('all')
  const [first, setFirst] = useState<string>('all')

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (items ?? []).filter(
      ({ entry }) =>
        (color === 'all' || entry.color === color) &&
        (first === 'all' || firstMove(entry) === first) &&
        (!q || haystack(entry).includes(q)),
    )
  }, [items, query, color, first])

  return (
    <main className="library">
      <header className="library__header">
        <h1>Opening library</h1>
        <div className="library__filters">
          <input
            type="search"
            aria-label="Search openings"
            placeholder="Search openings"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            aria-label="Color"
            value={color}
            onChange={(e) => setColor(e.target.value as ColorFilter)}
          >
            <option value="all">Both colors</option>
            <option value="white">White</option>
            <option value="black">Black</option>
          </select>
          <select aria-label="First move" value={first} onChange={(e) => setFirst(e.target.value)}>
            <option value="all">Any first move</option>
            {FIRST_MOVES.map((m) => (
              <option key={m} value={m}>
                1.{m}
              </option>
            ))}
          </select>
        </div>
      </header>
      {items === undefined ? (
        <p className="library__muted">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="library__muted">No openings match.</p>
      ) : (
        <ul className="library__grid">
          {shown.map((item) => (
            <LibraryCard key={item.entry.id} item={item} onOpen={onOpen} />
          ))}
        </ul>
      )}
    </main>
  )
}

function LibraryCard({ item, onOpen }: { item: LibraryItem; onOpen: (id: string) => void }) {
  const { entry, course, counts } = item
  const fen = useMemo(() => fensAlong(entry.startMoves).at(-1) as string, [entry.startMoves])
  const percent = counts && counts.lines > 0 ? Math.round((counts.learned / counts.lines) * 100) : 0
  return (
    <li className="library-card">
      <button
        type="button"
        className="library-card__button"
        aria-label={`${entry.name}, ${entry.color === 'white' ? 'White' : 'Black'}`}
        onClick={() => onOpen(entry.id)}
      >
        <MiniBoard fen={fen} orientation={entry.color} label={`${entry.name} start position`} />
        <span className="library-card__body">
          <span className="library-card__title">{entry.name}</span>
          <span className="library-card__meta">
            <span className={`library-card__color library-card__color--${entry.color}`}>
              {entry.color === 'white' ? 'White' : 'Black'}
            </span>
            <span className="library-card__moves">{formatLine(entry.startMoves)}</span>
          </span>
          <span className="library-card__blurb">{entry.blurb}</span>
          <span className="library-card__progress">
            <span className="library-card__progress-row">
              <span
                className="library-card__bar"
                role="meter"
                aria-label={`${entry.name} lines learned`}
                aria-valuemin={0}
                aria-valuemax={counts?.lines ?? 0}
                aria-valuenow={counts?.learned ?? 0}
              >
                <span style={{ width: `${percent}%` }} />
              </span>
              <span className="library-card__percent">{percent}%</span>
            </span>
            <span>
              {course && counts
                ? `${counts.learned}/${counts.lines} lines learned${course.tier ? ` · ${TIERS[course.tier].label}` : ''}`
                : 'Not started'}
              {counts && counts.due > 0 && (
                <span className="library-card__due"> · {counts.due} due</span>
              )}
            </span>
          </span>
        </span>
      </button>
    </li>
  )
}
