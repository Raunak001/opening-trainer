// Template phrase bank: findings → sentences. No LLM: fixed templates with variables.

import type { PieceSymbol, Square } from 'chess.js'
import type { MoveGrade, MoveGrading } from './grading'
import { materialFindings, type MaterialFinding } from './material'
import { principleFindings, type PrincipleFinding, type PrincipleOptions } from './principles'
import { tacticFindings, type ForkTarget, type TacticFinding } from './tactics'
import type { Score } from './uci'

export type Finding = MaterialFinding | TacticFinding | PrincipleFinding

/** Fills `{name}` placeholders. Unknown names are left as is, so a typo shows up in tests. */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  )
}

/**
 * The phrase bank. `reason` explains what is wrong with the played move without naming the
 * better move (safe to show mid-drill); `best` names the better move.
 */
export const PHRASES = {
  'allows-mate': { reason: 'This allows mate in {n}: {line}.' },
  'missed-mate': { reason: 'You had a forced mate in {n}.', best: 'Best was {line}, mate in {n}.' },
  'allows-fork': { reason: 'This allows {san}, forking your {targets}.' },
  'missed-fork': {
    reason: 'You missed a fork.',
    best: 'Best was {san}, forking the {targets}.',
  },
  'hangs-piece': { reason: 'This leaves your {piece} on {square} hanging.' },
  'missed-capture': {
    reason: 'The {piece} on {square} was free to take.',
    best: 'Best was {best}, winning the {piece}.',
  },
  'played-loses-material': { reason: 'This loses {amount} after {line}.' },
  'best-wins-material': { best: 'Best was {best}, winning {amount} ({eval}).' },
  'early-queen': {
    reason: 'Bringing the queen out this early lets your opponent gain time by attacking it.',
  },
  'same-piece-twice': {
    reason: 'Moving the same {piece} twice in the opening costs time. Develop another piece.',
  },
  'no-castle': {
    reason: 'It is move {n} and your king is still in the centre. Think about castling.',
  },
  'no-central-pawn': {
    reason: 'Neither central pawn has moved. Claim the centre with the d- or e-pawn.',
  },
  'undeveloped-minors': { reason: 'Your {pieces} are still at home. Get them developed.' },
  fallbackReason: 'This drops the evaluation to {eval}.',
  fallbackBest: 'Best was {best} ({eval}).',
} as const

export const GRADE_LABELS: Record<MoveGrade, string> = {
  book: 'book move',
  good: 'good move',
  inaccuracy: 'inaccuracy',
  mistake: 'mistake',
  blunder: 'blunder',
}

const PIECE_NAMES: Record<PieceSymbol, string> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
}

const SQUARE_PIECE_NAMES: Partial<Record<Square, string>> = {
  b1: 'b1-knight',
  g1: 'g1-knight',
  c1: 'c1-bishop',
  f1: 'f1-bishop',
  b8: 'b8-knight',
  g8: 'g8-knight',
  c8: 'c8-bishop',
  f8: 'f8-bishop',
}

/** Material in pawns → words. */
export function amountWords(pawns: number): string {
  const n = Math.round(pawns)
  if (n <= 1) return 'a pawn'
  if (n === 2) return 'two pawns'
  if (n === 3 || n === 4) return 'a piece'
  if (n === 5) return 'a rook'
  if (n >= 9) return 'the queen'
  return `${n} pawns' worth of material`
}

/** Score → "+1.2", "-0.3", "0.0", "#3", "#-2"; "#" for a delivered mate. */
export function formatScore(score: Score): string {
  if (score.type === 'mate') return score.value === 0 ? '#' : `#${score.value}`
  const pawns = score.value / 100
  const text = Math.abs(pawns).toFixed(1)
  if (text === '0.0') return '0.0'
  return `${pawns > 0 ? '+' : '-'}${text}`
}

/** Flips a score to the other side's point of view. `mate 0` stays `mate 0` (mate on the board). */
function flip(score: Score): Score {
  if (score.type === 'mate') return { type: 'mate', value: score.value === 0 ? 0 : -score.value }
  return { type: 'cp', value: -score.value }
}

