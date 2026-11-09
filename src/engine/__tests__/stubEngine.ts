import type { Engine, SearchResult } from '../engine'
import { positionKey } from '../../repertoire/positionKey'
import type { Score } from '../uci'

export interface StubEval {
  score: Score
  pv: string[]
}

/** Engine that answers from a table keyed by position key and counts searches. */
export function stubEngine(table: Record<string, StubEval>) {
  const searched: string[] = []
  const engine: Engine = {
    ready: async () => {},
    async search(fen, options): Promise<SearchResult> {
      searched.push(fen)
      const entry = table[positionKey(fen)]
      if (!entry) throw new Error(`stubEngine: no eval for ${fen}`)
      return {
        fen,
        bestMove: entry.pv[0],
        lines: [
          { depth: options.depth, multipv: 1, score: entry.score, bound: 'exact', pv: entry.pv },
        ],
      }
    },
    cancel: () => {},
    setOption: async () => {},
    dispose: () => {},
  }
  return { engine, searched }
}
