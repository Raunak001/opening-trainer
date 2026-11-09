import { describe, expect, it } from 'vitest'
import { bundledPacks, loadPacks } from '../packs'
import { PACK, QUEEN } from './fixtures'

describe('loadPacks', () => {
  it('keeps valid packs sorted by file name and reports broken ones', () => {
    const { packs, errors } = loadPacks({
      './packs/b.json': { ...PACK, id: 'second', lessons: [{ ...QUEEN, id: 'q-2' }] },
      './packs/a.json': PACK,
      './packs/c.json': { id: 'broken' },
    })
    expect(packs.map((p) => p.id)).toEqual(['test-pack', 'second'])
    expect(errors).toEqual([
      'c.json: pack: "name" must be a non-empty string',
      'c.json: pack: "lessons" must be a non-empty list',
    ])
  })

  it('rejects a repeated pack id and repeated lesson ids', () => {
    const { packs, errors } = loadPacks({
      'a.json': PACK,
      'b.json': PACK,
      'c.json': { ...PACK, id: 'other' },
    })
    expect(packs.map((p) => p.id)).toEqual(['test-pack', 'other'])
    expect(errors).toEqual([
      'b.json: pack id "test-pack" is used twice',
      'lesson "center-01" is in both "test-pack" and "other"',
      'lesson "queen-01" is in both "test-pack" and "other"',
    ])
  })

  it('loads the bundled packs without errors', () => {
    expect(bundledPacks().errors).toEqual([])
  })
})
