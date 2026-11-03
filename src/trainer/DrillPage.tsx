import { useState } from 'react'
import { Board } from '../board'
import type { Line, Side } from './drill'
import { italianLine } from './sampleLines'
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

/** Drill a hardcoded line; pick a side to restart as that color. */
export function DrillPage() {
  const [side, setSide] = useState<Side>('white')
  const line = italianLine(side)
  return (
    <>
      {/* Keyed so switching side starts a fresh drill. */}
      <Drill key={line.id} line={line} />
      <div className="drill-controls" role="group" aria-label="Play as">
        <button type="button" aria-pressed={side === 'white'} onClick={() => setSide('white')}>
          Play White
        </button>
        <button type="button" aria-pressed={side === 'black'} onClick={() => setSide('black')}>
          Play Black
        </button>
      </div>
    </>
  )
}
