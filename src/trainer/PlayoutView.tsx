import { useEffect, useState } from 'react'
import { Board } from '../board'
import { getSettings, type AppSettings, type TrainerDB } from '../db'
import { createOpponentEngine, type Engine } from '../engine'
import type { Side } from './drill'
import type { MoveExplainer } from './explainer'
import { SidePanel } from './SidePanel'
import { TrainerLayout } from './TrainerLayout'
import { usePlayout } from './usePlayout'

export interface PlayoutViewProps {
  db: TrainerDB
  fen: string
  userSide: Side
  lineStartFen: string
  lineMoves: readonly string[]
  explain: MoveExplainer
  /** Tests inject a fake opponent. */
  opponent?: (skillLevel: number) => Promise<Engine>
}

type Ready = { engine: Engine; settings: AppSettings['playout'] }

/** Play on from the end of a line against a weakened Stockfish, grading every move. */
export function PlayoutView({ db, opponent = createOpponentEngine, ...rest }: PlayoutViewProps) {
  const [ready, setReady] = useState<Ready>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    let live = true
    let engine: Engine | undefined
    ;(async () => {
      const { playout } = await getSettings(db)
      engine = await opponent(playout.skillLevel)
      if (live) setReady({ engine, settings: playout })
      else engine.dispose()
    })().catch((err: unknown) => live && setError(err instanceof Error ? err.message : String(err)))
    return () => {
      live = false
      engine?.dispose()
    }
  }, [db, opponent])

  if (error) return <p className="drill-controls">Could not start Stockfish: {error}</p>
  if (!ready) return <p className="drill-controls">Starting Stockfish…</p>
  return <PlayoutBoard {...rest} engine={ready.engine} settings={ready.settings} />
}

function PlayoutBoard({
  engine,
  settings,
  fen,
  userSide,
  lineStartFen,
  lineMoves,
  explain,
}: Omit<PlayoutViewProps, 'db' | 'opponent'> & {
  engine: Engine
  settings: AppSettings['playout']
}) {
  const { board, panel } = usePlayout({
    fen,
    userSide,
    lineStartFen,
    lineMoves,
    explain,
    opponent: engine,
    userMoves: settings.userMoves,
    depth: settings.depth,
  })
  return (
    <TrainerLayout>
      <Board {...board} />
      <SidePanel {...panel} />
    </TrainerLayout>
  )
}
