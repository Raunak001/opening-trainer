// Authoring helpers: engine lines → accepted moves, draft text, pack editing. Pure.

import { Chess } from 'chess.js'
// Direct module imports: the engine index pulls in the worker wrapper, which is fine, but
// keep this file to the pure parts.
import { formatScore } from '../engine/explain'
import { playMove } from '../engine/grading'
import { toWhitePov, type InfoLine, type Score } from '../engine/uci'
import { validateLesson, type Lesson, type LessonPack } from './lesson'

/** One multi-PV line, resolved to SAN for display. */
export interface CandidateLine {
  san: string
  uci: string
  /** Side-to-move point of view, as the engine reports it. */
  score: Score
  /** White's point of view, for display. */
  whiteScore: Score
  /** The principal variation in SAN (stops at the first move it cannot play). */
  pvSan: string[]
  /** Within the auto-accept margin of the best line. */
  autoAccepted: boolean
}

const MATE_VALUE = 100_000

/** A score as one number, side-to-move POV: mates beyond any cp, shorter mates better. */
export function scoreValue(score: Score): number {
  if (score.type === 'cp') return score.value
  if (score.value > 0) return MATE_VALUE - score.value
  return -MATE_VALUE - score.value
}

/**
 * Whether a line is close enough to the best to accept. With a forced mate on the board,
 * only mating moves count; otherwise any move within `withinCp` of the best (mates for
 * the side to move are always within).
 */
export function isWithin(best: Score, line: Score, withinCp: number): boolean {
  if (best.type === 'mate' && best.value > 0) return line.type === 'mate' && line.value > 0
  if (line.type === 'mate' && line.value > 0) return true
  return scoreValue(line) >= scoreValue(best) - withinCp
}

function pvToSan(fen: string, pv: readonly string[]): string[] {
  const chess = new Chess(fen)
  const sans: string[] = []
  for (const uci of pv) {
    try {
      sans.push(playMove(chess, uci).san)
    } catch {
      break
    }
  }
  return sans
}

/**
 * Multi-PV lines (best first) → candidate moves. Lines whose first move is not legal in
 * `fen` (a stale search) are dropped, and so are repeats of a move already listed.
 */
export function candidateLines(
  fen: string,
  lines: readonly InfoLine[],
  withinCp: number,
): CandidateLine[] {
  const sorted = [...lines].sort((a, b) => a.multipv - b.multipv)
  const best = sorted[0]?.score
  const out: CandidateLine[] = []
  for (const line of sorted) {
    const pvSan = pvToSan(fen, line.pv)
    if (pvSan.length === 0 || out.some((c) => c.san === pvSan[0])) continue
    out.push({
      san: pvSan[0],
      uci: line.pv[0],
      score: line.score,
      whiteScore: toWhitePov(line.score, fen),
      pvSan,
      autoAccepted: best !== undefined && isWithin(best, line.score, withinCp),
    })
  }
  return out
}

/** "Best is d4 (+0.6). Also good: d3 (+0.3)." — a first draft of the explanation. */
export function draftExplanation(candidates: readonly CandidateLine[]): string {
  const accepted = candidates.filter((c) => c.autoAccepted)
  if (accepted.length === 0) return ''
  const [best, ...rest] = accepted
  const parts = [`Best is ${best.san} (${formatScore(best.whiteScore)}).`]
  if (rest.length > 0)
    parts.push(
      `Also good: ${rest.map((c) => `${c.san} (${formatScore(c.whiteScore)})`).join(', ')}.`,
    )
  return parts.join(' ')
}

/** "punish-early-queen" → "queen"; ids are `${prefix}-NN`. */
export function idPrefix(concept: string): string {
  const words = concept.split('-').filter(Boolean)
  return words.length > 0 ? words[words.length - 1] : 'lesson'
}

/** The next free `${prefix}-NN` id in a pack. */
export function nextLessonId(pack: Pick<LessonPack, 'lessons'>, concept: string): string {
  const prefix = idPrefix(concept)
  const used = new Set(pack.lessons.map((l) => l.id))
  for (let n = 1; ; n++) {
    const id = `${prefix}-${String(n).padStart(2, '0')}`
    if (!used.has(id)) return id
  }
}

/** "Strike the Center!" → "strike-the-center" */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Text fields as typed in the form. */
export interface LessonForm {
  id: string
  concept: string
  fen: string
  prompt: string
  /** SAN moves. */
  accepted: string[]
  /** One hint per line. */
  hints: string
  explanation: string
}

/** Form → lesson, with the same checks as a pack file. */
export function lessonFromForm(form: LessonForm): { lesson?: Lesson; errors: string[] } {
  return validateLesson({
    id: form.id,
    concept: form.concept,
    fen: form.fen,
    prompt: form.prompt.trim(),
    accepted: form.accepted,
    hints: form.hints.split('\n').map((h) => h.trim()),
    explanation: form.explanation.trim(),
  })
}

export function formFromLesson(lesson: Lesson): LessonForm {
  return { ...lesson, accepted: [...lesson.accepted], hints: lesson.hints.join('\n') }
}

/**
 * Adds a lesson, or replaces the one with the same id in place. A different lesson on the
 * same position is an error (they would share a card).
 */
export function putLesson(
  pack: LessonPack,
  lesson: Lesson,
): { pack: LessonPack; error?: undefined } | { error: string } {
  const key = (fen: string) => fen.split(' ').slice(0, 4).join(' ')
  const clash = pack.lessons.find((l) => l.id !== lesson.id && key(l.fen) === key(lesson.fen))
  if (clash) return { error: `"${clash.id}" already uses this position` }
  const index = pack.lessons.findIndex((l) => l.id === lesson.id)
  const lessons =
    index === -1
      ? [...pack.lessons, lesson]
      : pack.lessons.map((l, i) => (i === index ? lesson : l))
  return { pack: { ...pack, lessons } }
}

export function removeLesson(pack: LessonPack, id: string): LessonPack {
  return { ...pack, lessons: pack.lessons.filter((l) => l.id !== id) }
}

/** Swaps a lesson with its neighbour (`-1` up, `1` down). */
export function moveLesson(pack: LessonPack, id: string, by: -1 | 1): LessonPack {
  const i = pack.lessons.findIndex((l) => l.id === id)
  const j = i + by
  if (i === -1 || j < 0 || j >= pack.lessons.length) return pack
  const lessons = [...pack.lessons]
  ;[lessons[i], lessons[j]] = [lessons[j], lessons[i]]
  return { ...pack, lessons }
}

/** The file contents for `src/lessons/packs/<id>.json`. Field order is fixed for clean diffs. */
export function packToJson(pack: LessonPack): string {
  const ordered = {
    id: pack.id,
    name: pack.name,
    ...(pack.description ? { description: pack.description } : {}),
    lessons: pack.lessons.map((l) => ({
      id: l.id,
      concept: l.concept,
      fen: l.fen,
      prompt: l.prompt,
      accepted: l.accepted,
      hints: l.hints,
      explanation: l.explanation,
    })),
  }
  return `${JSON.stringify(ordered, null, 2)}\n`
}
