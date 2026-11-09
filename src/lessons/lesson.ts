// Lesson and pack schema, with validation. Pure: chess.js only.

import { Chess } from 'chess.js'
import { positionKey } from '../repertoire/positionKey'

/**
 * One concept challenge: a position and the move(s) that solve it. Stored as JSON in
 * `src/lessons/packs/*.json` (one file per pack).
 */
export interface Lesson {
  /** Unique across all packs, e.g. `center-01`. */
  id: string
  /** Concept id, e.g. `strike-center` (see `CONCEPTS`). */
  concept: string
  /** Position to solve. The side to move is the side the user plays. */
  fen: string
  /** What the user is asked, e.g. "Black has developed. Hit the centre." */
  prompt: string
  /** Moves that solve it, in SAN. The first is the main answer (the hint arrow shows it). */
  accepted: string[]
  /** Text hints, revealed one at a time before the board hints. May be empty. */
  hints: string[]
  /** Shown once the lesson is solved. */
  explanation: string
}

export interface LessonPack {
  /** Unique, e.g. `strike-the-center`. Lesson cards use it as their repertoire id. */
  id: string
  name: string
  description?: string
  lessons: Lesson[]
}

export interface ConceptInfo {
  label: string
  /** One sentence on the idea, for pack lists and the authoring tool. */
  summary: string
}

/** The concepts the first packs and the miner know about. Packs may use others. */
export const CONCEPTS = {
  'strike-center': {
    label: 'Strike the center',
    summary: 'Challenge the opponent’s central pawns with your own pawn breaks.',
  },
  'develop-before-attacking': {
    label: 'Develop before attacking',
    summary: 'Bring out the minor pieces before starting an attack.',
  },
  'castle-early': {
    label: 'Castle early',
    summary: 'Get the king safe and connect the rooks.',
  },
  'punish-early-queen': {
    label: 'Punish the early queen',
    summary: 'Develop with tempo against a queen that came out too soon.',
  },
} as const satisfies Record<string, ConceptInfo>

export type KnownConcept = keyof typeof CONCEPTS

export function isKnownConcept(concept: string): concept is KnownConcept {
  return Object.hasOwn(CONCEPTS, concept)
}

export function conceptLabel(concept: string): string {
  return isKnownConcept(concept) ? CONCEPTS[concept].label : concept
}

export type PackResult = { ok: true; pack: LessonPack } | { ok: false; errors: string[] }

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((s) => typeof s === 'string')

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''

/**
 * Checks one lesson and returns it with its moves in chess.js's SAN (so `Ngf3` and `Nf3`
 * compare equal) and its FEN normalized. Errors are prefixed with `where`.
 */
export function validateLesson(
  raw: unknown,
  where = 'lesson',
): { lesson?: Lesson; errors: string[] } {
  if (!isObject(raw)) return { errors: [`${where}: not an object`] }
  const errors: string[] = []
  const at = `${where}${nonEmpty(raw.id) ? ` "${raw.id}"` : ''}`
  for (const field of ['id', 'concept', 'fen', 'prompt', 'explanation'] as const)
    if (!nonEmpty(raw[field])) errors.push(`${at}: "${field}" must be a non-empty string`)
  if (!isStringArray(raw.accepted) || raw.accepted.length === 0)
    errors.push(`${at}: "accepted" must be a non-empty list of SAN moves`)
  if (!isStringArray(raw.hints)) errors.push(`${at}: "hints" must be a list of strings`)
  if (errors.length > 0) return { errors }

  let chess: Chess
  try {
    chess = new Chess(raw.fen as string)
  } catch (error) {
    return { errors: [`${at}: invalid FEN (${(error as Error).message})`] }
  }
  if (chess.isGameOver()) return { errors: [`${at}: the position is already over`] }

  const accepted: string[] = []
  for (const san of raw.accepted as string[]) {
    try {
      const move = new Chess(chess.fen()).move(san)
      if (accepted.includes(move.san)) errors.push(`${at}: ${san} is listed twice`)
      else accepted.push(move.san)
    } catch {
      errors.push(`${at}: ${san} is not legal here`)
    }
  }
  if (errors.length > 0) return { errors }

  return {
    errors: [],
    lesson: {
      id: (raw.id as string).trim(),
      concept: (raw.concept as string).trim(),
      fen: chess.fen(),
      prompt: raw.prompt as string,
      accepted,
      hints: (raw.hints as string[]).filter((h) => h.trim() !== ''),
      explanation: raw.explanation as string,
    },
  }
}

/**
 * Checks a pack. Lesson ids must be unique, and so must positions within a pack: a solved
 * lesson becomes the card `${pack.id}:${positionKey}`, so two lessons on one position
 * would share a card.
 */
export function validatePack(raw: unknown): PackResult {
  if (!isObject(raw)) return { ok: false, errors: ['pack: not an object'] }
  const errors: string[] = []
  if (!nonEmpty(raw.id)) errors.push('pack: "id" must be a non-empty string')
  else if (raw.id.includes(':')) errors.push('pack: "id" must not contain ":"')
  if (!nonEmpty(raw.name)) errors.push('pack: "name" must be a non-empty string')
  if (raw.description !== undefined && typeof raw.description !== 'string')
    errors.push('pack: "description" must be a string')
  if (!Array.isArray(raw.lessons) || raw.lessons.length === 0)
    errors.push('pack: "lessons" must be a non-empty list')
  if (errors.length > 0) return { ok: false, errors }

  const lessons: Lesson[] = []
  const ids = new Set<string>()
  const positions = new Map<string, string>()
  ;(raw.lessons as unknown[]).forEach((item, i) => {
    const { lesson, errors: lessonErrors } = validateLesson(item, `lesson ${i + 1}`)
    errors.push(...lessonErrors)
    if (!lesson) return
    if (ids.has(lesson.id)) errors.push(`lesson ${i + 1}: id "${lesson.id}" is used twice`)
    ids.add(lesson.id)
    const key = positionKey(lesson.fen)
    const other = positions.get(key)
    if (other) errors.push(`lesson ${i + 1}: same position as "${other}"`)
    positions.set(key, lesson.id)
    lessons.push(lesson)
  })
  if (errors.length > 0) return { ok: false, errors }

  const pack: LessonPack = { id: (raw.id as string).trim(), name: raw.name as string, lessons }
  if (typeof raw.description === 'string' && raw.description.trim() !== '')
    pack.description = raw.description
  return { ok: true, pack }
}

/** Lesson ids must be unique across packs too. Returns one message per clash. */
export function duplicateLessonIds(packs: readonly LessonPack[]): string[] {
  const seen = new Map<string, string>()
  const errors: string[] = []
  for (const pack of packs)
    for (const lesson of pack.lessons) {
      const other = seen.get(lesson.id)
      if (other) errors.push(`lesson "${lesson.id}" is in both "${other}" and "${pack.id}"`)
      else seen.set(lesson.id, pack.id)
    }
  return errors
}

/** The side the user plays in a lesson: the side to move. */
export function lessonSide(lesson: Pick<Lesson, 'fen'>): 'white' | 'black' {
  return lesson.fen.split(' ')[1] === 'b' ? 'black' : 'white'
}
