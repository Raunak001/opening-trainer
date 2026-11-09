import { Chess } from 'chess.js'
import { describe, expect, it } from 'vitest'
import type { EvalCache, PositionEval } from '../../engine/evalCache'
import { stubEngine, type StubEval } from '../../engine/__tests__/stubEngine'
import { positionKey } from '../../repertoire/positionKey'
import type { MinedCandidate } from '../mining'
import { verifyCandidate, verifyCandidates } from '../verify'
import { CENTER, fenAfter } from './fixtures'

function memoryCache(): EvalCache {
  const rows = new Map<string, PositionEval>()
  return {
    get: async (pk, minDepth) => {
      const row = rows.get(pk)
      return row && row.depth >= minDepth ? row : undefined
    },
    put: async (e) => void rows.set(e.positionKey, e),
  }
}

const after = (fen: string, san: string) => positionKey(new Chess(fen).move(san).after)
const cp = (value: number, pv: string[]): StubEval => ({ score: { type: 'cp', value }, pv })

// Italian, 4...Nf6: say Stockfish prefers O-O (+0.5); d4 keeps +0.3, b4 drops to -0.6.
const TABLE: Record<string, StubEval> = {
  [positionKey(CENTER.fen)]: cp(50, ['e1g1']),
  [after(CENTER.fen, 'd4')]: cp(-30, ['e5d4']),
  [after(CENTER.fen, 'b4')]: cp(60, ['c5b6']),
}

const OPTIONS = { depth: 12, withinCp: 30 }

describe('verifyCandidate', () => {
  it('measures each concept move against the best', async () => {
    const { engine } = stubEngine(TABLE)
    const verdict = await verifyCandidate(
      engine,
      memoryCache(),
      { fen: CENTER.fen, moves: ['b4', 'd4'] },
      OPTIONS,
    )
    expect(verdict).toEqual({
      bestSan: 'O-O',
      bestScore: { type: 'cp', value: 50 },
      moves: [
        { san: 'd4', lossCp: 20 },
        { san: 'b4', lossCp: 110 },
      ],
      ok: true,
    })
  })

  it('fails when no concept move is close enough', async () => {
    const { engine } = stubEngine(TABLE)
    const verdict = await verifyCandidate(
      engine,
      memoryCache(),
      { fen: CENTER.fen, moves: ['d4'] },
      { ...OPTIONS, withinCp: 10 },
    )
    expect(verdict.ok).toBe(false)
  })

  it('does not search the position after the best move', async () => {
    const { engine, searched } = stubEngine({ [positionKey(CENTER.fen)]: cp(40, ['d2d4']) })
    const verdict = await verifyCandidate(
      engine,
      memoryCache(),
      { fen: CENTER.fen, moves: ['d4'] },
      OPTIONS,
    )
    expect(verdict.moves).toEqual([{ san: 'd4', lossCp: 0 }])
    expect(searched).toHaveLength(1)
  })

  it('caps the loss when a forced mate is thrown away', async () => {
    const fen = fenAfter('e4 e5 Bc4 Nc6 Qh5 Nf6')
    const { engine } = stubEngine({
      [positionKey(fen)]: { score: { type: 'mate', value: 1 }, pv: ['h5f7'] },
      [after(fen, 'd3')]: cp(-50, ['f6h5']),
    })
    const verdict = await verifyCandidate(engine, memoryCache(), { fen, moves: ['d3'] }, OPTIONS)
    expect(verdict.moves).toEqual([{ san: 'd3', lossCp: 2000 }])
  })
})

describe('verifyCandidates', () => {
  const candidate = (id: string, concept: MinedCandidate['concept'], moves: string[]) =>
    ({ id, concept, fen: CENTER.fen, moves }) as MinedCandidate

  it('keeps passing candidates in order and stops per concept', async () => {
    const { engine, searched } = stubEngine(TABLE)
    const checked: number[] = []
    const out = await verifyCandidates(
      engine,
      memoryCache(),
      [
        candidate('a', 'strike-center', ['b4']),
        candidate('b', 'strike-center', ['d4']),
        candidate('c', 'strike-center', ['d4']),
        candidate('d', 'castle-early', ['O-O']),
      ],
      { ...OPTIONS, wantPerConcept: 1, maxChecksPerConcept: 5, onProgress: (n) => checked.push(n) },
    )
    expect(out.map((c) => c.id)).toEqual(['b', 'd'])
    expect(out[0].verdict.moves).toEqual([{ san: 'd4', lossCp: 20 }])
    expect(checked).toEqual([1, 2, 3])
    // Evals are cached: three positions searched once each.
    expect(searched).toHaveLength(3)
  })

  it('gives up on a concept after maxChecksPerConcept', async () => {
    const { engine } = stubEngine(TABLE)
    const out = await verifyCandidates(
      engine,
      memoryCache(),
      [candidate('a', 'strike-center', ['b4']), candidate('b', 'strike-center', ['d4'])],
      { ...OPTIONS, wantPerConcept: 5, maxChecksPerConcept: 1 },
    )
    expect(out).toEqual([])
  })
})
