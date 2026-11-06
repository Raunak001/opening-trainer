import { useState } from 'react'
import { Board } from '../board'
import type { Line } from './drill'
import { SAMPLE_LINES } from './sampleLines'
import { SidePanel } from './SidePanel'
import { TrainerLayout } from './TrainerLayout'
import { useDrill } from './useDrill'

function Drill({ line }: { line: Line }) {
  const { board, panel, restart } = useDrill(line)
  return (
    <>
      <TrainerLayout>
        <Board {...board} />
        <SidePanel {...panel} />
      </TrainerLayout>
      <div className="drill-controls">
        <button type="button" onClick={restart}>
          Restart
        </button>
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
