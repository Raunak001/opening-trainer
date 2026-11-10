import { Chess } from 'chess.js'
import { describe, expect, it } from 'vitest'
import { CATALOG, catalogEntry, firstMove, type CatalogEntry } from '../catalog'
import { loadOpeningIndex } from '../openings'
import { positionKey } from '../positionKey'

/** Name of the deepest named position along the entry's start moves. */
async function tsvLabel(entry: CatalogEntry): Promise<string | undefined> {
  const index = await loadOpeningIndex()
  const chess = new Chess()
  let label: string | undefined
  for (const san of entry.startMoves) {
    chess.move(san)
    label = index.get(positionKey(chess.fen()))?.name ?? label
  }
  return label
}

describe('CATALOG', () => {
  it('has unique ids and the agreed list', () => {
    const ids = CATALOG.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(CATALOG.filter((e) => e.color === 'white')).toHaveLength(9)
    expect(CATALOG.filter((e) => e.color === 'black')).toHaveLength(9)
  })

  it.each(CATALOG.map((e): [string, CatalogEntry] => [e.id, e]))(
    '%s: legal start, TSV name, opponent to move',
    async (_id, entry) => {
      const chess = new Chess()
      for (const san of entry.startMoves) expect(chess.move(san).san).toBe(san)
      expect(entry.startMoves.length).toBeGreaterThan(0)
      expect(entry.blurb.length).toBeGreaterThan(20)
      // The course begins with the opponent to move: the start ends on the user's move.
      expect(chess.turn()).toBe(entry.color === 'white' ? 'b' : 'w')
      expect(await tsvLabel(entry)).toBe(entry.tsvName ?? entry.name)
    },
  )

  it('gives systems legal-looking setup moves', () => {
    const systems = CATALOG.filter((e) => e.forcedMoves)
    expect(systems.map((e) => e.id)).toEqual(['london', 'kia'])
    // The setup is playable in order against a quiet reply.
    const chess = new Chess()
    chess.move('d4')
    chess.move('d5')
    for (const san of catalogEntry('london')?.forcedMoves ?? []) {
      chess.move(san)
      chess.move(chess.moves()[0])
    }
  })

  it('looks entries up by id', () => {
    expect(catalogEntry('caro-kann')?.name).toBe('Caro-Kann Defense')
    expect(catalogEntry('nope')).toBeUndefined()
    expect(firstMove(catalogEntry('english') as CatalogEntry)).toBe('c4')
  })
})
