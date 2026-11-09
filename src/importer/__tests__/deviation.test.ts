import { describe, expect, it } from 'vitest'
import { buildRepertoire } from '../../repertoire/builder'
import { DEFAULT_PRUNE_SETTINGS, type Color } from '../../repertoire/prune'
import { fakeClient, keyAfter, world, type Row } from '../../repertoire/__tests__/fakeWorld'
import { parsePgnMoves } from '../games'
import {
  describeDeviation,
  detectDeviation,
  matchGame,
  plyLabel,
  type RepertoireForMatch,
} from '../deviation'
import { chesscomPgn } from './fixtures'

async function rep(
  id: string,
  color: Color,
  startMoves: string[],
  spec: Record<string, Row[]>,
  maxPly = 4,
): Promise<RepertoireForMatch> {
  const { tree } = await buildRepertoire({
    color,
    startMoves,
    speeds: ['blitz'],
    ratings: [1600],
    settings: { ...DEFAULT_PRUNE_SETTINGS, maxPly },
    client: fakeClient(world(spec)).client,
  })
  return { id, color, startMoves, tree }
}

// 1.e4 for White: e5 and c5 kept; after 2.Nf3 Nc6 / 2…d6 the user plays Bc4 / d4.
const ITALIAN = {
  '': [['e4', 50, 10, 40]],
  e4: [
    ['e5', 30, 10, 20],
    ['c5', 15, 5, 10],
  ],
  'e4 e5': [['Nf3', 50, 10, 40]],
  'e4 c5': [['Nf3', 50, 10, 40]],
  'e4 e5 Nf3': [
    ['Nc6', 40, 10, 30],
    ['d6', 8, 2, 5],
  ],
  'e4 c5 Nf3': [['d6', 30, 10, 30]],
  'e4 e5 Nf3 Nc6': [
    ['Bc4', 40, 10, 30],
    ['Bb5', 30, 10, 30],
  ],
  'e4 e5 Nf3 d6': [['d4', 40, 10, 30]],
  'e4 c5 Nf3 d6': [['d4', 40, 10, 30]],
} satisfies Record<string, Row[]>

/** Moves of a chess.com PGN, as stored at import. */
const movesOf = (line: string) => parsePgnMoves(chesscomPgn(line)) as string[]

