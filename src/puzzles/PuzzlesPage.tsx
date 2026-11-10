import { useState } from 'react'
import { PuzzleHistory } from './PuzzleHistory'
import { PuzzleSolver } from './PuzzleSolver'
import './puzzles.css'

type Tab = 'solve' | 'history'

/** Rated puzzles from the bundled Lichess set, plus history and stats. */
export function PuzzlesPage() {
  const [tab, setTab] = useState<Tab>('solve')
  return (
    <div className="puzzles">
      <nav className="app-nav app-nav--sub" aria-label="Puzzles">
        {(
          [
            ['solve', 'Solve'],
            ['history', 'History'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-current={tab === id ? 'page' : undefined}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      {tab === 'solve' ? <PuzzleSolver /> : <PuzzleHistory onSolve={() => setTab('solve')} />}
    </div>
  )
}