function listWords(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

function targetsWords(targets: ForkTarget[]): string {
  return listWords(targets.map((t) => PIECE_NAMES[t.piece]))
}

/** Up to `max` plies of a line; a cut-off line ends with "…". */
function lineWords(sans: readonly string[], max = 8): string {
  const shown = sans.slice(0, max).join(' ')
  return sans.length > max ? `${shown}…` : shown
}

/** Reason priority: forced mates, then forks, then material, then opening principles. */
const REASON_ORDER: Finding['type'][] = [
  'allows-mate',
  'missed-mate',
  'allows-fork',
  'hangs-piece',
  'missed-fork',
  'missed-capture',
  'played-loses-material',
  'early-queen',
  'same-piece-twice',
  'no-central-pawn',
  'undeveloped-minors',
  'no-castle',
]

const BEST_ORDER: Finding['type'][] = [
  'missed-mate',
  'missed-fork',
  'best-wins-material',
  'missed-capture',
]

function reasonFor(finding: Finding): string | undefined {
  switch (finding.type) {
    case 'allows-mate':
      return fill(PHRASES[finding.type].reason, {
        n: finding.mateIn,
        line: lineWords(finding.sans),
      })
    case 'missed-mate':
      return fill(PHRASES[finding.type].reason, { n: finding.mateIn })
    case 'allows-fork':
      return fill(PHRASES[finding.type].reason, {
        san: finding.fork.san,
        targets: targetsWords(finding.fork.targets),
      })
    case 'missed-fork':
      return PHRASES[finding.type].reason
    case 'hangs-piece':
      return fill(PHRASES[finding.type].reason, {
        piece: PIECE_NAMES[finding.piece.piece],
        square: finding.piece.square,
      })
    case 'missed-capture':
      return fill(PHRASES[finding.type].reason, {
        piece: PIECE_NAMES[finding.piece.piece],
        square: finding.piece.square,
      })
    case 'played-loses-material':
      return fill(PHRASES[finding.type].reason, {
        amount: amountWords(finding.amount),
        line: lineWords(finding.sans),
      })
    case 'early-queen':
    case 'no-central-pawn':
      return PHRASES[finding.type].reason
    case 'same-piece-twice':
      return fill(PHRASES[finding.type].reason, { piece: PIECE_NAMES[finding.piece] })
    case 'no-castle':
      return fill(PHRASES[finding.type].reason, { n: finding.moveNumber })
    case 'undeveloped-minors':
      return fill(PHRASES[finding.type].reason, {
        pieces: listWords(finding.squares.map((sq) => SQUARE_PIECE_NAMES[sq] ?? sq)),
      })
    default:
      return undefined
  }
}

function bestFor(finding: Finding, bestSan: string, bestEval: string): string | undefined {
  switch (finding.type) {
    case 'missed-mate':
      return fill(PHRASES[finding.type].best, { n: finding.mateIn, line: lineWords(finding.sans) })
    case 'missed-fork':
      return fill(PHRASES[finding.type].best, {
        san: finding.fork.san,
        targets: targetsWords(finding.fork.targets),
      })
    case 'missed-capture':
      return fill(PHRASES[finding.type].best, {
        best: finding.bestSan,
        piece: PIECE_NAMES[finding.piece.piece],
      })
    case 'best-wins-material':
      return fill(PHRASES[finding.type].best, {
        best: bestSan,
        amount: amountWords(finding.amount),
        eval: bestEval,
      })
    default:
      return undefined
  }
}

export interface Explanation {
  grade: MoveGrade
  /** "blunder", "good move", … */
  label: string
  /** Why the played move is good or bad, never naming the better move. */
  reason?: string
  /** Names the better move; undefined when the played move was the best. */
  best?: string
  /** Mover's eval before (best play) and after the played move, formatted. */
  evalBest: string
  evalPlayed: string
  findings: Finding[]
}

export interface ExplainInput {
  /** Position before the move. */
  fen: string
  grading: MoveGrading
  /** Game so far for the opening-principle rules: start FEN + SAN moves, ending with the played move. */
  history?: { startFen: string; sans: readonly string[] }
  principleOptions?: Partial<PrincipleOptions>
}

/** Runs every check on a graded move and turns the findings into sentences. */
export function explainMove({
  fen,
  grading,
  history,
  principleOptions,
}: ExplainInput): Explanation {
  const material = materialFindings({
    fen,
    played: grading.played.uci,
    bestPv: grading.before.pv,
    replyPv: grading.after.pv,
  })
  const tactics = tacticFindings({
    fen,
    played: grading.played.uci,
    bestPv: grading.before.pv,
    replyPv: grading.after.pv,
    before: grading.before.score,
    after: grading.after.score,
  })
  const principles = history
    ? principleFindings(history.startFen, history.sans, principleOptions)
    : []
  const findings: Finding[] = [...tactics, ...material, ...principles]

  const evalBest = formatScore(grading.before.score)
  const evalPlayed = formatScore(flip(grading.after.score))
  const isBest = grading.best !== null && grading.best.uci === grading.played.uci
  const bad = grading.grade !== 'good' && grading.grade !== 'book'

  const byType = (order: Finding['type'][]) =>
    order.flatMap((type) => findings.filter((f) => f.type === type))

  // Principle nags only explain moves the engine also dislikes.
  let reason: string | undefined
  for (const finding of byType(REASON_ORDER)) {
    const isPrinciple = principles.includes(finding as PrincipleFinding)
    if (isPrinciple && !bad) continue
    reason = reasonFor(finding)
    if (reason) break
  }
  if (!reason && bad) reason = fill(PHRASES.fallbackReason, { eval: evalPlayed })

  let best: string | undefined
  if (!isBest && grading.best) {
    for (const finding of byType(BEST_ORDER)) {
      best = bestFor(finding, grading.best.san, evalBest)
      if (best) break
    }
    best ??= fill(PHRASES.fallbackBest, { best: grading.best.san, eval: evalBest })
  }

  // A cut-off line ends in "…"; don't follow it with the template's full stop.
  const tidy = (text: string | undefined) => text?.replace(/…\.$/, '…')
  return {
    grade: grading.grade,
    label: GRADE_LABELS[grading.grade],
    reason: tidy(reason),
    best: tidy(best),
    evalBest,
    evalPlayed,
    findings,
  }
}