describe('detectDeviation', () => {
  it('finds the user leaving book, with the repertoire move', async () => {
    const r = await rep('w', 'white', ['e4'], ITALIAN)
    const d = detectDeviation(movesOf('e4 e5 Nf3 Nc6 Bb5 a6'), r)
    expect(d).toEqual({
      kind: 'user',
      ply: 4,
      positionKey: keyAfter('e4 e5 Nf3 Nc6'),
      fen: expect.stringMatching(/^r1bqkbnr\/pppp1ppp\/2n5/),
      expected: 'Bc4',
      played: 'Bb5',
    })
    expect(describeDeviation(d, movesOf('e4 e5 Nf3 Nc6 Bb5'))).toBe(
      'You left book: 3.Bb5 (repertoire: Bc4)',
    )
  })

  it('finds the opponent leaving book', async () => {
    const r = await rep('w', 'white', ['e4'], ITALIAN)
    const d = detectDeviation(movesOf('e4 e5 Nf3 Nf6 Nxe5'), r)
    expect(d).toMatchObject({
      kind: 'opponent',
      ply: 3,
      positionKey: keyAfter('e4 e5 Nf3'),
      played: 'Nf6',
    })
    expect(describeDeviation(d, [])).toBe('Opponent left book: 2…Nf6')
  })

  it('a game that runs past a leaf stayed in book', async () => {
    const r = await rep('w', 'white', ['e4'], ITALIAN)
    const sans = movesOf('e4 c5 Nf3 d6 d4 cxd4')
    const d = detectDeviation(sans, r)
    expect(d).toEqual({ kind: 'endOfBook', ply: 5, positionKey: keyAfter('e4 c5 Nf3 d6 d4') })
    expect(describeDeviation(d, sans)).toBe('In book to the end of the line (3…cxd4 is past it)')
  })

  it('a game that ends in book', async () => {
    const r = await rep('w', 'white', ['e4'], ITALIAN)
    expect(detectDeviation(movesOf('e4 e5 Nf3'), r)).toEqual({ kind: 'gameOver', ply: 3 })
  })

  it('leaving during the start moves is a different opening, by either side', async () => {
    const white = await rep('w', 'white', ['e4'], ITALIAN)
    expect(detectDeviation(movesOf('d4 d5'), white)).toEqual({ kind: 'outside', ply: 0 })
    const sicilian = await rep('b', 'black', ['e4', 'c5'], {
      '': [['e4', 50, 10, 40]],
      e4: [['c5', 40, 10, 50]],
      'e4 c5': [['Nf3', 40, 10, 50]],
      'e4 c5 Nf3': [['d6', 40, 10, 50]],
    })
    expect(detectDeviation(movesOf('d4 Nf6'), sicilian)).toEqual({ kind: 'outside', ply: 0 })
    expect(detectDeviation(movesOf('e4 e5'), sicilian)).toEqual({ kind: 'outside', ply: 1 })
    expect(detectDeviation(movesOf('e4 c5 c3'), sicilian)).toMatchObject({
      kind: 'opponent',
      ply: 2,
      played: 'c3',
    })
  })

  it('follows a transposed move order through merged positions', async () => {
    // Black repertoire where 1.Nf3 d5 2.d4 and 1.d4 d5 2.Nf3 reach one node.
    const r = await rep(
      'b',
      'black',
      [],
      {
        '': [
          ['d4', 50, 10, 40],
          ['Nf3', 40, 10, 50],
        ],
        d4: [['d5', 40, 10, 50]],
        Nf3: [['d5', 40, 10, 50]],
        'd4 d5': [['Nf3', 40, 10, 50]],
        'Nf3 d5': [['d4', 40, 10, 50]],
        'd4 d5 Nf3': [['Nf6', 40, 10, 50]],
      },
      4,
    )
    expect(detectDeviation(movesOf('Nf3 d5 d4 Nf6 c4'), r)).toEqual({
      kind: 'endOfBook',
      ply: 4,
      positionKey: keyAfter('d4 d5 Nf3 Nf6'),
    })
    expect(detectDeviation(movesOf('Nf3 d5 d4 e6'), r)).toMatchObject({
      kind: 'user',
      ply: 3,
      expected: 'Nf6',
    })
  })
})

describe('matchGame', () => {
  it("uses the user's color and the repertoire followed longest", async () => {
    const white = await rep('w', 'white', ['e4'], ITALIAN)
    const vsE4 = await rep('e4', 'black', ['e4', 'e5'], {
      '': [['e4', 50, 10, 40]],
      e4: [['e5', 40, 10, 50]],
      'e4 e5': [['Nf3', 40, 10, 50]],
      'e4 e5 Nf3': [['Nc6', 40, 10, 50]],
    })
    const vsD4 = await rep('d4', 'black', ['d4', 'd5'], {
      '': [['d4', 50, 10, 40]],
      d4: [['d5', 40, 10, 50]],
      'd4 d5': [['c4', 40, 10, 50]],
      'd4 d5 c4': [['e6', 40, 10, 50]],
    })
    const reps = [white, vsE4, vsD4]
    expect(matchGame(movesOf('d4 d5 c4 c6'), 'black', reps)).toMatchObject({
      repertoireId: 'd4',
      deviation: { kind: 'user', ply: 3, expected: 'e6' },
    })
    expect(matchGame(movesOf('e4 e5 Nf3 Nc6'), 'black', reps)?.repertoireId).toBe('e4')
    expect(matchGame(movesOf('c4 e5'), 'black', reps)?.deviation.kind).toBe('outside')
    expect(matchGame(movesOf('e4 e5'), 'white', [vsE4])).toBeUndefined()
  })
})

describe('plyLabel', () => {
  it('numbers moves for both sides', () => {
    expect(plyLabel(0, 'e4')).toBe('1.e4')
    expect(plyLabel(1, 'e5')).toBe('1…e5')
    expect(plyLabel(10, 'O-O')).toBe('6.O-O')
  })
})
