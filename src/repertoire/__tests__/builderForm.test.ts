import { describe, expect, it } from 'vitest'
import type { RepertoireRow } from '../../db'
import {
  bucketsInBand,
  bucketUpperLabel,
  DEFAULT_FORM,
  formatLine,
  formFromRow,
  parseStartMoves,
  validateForm,
  type BuilderForm,
} from '../builderForm'
import { DEFAULT_PRUNE_SETTINGS } from '../prune'
import { createTree } from '../tree'

const form = (patch: Partial<BuilderForm>): BuilderForm => ({
  ...DEFAULT_FORM,
  name: 'Test',
  ...patch,
})

describe('parseStartMoves', () => {
  it('accepts SAN with or without move numbers', () => {
    const expected = { ok: true, sans: ['e4', 'e5', 'Nf3', 'Nc6'] }
    expect(parseStartMoves('1.e4 e5 2.Nf3 Nc6')).toEqual(expected)
    expect(parseStartMoves('1. e4 e5 2. Nf3 Nc6')).toEqual(expected)
    expect(parseStartMoves('e4 e5 Nf3 Nc6')).toEqual(expected)
    expect(parseStartMoves('  e4,e5 ,Nf3  Nc6 ')).toEqual(expected)
  })

  it('handles black-move numbering and normalises SAN', () => {
    expect(parseStartMoves('1.d4 1...Nf6 2.c4')).toEqual({ ok: true, sans: ['d4', 'Nf6', 'c4'] })
    // chess.js accepts the long form and returns canonical SAN.
    expect(parseStartMoves('Ng1f3')).toEqual({ ok: true, sans: ['Nf3'] })
  })

  it('treats empty input as the initial position', () => {
    expect(parseStartMoves('')).toEqual({ ok: true, sans: [] })
  })

  it('names the illegal move and where it happened', () => {
    expect(parseStartMoves('1.e4 e5 2.Ke3')).toEqual({
      ok: false,
      error: '"Ke3" is not a legal move after 1.e4 e5.',
    })
    expect(parseStartMoves('e5')).toEqual({ ok: false, error: '"e5" is not a legal move.' })
  })
})

describe('rating buckets', () => {
  it('labels the top of each bucket', () => {
    expect(bucketUpperLabel(1600)).toBe('1799')
    expect(bucketUpperLabel(400)).toBe('999')
    expect(bucketUpperLabel(2500)).toBe('and up')
  })

  it('expands a band into every bucket inside it', () => {
    expect(bucketsInBand(1600, 1800)).toEqual([1600, 1800])
    expect(bucketsInBand(1200, 2000)).toEqual([1200, 1400, 1600, 1800, 2000])
    expect(bucketsInBand(2000, 1600)).toEqual([])
  })
})

describe('validateForm', () => {
  it('turns the defaults into build options', () => {
    const r = validateForm(form({}))
    expect(r).toEqual({
      ok: true,
      value: {
        id: undefined,
        name: 'Test',
        color: 'white',
        startMoves: ['e4'],
        speeds: ['blitz', 'rapid'],
        ratings: [1600, 1800],
        settings: DEFAULT_PRUNE_SETTINGS,
        overrides: {},
        extraMoves: {},
        forcedMoves: [],
      },
    })
  })

  it('converts percentages and keeps speeds in canonical order', () => {
    const r = validateForm(
      form({ coverage: '90', floor: '2.5', maxPly: '10', speeds: ['rapid', 'bullet'] }),
    )
    expect(r.ok && r.value.settings).toMatchObject({
      opponentCoverage: 0.9,
      opponentMinShare: 0.025,
      maxPly: 10,
    })
    expect(r.ok && r.value.speeds).toEqual(['bullet', 'rapid'])
  })

  it('reports every invalid field at once', () => {
    const r = validateForm(
      form({
        name: '  ',
        startMoves: '1.e4 e4',
        ratingMin: 2000,
        ratingMax: 1600,
        speeds: [],
        coverage: '',
        floor: '-1',
        maxPly: '2.5',
      }),
    )
    expect(r.ok).toBe(false)
    expect(!r.ok && Object.keys(r.errors).sort()).toEqual(
      ['coverage', 'floor', 'maxPly', 'name', 'rating', 'speeds', 'startMoves'].sort(),
    )
  })

  it('requires the floor to be below the coverage target', () => {
    const r = validateForm(form({ coverage: '5', floor: '5' }))
    expect(!r.ok && r.errors).toEqual({ floor: 'The floor must be below the coverage target.' })
  })

  it('requires depth beyond the start moves', () => {
    const r = validateForm(form({ startMoves: '1.e4 e5 2.Nf3', maxPly: '3' }))
    expect(!r.ok && r.errors.maxPly).toBe('Depth must be more than the 3 start plies.')
    expect(validateForm(form({ startMoves: '1.e4 e5 2.Nf3', maxPly: '4' })).ok).toBe(true)
  })
})

describe('formFromRow', () => {
  it('round-trips a saved repertoire through the form', () => {
    const row: RepertoireRow = {
      id: 'abc',
      name: 'Sicilian',
      color: 'black',
      startMoves: ['e4', 'c5'],
      speeds: ['rapid'],
      ratings: [1800, 1400, 1600],
      settings: { userMinShare: 0.07, opponentCoverage: 0.9, opponentMinShare: 0.02, maxPly: 9 },
      overrides: { 'some-key': 'Nf3' },
      rootKey: createTree().rootKey,
      positionCount: 1,
      createdAt: 1,
      updatedAt: 2,
    }
    const f = formFromRow(row)
    expect(f).toMatchObject({
      id: 'abc',
      startMoves: '1.e4 c5',
      ratingMin: 1400,
      ratingMax: 1800,
      coverage: '90',
      floor: '2',
      maxPly: '9',
      userMinShare: 0.07,
    })
    const r = validateForm(f)
    expect(r.ok && r.value).toMatchObject({
      id: 'abc',
      name: 'Sicilian',
      color: 'black',
      startMoves: ['e4', 'c5'],
      ratings: [1400, 1600, 1800],
      settings: row.settings,
      overrides: { 'some-key': 'Nf3' },
    })
  })

  it('formats lines with move numbers', () => {
    expect(formatLine(['d4', 'Nf6', 'c4'])).toBe('1.d4 Nf6 2.c4')
    expect(formatLine([])).toBe('')
  })
})
