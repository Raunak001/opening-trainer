import { describe, expect, it, vi } from 'vitest'
import type { Engine, SearchResult } from '../../engine/engine'
import type { EvalCache } from '../../engine/evalCache'
import { analysisRow, analyzeGame } from '../analyze'
import { describeMove } from '../describe'
import { reviewGame } from '../classify'
import { DEFAULT_SETTINGS } from '../../db/settings'

/** Answers every position with two lines; the scores do not matter here. */
function twoLineEngine() {
  const searches: { fen: string; multiPv?: number }[] = []
  const engine: Engine = {
    ready: async () => {},
    async search(fen, options): Promise<SearchResult> {
      searches.push({ fen, multiPv: options.multiPv })
      const white = fen.split(' ')[1] === 'w'
      const [best, second] = white ? ['d1h5', 'g1f3'] : ['b8c6', 'g8f6']
      return {
        fen,
        bestMove: best,
        lines: [
          {
            depth: options.depth,
            multipv: 1,
            score: { type: 'cp', value: 20 },
            bound: 'exact',
            pv: [best],
          },
          {
            depth: options.depth,
            multipv: 2,
            score: { type: 'cp', value: 0 },
            bound: 'exact',
            pv: [second],
          },
        ],
      }
    },
    cancel: () => {},
    setOption: async () => {},
    dispose: () => {},
  }
  return { engine, searches }
}

describe('analyzeGame', () => {
  it('searches every non-terminal position with two lines and caches the best', async () => {
    const { engine, searches } = twoLineEngine()
    const put = vi.fn<EvalCache['put']>(async () => {})
    const cache: EvalCache = { get: async () => undefined, put }
    const progress: number[] = []
    const sans = ['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#']
    const evals = await analyzeGame(engine, sans, {
      depth: 10,
      cache,
      onProgress: (done) => progress.push(done),
    })

    expect(evals).toHaveLength(8)
    expect(searches).toHaveLength(7) // the mated position is scored from the board
    expect(searches.every((s) => s.multiPv === 2)).toBe(true)
    expect(evals[7]).toEqual({ score: { type: 'mate', value: 0 }, best: null, pv: [] })
    expect(evals[0].second).toEqual({ move: 'g1f3', score: { type: 'cp', value: 0 } })
    expect(put).toHaveBeenCalledTimes(7)
    expect(progress).toEqual([1, 2, 3, 4, 5, 6, 7, 8])

    const row = analysisRow('g1', sans, evals, 10, 123)
    expect(row.gameId).toBe('g1')
    expect(row.accuracy.white).toBeGreaterThan(0)
  })

  it('describes a reviewed blunder with the better move', async () => {
    const sans = ['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#']
    const cp = (value: number, best: string) => ({
      score: { type: 'cp' as const, value },
      best,
      pv: [best],
    })
    const evals = [
      cp(30, 'e2e4'),
      cp(-30, 'e7e5'),
      cp(30, 'g1f3'),
      cp(0, 'b8c6'),
      cp(0, 'f1c4'),
      cp(0, 'g7g6'),
      { score: { type: 'mate' as const, value: 1 }, best: 'h5f7', pv: ['h5f7'] },
      { score: { type: 'mate' as const, value: 0 }, best: null, pv: [] },
    ]
    const review = reviewGame(sans, evals, { thresholds: DEFAULT_SETTINGS.analysis, book: 2 })
    const comment = describeMove(review.moves[5], evals[5], evals[6], sans)
    expect(comment.headline).toBe('Nf6 is a blunder')
    expect(comment.evalText).toBe('#1')
    expect(comment.lines.join(' ')).toMatch(/g6/)
  })
})
