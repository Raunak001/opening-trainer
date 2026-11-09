import { describe, expect, it } from 'vitest'
import type { InfoLine, Score } from '../../engine/uci'
import {
  candidateLines,
  draftExplanation,
  formFromLesson,
  idPrefix,
  isWithin,
  lessonFromForm,
  moveLesson,
  nextLessonId,
  packToJson,
  putLesson,
  removeLesson,
  scoreValue,
  slugify,
} from '../authoring'
import { validatePack } from '../lesson'
import { CENTER, fenAfter, PACK, QUEEN } from './fixtures'

const cp = (value: number): Score => ({ type: 'cp', value })
const mate = (value: number): Score => ({ type: 'mate', value })
const line = (multipv: number, score: Score, pv: string): InfoLine => ({
  depth: 18,
  multipv,
  score,
  bound: 'exact',
  pv: pv.split(' '),
})

// Italian after 4.c3 Nf6, White to move.
const ITALIAN_LINES = [
  line(1, cp(45), 'd2d4 e5d4 c3d4 c5b4'),
  line(2, cp(30), 'e1g1 f6e4'),
  line(3, cp(20), 'd2d3 d7d6'),
  line(4, cp(-10), 'd1e2 d7d6'),
]

describe('scores', () => {
  it('orders mates above any centipawn score, shorter mates first', () => {
    expect(scoreValue(mate(1))).toBeGreaterThan(scoreValue(mate(3)))
    expect(scoreValue(mate(3))).toBeGreaterThan(scoreValue(cp(5000)))
    expect(scoreValue(mate(-5))).toBeGreaterThan(scoreValue(mate(-1)))
    expect(scoreValue(cp(-5000))).toBeGreaterThan(scoreValue(mate(-5)))
  })

  it('accepts lines within the margin', () => {
    expect(isWithin(cp(45), cp(15), 30)).toBe(true)
    expect(isWithin(cp(45), cp(14), 30)).toBe(false)
    expect(isWithin(cp(45), mate(4), 30)).toBe(true)
  })

  it('only accepts mates when there is a forced mate', () => {
    expect(isWithin(mate(2), mate(5), 30)).toBe(true)
    expect(isWithin(mate(2), cp(900), 30)).toBe(false)
  })
})

describe('candidateLines', () => {
  it('resolves SAN and auto-accepts moves within 30cp of the best', () => {
    const lines = candidateLines(CENTER.fen, ITALIAN_LINES, 30)
    expect(lines.map((l) => [l.san, l.autoAccepted])).toEqual([
      ['d4', true],
      ['O-O', true],
      ['d3', true],
      ['Qe2', false],
    ])
    expect(lines[0].pvSan).toEqual(['d4', 'exd4', 'cxd4', 'Bb4+'])
  })

  it('sorts by multipv, skips stale and repeated moves', () => {
    const lines = candidateLines(
      CENTER.fen,
      [
        line(2, cp(30), 'e1g1'),
        line(1, cp(45), 'd2d4'),
        line(3, cp(44), 'a7a5'),
        line(4, cp(40), 'd2d4'),
      ],
      30,
    )
    expect(lines.map((l) => l.san)).toEqual(['d4', 'O-O'])
  })

  it('accepts only mating moves when mate is on the board', () => {
    const fen = fenAfter('e4 e5 Bc4 Nc6 Qh5 Nf6')
    const lines = candidateLines(fen, [line(1, mate(1), 'h5f7'), line(2, cp(80), 'd2d3')], 30)
    expect(lines.map((l) => [l.san, l.autoAccepted])).toEqual([
      ['Qxf7#', true],
      ['d3', false],
    ])
  })

  it("reports scores from White's point of view", () => {
    const [nc6] = candidateLines(QUEEN.fen, [line(1, cp(20), 'b8c6')], 30)
    expect(nc6.whiteScore).toEqual(cp(-20))
  })
})

describe('draftExplanation', () => {
  it('names the best move and the other accepted ones', () => {
    const lines = candidateLines(CENTER.fen, ITALIAN_LINES, 30)
    expect(draftExplanation(lines)).toBe('Best is d4 (+0.5). Also good: O-O (+0.3), d3 (+0.2).')
    expect(draftExplanation(lines.slice(0, 1))).toBe('Best is d4 (+0.5).')
    expect(draftExplanation([])).toBe('')
  })
})

describe('ids', () => {
  it('numbers lessons per concept', () => {
    expect(idPrefix('punish-early-queen')).toBe('queen')
    expect(nextLessonId({ lessons: [] }, 'strike-center')).toBe('center-01')
    expect(nextLessonId(PACK, 'strike-center')).toBe('center-02')
  })

  it('slugifies pack names', () => {
    expect(slugify('  Strike the Center! ')).toBe('strike-the-center')
  })
})

describe('form', () => {
  it('turns a form into a validated lesson and back', () => {
    const form = { ...formFromLesson(CENTER), hints: 'Which pawn?\n\n  c3 supports d4. ' }
    expect(form.hints).toBe('Which pawn?\n\n  c3 supports d4. ')
    const { lesson } = lessonFromForm(form)
    expect(lesson?.hints).toEqual(['Which pawn?', 'c3 supports d4.'])
    expect(formFromLesson(CENTER).hints).toBe(CENTER.hints.join('\n'))
  })

  it('reports form errors', () => {
    expect(lessonFromForm({ ...formFromLesson(CENTER), accepted: [] }).errors).toEqual([
      'lesson "center-01": "accepted" must be a non-empty list of SAN moves',
    ])
  })
})

describe('pack editing', () => {
  const empty = { id: 'p', name: 'P', lessons: [] }

  it('adds, replaces in place and refuses a second lesson on one position', () => {
    let result = putLesson(empty, CENTER)
    if (result.error !== undefined) throw new Error(result.error)
    result = putLesson(result.pack, QUEEN)
    if (result.error !== undefined) throw new Error(result.error)
    const replaced = putLesson(result.pack, { ...CENTER, prompt: 'New prompt' })
    if (replaced.error !== undefined) throw new Error(replaced.error)
    expect(replaced.pack.lessons.map((l) => [l.id, l.prompt])).toEqual([
      ['center-01', 'New prompt'],
      ['queen-01', QUEEN.prompt],
    ])
    expect(putLesson(replaced.pack, { ...CENTER, id: 'center-02' })).toEqual({
      error: '"center-01" already uses this position',
    })
  })

  it('removes and reorders lessons', () => {
    expect(moveLesson(PACK, 'queen-01', -1).lessons.map((l) => l.id)).toEqual([
      'queen-01',
      'center-01',
    ])
    expect(moveLesson(PACK, 'queen-01', 1)).toBe(PACK)
    expect(removeLesson(PACK, 'center-01').lessons).toEqual([QUEEN])
  })

  it('exports JSON that loads back as the same pack', () => {
    const text = packToJson(PACK)
    expect(text.endsWith('}\n')).toBe(true)
    expect(Object.keys(JSON.parse(text))).toEqual(['id', 'name', 'description', 'lessons'])
    expect(validatePack(JSON.parse(text))).toEqual({ ok: true, pack: PACK })
    expect(Object.keys(JSON.parse(packToJson({ ...PACK, description: '' })))).toEqual([
      'id',
      'name',
      'lessons',
    ])
  })
})
