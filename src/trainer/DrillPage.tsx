import { Chess } from 'chess.js'
import { useMemo, useState } from 'react'
import { Board } from '../board'
import { getDb } from '../db'
import type { Line } from './drill'
import { createMoveExplainer } from './explainer'
import { PlayoutView } from './PlayoutView'
import { SAMPLE_LINES } from './sampleLines'
import { SidePanel } from './SidePanel'
import { TrainerLayout } from './TrainerLayout'
import { useDrill } from './useDrill'

function Drill({ line }: { line: Line }) {
  const db = getDb()
  const explain = useMemo(() => createMoveExplainer(db), [db])
  const { drill, board, panel, restart } = useDrill(line, { explain })
  const [playingOut, setPlayingOut] = useState(false)
  const complete = drill.status === 'complete'
  const gameOver = complete && new Chess(drill.fen).isGameOver()

  const again = () => {
    setPlayingOut(false)
    restart()
  }

  return (
    <>
      {playingOut ? (
        <PlayoutView
          db={db}
          fen={drill.fen}
          userSide={line.side}
          lineStartFen={line.startFen ?? new Chess().fen()}
          lineMoves={drill.steps.map((s) => s.san)}
          explain={explain}
        />
      ) : (
        <TrainerLayout>
          <Board {...board} />
          <SidePanel {...panel} />
        </TrainerLayout>
      )}
      <div className="drill-controls">
        <button type="button" onClick={again}>
          Restart
        </button>
        {complete && !gameOver && !playingOut && (
          <button type="button" onClick={() => setPlayingOut(true)}>
            Play on vs Stockfish
          </button>
        )}
      </div>
    </>
  )
}

const label = (line: Line) => `${line.name} (${line.side === 'white' ? 'White' : 'Black'})`

/** Drill one of the hardcoded lines. */
export function DrillPage() {
  const [lineId, setLineId] = useState(SAMPLE_LINES[0].id)
  const line = SAMPLE_LINES.find((l) => l.id === lineId) ?? SAMPLE_LINES[0]
  return (
    <>
      {/* Keyed so picking another line starts a fresh drill. */}
      <Drill key={line.id} line={line} />
      <div className="drill-controls">
        <label>
          Line{' '}
          <select value={line.id} onChange={(e) => setLineId(e.target.value)}>
            {SAMPLE_LINES.map((l) => (
              <option key={l.id} value={l.id}>
                {label(l)}
              </option>
            ))}
          </select>
        </label>
      </div>
    </>
  )
}
