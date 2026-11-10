// Words and icons for move marks. Pure; the icon is an SVG string so the board (chessground
// custom SVG) and React can both draw it.

import type { AnalysisEval } from '../db/db'
import { amountWords, explainMove, formatScore } from '../engine/explain'
import type { MoveGrade, MoveGrading } from '../engine/grading'
import { positionKey } from '../repertoire/positionKey'
import type { MoveMark, MoveReview } from './classify'

export interface MarkStyle {
  label: string
  color: string
  /** Short text drawn in the icon; book uses a drawn icon instead. */
  glyph: string
}

// Colours mimic chess.com's review palette; the icons are our own.
export const MARK_STYLES: Record<MoveMark, MarkStyle> = {
  brilliant: { label: 'Brilliant', color: '#1baca6', glyph: '!!' },
  great: { label: 'Great', color: '#5c8bb0', glyph: '!' },
  best: { label: 'Best', color: '#81b64c', glyph: '★' },
  excellent: { label: 'Excellent', color: '#96bc4b', glyph: '✓' },
  good: { label: 'Good', color: '#95af8a', glyph: '✓' },
  book: { label: 'Book', color: '#a88865', glyph: '' },
  inaccuracy: { label: 'Inaccuracy', color: '#f0c15c', glyph: '?!' },
  mistake: { label: 'Mistake', color: '#e58f2a', glyph: '?' },
  miss: { label: 'Miss', color: '#ee6b55', glyph: '✕' },
  blunder: { label: 'Blunder', color: '#ca3431', glyph: '??' },
}

const BOOK_PATH =
  '<path d="M-11 -8 h8 a3 3 0 0 1 3 3 v14 a3 3 0 0 0 -3 -3 h-8z M11 -8 h-8 a3 3 0 0 0 -3 3 v14 a3 3 0 0 1 3 -3 h8z" fill="#fff"/>'

/** Icon centred on (cx, cy) with radius r, in a 100×100 user space. */
export function markIconSvg(mark: MoveMark, cx = 50, cy = 50, r = 50): string {
  const { color, glyph } = MARK_STYLES[mark]
  const scale = r / 24
  const content =
    mark === 'book'
      ? BOOK_PATH
      : `<text x="0" y="0" text-anchor="middle" dominant-baseline="central" fill="#fff" font-family="system-ui, sans-serif" font-weight="800" font-size="${glyph.length > 1 ? 21 : 26}">${glyph}</text>`
  return (
    `<g transform="translate(${cx} ${cy}) scale(${scale})">` +
    `<circle r="24" fill="${color}" stroke="rgba(0,0,0,0.25)" stroke-width="1.5"/>` +
    `${content}</g>`
  )
}

/** For chessground: the icon in the top-right corner of the destination square. */
export function squareMarkSvg(mark: MoveMark): string {
  return markIconSvg(mark, 86, 14, 20)
}

const TO_GRADE: Record<MoveMark, MoveGrade> = {
  brilliant: 'good',
  great: 'good',
  best: 'good',
  excellent: 'good',
  good: 'good',
  book: 'book',
  inaccuracy: 'inaccuracy',
  mistake: 'mistake',
  miss: 'mistake',
  blunder: 'blunder',
}

const HEADLINE: Record<MoveMark, string> = {
  brilliant: '{san} is brilliant',
  great: '{san} is a great move',
  best: '{san} is best',
  excellent: '{san} is excellent',
  good: '{san} is good',
  book: '{san} is a book move',
  inaccuracy: '{san} is an inaccuracy',
  mistake: '{san} is a mistake',
  miss: '{san} is a miss',
  blunder: '{san} is a blunder',
}

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
const OPENING_PLIES = 24

export interface MoveComment {
  headline: string
  /** Sentences explaining the mark; may be empty. */
  lines: string[]
  /** Eval after the move, White's point of view ("+1.2", "#-3"). */
  evalText: string
}

function flip(score: AnalysisEval['score']): AnalysisEval['score'] {
  if (score.type === 'mate') return { type: 'mate', value: score.value === 0 ? 0 : -score.value }
  return { type: 'cp', value: -score.value }
}

/** White-POV score after the move, from the side-to-move eval stored for the next position. */
function whiteScore(move: MoveReview, after: AnalysisEval): AnalysisEval['score'] {
  // After a White move Black is to move, so the stored score is Black's.
  return move.color === 'white' ? flip(after.score) : after.score
}

/** Coach text for one reviewed move, from rule templates and the existing explainers. */
export function describeMove(
  move: MoveReview,
  before: AnalysisEval,
  after: AnalysisEval,
  sans: readonly string[],
): MoveComment {
  const headline = HEADLINE[move.mark].replace('{san}', move.san)
  const evalText = formatScore(whiteScore(move, after))
  const lines: string[] = []

  if (move.mark === 'book') return { headline, lines: ['A known opening move.'], evalText }
  if (move.mark === 'brilliant') {
    lines.push(`It gives up ${amountWords(move.sacrifice)}, and the engine agrees it works.`)
  }
  if (move.mark === 'great') lines.push('The only move that keeps the balance here.')
  if (move.mark === 'miss')
    lines.push('Your opponent had just gone wrong. You missed the punishment.')

  const grading: MoveGrading = {
    grade: TO_GRADE[move.mark],
    played: { uci: move.uci, san: move.san },
    best: move.best,
    before: {
      positionKey: positionKey(move.fenBefore),
      depth: 0,
      score: before.score,
      bestMove: before.best,
      pv: before.pv,
    },
    after: {
      positionKey: positionKey(move.fenAfter),
      depth: 0,
      score: after.score,
      bestMove: after.best,
      pv: after.pv,
    },
    winBefore: move.winBefore,
    winAfter: move.winAfter,
    loss: move.loss,
  }
  const explanation = explainMove({
    fen: move.fenBefore,
    grading,
    // Opening-principle nags only make sense in the opening.
    history:
      move.ply < OPENING_PLIES
        ? { startFen: START_FEN, sans: sans.slice(0, move.ply + 1) }
        : undefined,
  })
  const bad = TO_GRADE[move.mark] !== 'good'
  if (bad && explanation.reason) lines.push(explanation.reason)
  if (
    move.mark !== 'best' &&
    move.mark !== 'brilliant' &&
    move.mark !== 'great' &&
    explanation.best
  )
    lines.push(explanation.best)
  return { headline, lines, evalText }
}
