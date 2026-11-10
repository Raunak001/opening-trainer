import { Chess } from 'chess.js'
import { pickOne, shuffle, type Rng } from './pick'
import {
  ALL_SQUARES,
  fileIndex,
  rankIndex,
  sameDiagonal,
  squareColor,
  type Square,
} from './squares'

export type ReachPiece = 'n' | 'b' | 'r' | 'q' | 'k'

export const PIECE_NAMES: Record<ReachPiece, string> = {
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
}

/** Squares a lone piece on `square` reaches in one move on an empty board (chess.js). */
export function pieceReach(piece: ReachPiece, square: Square): Square[] {
  const chess = new Chess('8/8/8/8/8/8/8/8 w - - 0 1', { skipValidation: true })
  chess.put({ type: piece, color: 'w' }, square)
  return chess
    .moves({ square, verbose: true })
    .map((m) => m.to)
    .sort()
}

export type QuestionKind = 'color' | 'diagonal' | 'knight' | 'bishop'

export const QUESTION_KINDS: readonly QuestionKind[] = ['color', 'diagonal', 'knight', 'bishop']

export interface VisualQuestion {
  kind: QuestionKind
  prompt: string
  options: string[]
  answer: string
  /** Shown after answering. */
  explain: string
  /** Squares to reveal on the board after answering: [main square, …marked squares]. */
  reveal: Square[]
}

const chebyshev = (a: Square, b: Square) =>
  Math.max(Math.abs(fileIndex(a) - fileIndex(b)), Math.abs(rankIndex(a) - rankIndex(b)))

function colorQuestion(rng: Rng): VisualQuestion {
  const square = pickOne(ALL_SQUARES, rng)
  const answer = squareColor(square)
  return {
    kind: 'color',
    prompt: `Is ${square} a light or a dark square?`,
    options: ['light', 'dark'],
    answer,
    explain: `${square} is ${answer}. a1 is dark; a square is dark when its file number plus rank is even.`,
    reveal: [square],
  }
}

function diagonalQuestion(rng: Rng): VisualQuestion {
  const a = pickOne(ALL_SQUARES, rng)
  const onDiag = ALL_SQUARES.filter((s) => sameDiagonal(a, s))
  const offDiag = ALL_SQUARES.filter((s) => s !== a && !sameDiagonal(a, s) && chebyshev(a, s) >= 2)
  const yes = rng() < 0.5 && onDiag.length > 0
  const b = pickOne(yes ? onDiag : offDiag, rng)
  return {
    kind: 'diagonal',
    prompt: `Are ${a} and ${b} on the same diagonal?`,
    options: ['yes', 'no'],
    answer: yes ? 'yes' : 'no',
    explain: yes
      ? `Yes: ${a} and ${b} are as many files apart as ranks apart.`
      : `No: ${a} and ${b} are ${Math.abs(fileIndex(a) - fileIndex(b))} files but ${Math.abs(rankIndex(a) - rankIndex(b))} ranks apart.`,
    reveal: [a, b],
  }
}

function reachQuestion(piece: 'n' | 'b', rng: Rng): VisualQuestion {
  const square = pickOne(ALL_SQUARES, rng)
  const reach = pieceReach(piece, square)
  const target = pickOne(reach, rng)
  // Wrong options look plausible: nearby squares the piece cannot reach.
  const near = ALL_SQUARES.filter(
    (s) => s !== square && !reach.includes(s) && chebyshev(square, s) <= (piece === 'n' ? 2 : 3),
  )
  const wrong = shuffle(near, rng).slice(0, 3)
  const name = PIECE_NAMES[piece]
  return {
    kind: piece === 'n' ? 'knight' : 'bishop',
    prompt: `A ${name} on ${square} can move to which square?`,
    options: shuffle([target, ...wrong], rng),
    answer: target,
    explain: `A ${name} on ${square} reaches ${reach.join(', ')}.`,
    reveal: [square, ...reach],
  }
}

export function makeQuestion(kind: QuestionKind, rng: Rng): VisualQuestion {
  switch (kind) {
    case 'color':
      return colorQuestion(rng)
    case 'diagonal':
      return diagonalQuestion(rng)
    case 'knight':
      return reachQuestion('n', rng)
    case 'bishop':
      return reachQuestion('b', rng)
  }
}

/** A round of questions, cycling through the kinds in random order. */
export function makeQuestions(n: number, rng: Rng): VisualQuestion[] {
  const out: VisualQuestion[] = []
  let kinds: QuestionKind[] = []
  for (let i = 0; i < n; i++) {
    if (kinds.length === 0) kinds = shuffle(QUESTION_KINDS, rng)
    out.push(makeQuestion(kinds.pop() ?? 'color', rng))
  }
  return out
}
