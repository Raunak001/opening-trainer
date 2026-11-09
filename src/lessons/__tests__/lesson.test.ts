import { describe, expect, it } from 'vitest'
import {
  conceptLabel,
  duplicateLessonIds,
  lessonSide,
  validateLesson,
  validatePack,
} from '../lesson'
import { CENTER, fenAfter, PACK, QUEEN } from './fixtures'

describe('validateLesson', () => {
  it('accepts a valid lesson and normalizes SAN', () => {
    const { lesson, errors } = validateLesson({ ...QUEEN, accepted: ['Nbc6'] })
    expect(errors).toEqual([])
    expect(lesson?.accepted).toEqual(['Nc6'])
  })

  it('drops blank hints', () => {
    const { lesson } = validateLesson({ ...CENTER, hints: ['', '  ', 'Look at e5.'] })
    expect(lesson?.hints).toEqual(['Look at e5.'])
  })

  it('rejects missing fields', () => {
    const { errors } = validateLesson({ id: 'x', fen: CENTER.fen })
    expect(errors).toEqual(
      expect.arrayContaining([
        'lesson "x": "concept" must be a non-empty string',
        'lesson "x": "accepted" must be a non-empty list of SAN moves',
        'lesson "x": "hints" must be a list of strings',
      ]),
    )
  })

  it('rejects an invalid FEN', () => {
    const { errors } = validateLesson({ ...CENTER, fen: 'not a fen' })
    expect(errors[0]).toMatch(/^lesson "center-01": invalid FEN/)
  })

  it('rejects illegal and repeated moves', () => {
    expect(validateLesson({ ...CENTER, accepted: ['d4', 'Qh5'] }).errors).toEqual([
      'lesson "center-01": Qh5 is not legal here',
    ])
    expect(validateLesson({ ...CENTER, accepted: ['d4', 'd2d4'] }).errors).toEqual([
      'lesson "center-01": d2d4 is listed twice',
    ])
  })

  it('rejects a finished position', () => {
    const mate = fenAfter('f3 e5 g4 Qh4')
    expect(validateLesson({ ...CENTER, fen: mate, accepted: ['a3'] }).errors).toEqual([
      'lesson "center-01": the position is already over',
    ])
  })
})

describe('validatePack', () => {
  it('accepts a valid pack', () => {
    const result = validatePack(JSON.parse(JSON.stringify(PACK)))
    expect(result).toEqual({ ok: true, pack: PACK })
  })

  it('needs an id without ":", a name and lessons', () => {
    expect(validatePack({ id: 'a:b', name: '', lessons: [] })).toEqual({
      ok: false,
      errors: [
        'pack: "id" must not contain ":"',
        'pack: "name" must be a non-empty string',
        'pack: "lessons" must be a non-empty list',
      ],
    })
  })

  it('rejects repeated ids and repeated positions', () => {
    const result = validatePack({
      ...PACK,
      lessons: [CENTER, { ...QUEEN, id: 'center-01' }, { ...CENTER, id: 'center-02' }],
    })
    expect(result).toEqual({
      ok: false,
      errors: ['lesson 2: id "center-01" is used twice', 'lesson 3: same position as "center-01"'],
    })
  })

  it('reports errors from every lesson', () => {
    const result = validatePack({
      ...PACK,
      lessons: [
        { ...CENTER, accepted: ['Ke2', 'Kd3'] },
        { ...QUEEN, accepted: ['Kd6'] },
      ],
    })
    expect(result).toEqual({
      ok: false,
      errors: [
        'lesson 1 "center-01": Kd3 is not legal here',
        'lesson 2 "queen-01": Kd6 is not legal here',
      ],
    })
  })
})

describe('helpers', () => {
  it('finds clashing lesson ids across packs', () => {
    expect(duplicateLessonIds([PACK, { ...PACK, id: 'other', lessons: [QUEEN] }])).toEqual([
      'lesson "queen-01" is in both "test-pack" and "other"',
    ])
  })

  it('labels known concepts and passes others through', () => {
    expect(conceptLabel('castle-early')).toBe('Castle early')
    expect(conceptLabel('pins')).toBe('pins')
  })

  it('plays the side to move', () => {
    expect(lessonSide(CENTER)).toBe('white')
    expect(lessonSide(QUEEN)).toBe('black')
  })
})
