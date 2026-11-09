import { describe, expect, it } from 'vitest'
import { parseBestMove, parseInfo, toWhitePov } from '../uci'

// Lines captured from Stockfish 19 lite (single-threaded) output.
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
const AFTER_E4_FEN = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'

describe('parseInfo', () => {
  it('parses a cp line with pv and stats', () => {
    const line =
      'info depth 12 seldepth 17 multipv 1 score cp 31 nodes 84213 nps 702775 hashfull 31 tbhits 0 time 120 pv e2e4 e7e5 g1f3 b8c6 f1b5'
    expect(parseInfo(line)).toEqual({
      depth: 12,
      seldepth: 17,
      multipv: 1,
      score: { type: 'cp', value: 31 },
      bound: 'exact',
      pv: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5'],
      nodes: 84213,
      nps: 702775,
      timeMs: 120,
    })
  })

  it('parses a negative mate score', () => {
    // Side to move gets mated next move.
    const line =
      'info depth 245 seldepth 2 multipv 1 score mate -1 nodes 20 nps 10000 time 2 pv h2h3'
    const info = parseInfo(line)
    expect(info?.score).toEqual({ type: 'mate', value: -1 })
    expect(info?.pv).toEqual(['h2h3'])
  })

  it('parses multipv index and bounds', () => {
    const lower = parseInfo(
      'info depth 9 seldepth 12 multipv 2 score cp 25 lowerbound nodes 9000 nps 500000 time 18 pv d2d4',
    )
    expect(lower?.multipv).toBe(2)
    expect(lower?.bound).toBe('lower')
    expect(lower?.score).toEqual({ type: 'cp', value: 25 })

    const upper = parseInfo('info depth 9 score cp -40 upperbound pv e7e5')
    expect(upper?.bound).toBe('upper')
    expect(upper?.score.value).toBe(-40)
    expect(upper?.multipv).toBe(1)
  })

  it('ignores lines without a score or pv', () => {
    expect(parseInfo('info string NNUE evaluation using nn-61e7af4bb97d.nnue enabled')).toBeNull()
    expect(parseInfo('info depth 10 currmove e2e4 currmovenumber 1')).toBeNull()
    expect(
      parseInfo('info depth 1 seldepth 1 multipv 1 score cp 18 nodes 20 nps 10000 time 2'),
    ).toBeNull()
    expect(parseInfo('info depth 0 score mate 0')).toBeNull()
    expect(parseInfo('bestmove e2e4')).toBeNull()
    expect(parseInfo('')).toBeNull()
  })

  it('does not treat words inside info string as fields', () => {
    expect(parseInfo('info string depth 5 score cp 10 pv e2e4')).toBeNull()
  })
})

describe('parseBestMove', () => {
  it('parses move and ponder', () => {
    expect(parseBestMove('bestmove e2e4 ponder e7e5')).toEqual({ move: 'e2e4', ponder: 'e7e5' })
  })

  it('parses a promotion without ponder', () => {
    expect(parseBestMove('bestmove a7a8q')).toEqual({ move: 'a7a8q' })
  })

  it('returns null move when there is no legal move', () => {
    expect(parseBestMove('bestmove (none)')).toEqual({ move: null })
  })

  it('ignores other lines', () => {
    expect(parseBestMove('readyok')).toBeNull()
    expect(parseBestMove('bestmove')).toBeNull()
  })
})

describe('toWhitePov', () => {
  it('keeps White-to-move scores', () => {
    expect(toWhitePov({ type: 'cp', value: 31 }, START_FEN)).toEqual({ type: 'cp', value: 31 })
  })

  it('negates Black-to-move scores', () => {
    expect(toWhitePov({ type: 'cp', value: -28 }, AFTER_E4_FEN)).toEqual({ type: 'cp', value: 28 })
    expect(toWhitePov({ type: 'mate', value: 3 }, AFTER_E4_FEN)).toEqual({
      type: 'mate',
      value: -3,
    })
    expect(toWhitePov({ type: 'cp', value: 0 }, AFTER_E4_FEN)).toEqual({ type: 'cp', value: 0 })
  })
})
