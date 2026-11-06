import { Chess } from 'chess.js'
import { describe, expect, it } from 'vitest'
import {
  buildOpeningIndex,
  labelTree,
  loadOpeningIndex,
  openingFor,
  parseOpeningsTsv,
  sansFromPgn,
  type Opening,
} from '../openings'
import { positionKey } from '../positionKey'
import { addMove, createTree, findBySan, type RepertoireTree } from '../tree'

const keyAfter = (sans: string) => {
  const chess = new Chess()
  for (const san of sans.split(' ').filter(Boolean)) chess.move(san)
  return positionKey(chess.fen())
}

function addLine(tree: RepertoireTree, sans: string) {
  let t = tree
  let key = t.rootKey
  for (const san of sans.split(' ')) {
    const r = addMove(t, key, san)
    t = r.tree
    key = r.node.key
  }
  return t
}

// Real rows from the bundled b.tsv / c.tsv.
const SAMPLE_TSV = [
  'eco\tname\tpgn',
  'B20\tSicilian Defense\t1. e4 c5',
  'B22\tSicilian Defense: Alapin Variation\t1. e4 c5 2. c3',
  '',
  'C50\tItalian Game\t1. e4 e5 2. Nf3 Nc6 3. Bc4',
].join('\n')

describe('parseOpeningsTsv', () => {
  it('reads rows and skips blank lines', () => {
    expect(parseOpeningsTsv(SAMPLE_TSV)).toEqual([
      { eco: 'B20', name: 'Sicilian Defense', pgn: '1. e4 c5' },
      { eco: 'B22', name: 'Sicilian Defense: Alapin Variation', pgn: '1. e4 c5 2. c3' },
      { eco: 'C50', name: 'Italian Game', pgn: '1. e4 e5 2. Nf3 Nc6 3. Bc4' },
    ])
  })

  it('accepts CRLF line endings', () => {
    expect(parseOpeningsTsv(SAMPLE_TSV.replaceAll('\n', '\r\n'))).toHaveLength(3)
  })

  it('rejects an unexpected header or malformed rows', () => {
    expect(() => parseOpeningsTsv('name\teco\tpgn\n')).toThrow(/header/)
    expect(() => parseOpeningsTsv('eco\tname\tpgn\nB20\tSicilian Defense')).toThrow(/Malformed/)
  })

  it('strips move numbers from PGN', () => {
    expect(sansFromPgn('1. e4 c5 2. Nf3 d6 10. O-O')).toEqual(['e4', 'c5', 'Nf3', 'd6', 'O-O'])
  })
})

describe('buildOpeningIndex', () => {
  it('keys each opening by its final position', () => {
    const index = buildOpeningIndex(parseOpeningsTsv(SAMPLE_TSV))
    expect(index.size).toBe(3)
    expect(index.get(keyAfter('e4 c5 c3'))?.name).toBe('Sicilian Defense: Alapin Variation')
    // Transposition: a different move order reaches the same named position.
    expect(index.get(keyAfter('Nf3 Nc6 e4 e5 Bc4'))?.name).toBe('Italian Game')
  })

  it('prefers the shortest line when two rows reach one position', () => {
    const rows: Opening[] = [
      { eco: 'X01', name: 'Long way', pgn: '1. Nf3 Nf6 2. Ng1 Ng8 3. e4' },
      { eco: 'B00', name: "King's Pawn Game", pgn: '1. e4' },
      { eco: 'X02', name: 'Also short', pgn: '1. e4' },
    ]
    expect(buildOpeningIndex(rows).get(keyAfter('e4'))?.name).toBe("King's Pawn Game")
  })

  it('names the opening when a line is illegal', () => {
    expect(() => buildOpeningIndex([{ eco: 'Z', name: 'Broken', pgn: '1. e4 e4' }])).toThrow(
      'Illegal move "e4" in opening "Broken" (1. e4 e4)',
    )
  })
})

describe('bundled Lichess openings', () => {
  it('loads every row with legal moves and one name per position', async () => {
    const index = await loadOpeningIndex()
    // 3,865 rows at the pinned commit, no two reaching the same position.
    expect(index.size).toBe(3865)
    expect(await loadOpeningIndex()).toBe(index) // cached
  })

  it.each([
    ['e4', 'B00', "King's Pawn Game"],
    ['e4 c5', 'B20', 'Sicilian Defense'],
    ['e4 c5 c3', 'B22', 'Sicilian Defense: Alapin Variation'],
    ['e4 e5 Nf3 Nc6 Bc4', 'C50', 'Italian Game'],
    ['e4 e5 d4 exd4 c3', 'C21', 'Danish Gambit'],
    ['e4 e6 d4 d5', 'C00', 'French Defense'],
    ['e4 c6 d4 d5', 'B12', 'Caro-Kann Defense'],
    ['d4 Nf6 c4', 'A50', 'Indian Defense: Normal Variation'],
    ['d4 Nf6 c4 e6 Nc3 Bb4', 'E20', 'Nimzo-Indian Defense'],
  ])('names 1.%s', async (line, eco, name) => {
    const index = await loadOpeningIndex()
    expect(index.get(keyAfter(line))).toMatchObject({ eco, name })
  })
})

describe('labelling tree nodes', () => {
  it('uses the exact name where there is one and inherits it otherwise', async () => {
    const index = await loadOpeningIndex()
    let tree = addLine(createTree(), 'e4 d5 exd5 Qxd5')
    tree = addLine(tree, 'e4 c5 c3')

    const labels = labelTree(tree, index)
    const at = (line: string) => labels[(findBySan(tree, line.split(' ')) ?? tree.nodes[''])?.key]

    expect(labels[tree.rootKey]).toBeUndefined() // the start position has no name
    expect(at('e4 d5')).toMatchObject({ exact: true, opening: { name: 'Scandinavian Defense' } })
    // 2.exd5 is unnamed: inherits from 1...d5.
    expect(at('e4 d5 exd5')).toMatchObject({
      exact: false,
      opening: { name: 'Scandinavian Defense' },
    })
    expect(at('e4 d5 exd5 Qxd5')?.opening.name).toBe('Scandinavian Defense: Mieses-Kotrč Variation')
    expect(at('e4 c5 c3')).toMatchObject({
      exact: true,
      opening: { eco: 'B22', name: 'Sicilian Defense: Alapin Variation' },
    })
  })

  it('openingFor agrees with labelTree for every node', async () => {
    const index = await loadOpeningIndex()
    let tree = addLine(createTree(), 'e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d4')
    tree = addLine(tree, 'Nf3 Nc6 e4 e5 Bc4 Nf6')
    const labels = labelTree(tree, index)
    for (const key of Object.keys(tree.nodes))
      expect(openingFor(tree, index, key)).toEqual(labels[key])
  })

  it('names a transposed node by its position, whatever the route', async () => {
    const index = await loadOpeningIndex()
    // Reach the Italian via 1.Nf3 first; the node is still the Italian Game.
    const tree = addLine(createTree(), 'Nf3 Nc6 e4 e5 Bc4')
    const italian = findBySan(tree, ['Nf3', 'Nc6', 'e4', 'e5', 'Bc4'])
    expect(italian?.key).toBe(keyAfter('e4 e5 Nf3 Nc6 Bc4'))
    expect(openingFor(tree, index, italian?.key ?? '')).toMatchObject({
      exact: true,
      opening: { name: 'Italian Game' },
    })
  })
})
