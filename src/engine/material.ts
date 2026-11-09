// Material checks for move explanations: material swing along an engine line, and pieces
// left hanging (attackers vs defenders, resolved by a static exchange on the square).
// Pure: chess.js only.

import { Chess, type Color, type PieceSymbol, type Square } from 'chess.js'
import type { MoveGrading } from './grading'

export const PIECE_VALUES: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }

const UCI_MOVE = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/

function other(color: Color): Color {
  return color === 'w' ? 'b' : 'w'
}

function sideToMove(fen: string): Color {
  return fen.trim().split(/\s+/)[1] === 'b' ? 'b' : 'w'
}

/** Same placement with `color` to move; castling and en passant cleared. */
function withTurn(fen: string, color: Color): string {
  const fields = fen.trim().split(/\s+/)
  return `${fields[0]} ${color} - - 0 1`
}

function load(fen: string): Chess {
  return new Chess(fen, { skipValidation: true })
}

/** Plays a UCI or SAN move; throws if illegal. */
function play(chess: Chess, move: string) {
  const uci = UCI_MOVE.exec(move)
  return uci ? chess.move({ from: uci[1], to: uci[2], promotion: uci[3] }) : chess.move(move)
}

/** White's material minus Black's, in pawns. */
export function materialBalance(fen: string): number {
  let total = 0
  for (const row of load(fen).board()) {
    for (const piece of row) {
      if (piece) total += (piece.color === 'w' ? 1 : -1) * PIECE_VALUES[piece.type]
    }
  }
  return total
}

/**
 * Static exchange evaluation: material the side to move nets by starting a capture sequence
 * on `square`, each side recapturing with its cheapest legal piece and free to stop. Legal
 * moves only, so pinned pieces and kings walking into defended squares are excluded, and
 * x-ray attackers join once the piece in front has captured. Returns null when the side to
 * move has no legal capture there (or the square holds a king or is empty / its own piece).
 */
export function staticExchange(fen: string, square: Square): number | null {
  const chess = load(fen)
  const target = chess.get(square)
  if (!target || target.type === 'k' || target.color === chess.turn()) return null

  const captured: number[] = []
  let occupant = PIECE_VALUES[target.type]
  for (;;) {
    const legal = chess
      .moves({ verbose: true })
      .filter((m) => m.to === square && m.captured)
      .sort((a, b) => PIECE_VALUES[a.piece] - PIECE_VALUES[b.piece])
    const capture = legal[0]
    if (!capture) break
    captured.push(occupant)
    chess.move({
      from: capture.from,
      to: capture.to,
      promotion: capture.promotion ? 'q' : undefined,
    })
    occupant = PIECE_VALUES[chess.get(square)?.type ?? capture.piece]
    if (occupant === 0) break // a king captured last; nothing can take it back legally
  }
  if (captured.length === 0) return null

  // Fold from the end: each side only continues the exchange if it does not lose by it.
  let tail = 0
  for (let i = captured.length - 1; i >= 1; i--) tail = Math.max(0, captured[i] - tail)
  return captured[0] - tail
}

export interface HangingPiece {
  square: Square
  piece: PieceSymbol
  color: Color
  value: number
  /** Material the opponent nets by capturing it (> 0). */
  gain: number
  /** Opponent pieces attacking the square. */
  attackers: Square[]
  /** Own pieces defending it. */
  defenders: Square[]
}

/**
 * Pieces of `color` the opponent wins material by capturing, judged as if the opponent were
 * to move: undefended pieces, pieces attacked by something cheaper, and pieces with more
 * attackers than defenders all show up here when the exchange actually wins.
 */
export function hangingPieces(fen: string, color: Color): HangingPiece[] {
  const asOpponent = sideToMove(fen) === other(color) ? fen : withTurn(fen, other(color))
  const chess = load(asOpponent)
  const result: HangingPiece[] = []
  for (const row of chess.board()) {
    for (const piece of row) {
      if (!piece || piece.color !== color || piece.type === 'k') continue
      const gain = staticExchange(asOpponent, piece.square)
      if (gain === null || gain <= 0) continue
      result.push({
        square: piece.square,
        piece: piece.type,
        color,
        value: PIECE_VALUES[piece.type],
        gain,
        attackers: chess.attackers(piece.square, other(color)),
        defenders: chess.attackers(piece.square, color),
      })
    }
  }
  return result.sort((a, b) => b.gain - a.gain || b.value - a.value)
}

export interface LineCapture {
  /** 0-based ply within the line. */
  ply: number
  san: string
  piece: PieceSymbol
  /** Colour of the captured piece. */
  color: Color
}

export interface LineMaterial {
  /** The line in SAN, as far as it was legal. */
  sans: string[]
  captures: LineCapture[]
  /**
   * Material change for the side to move at the start, in pawns, after the line (and after
   * settling a recapture the line stopped short of).
   */
  swing: number
}

/** Plays `moves` (UCI or SAN) from `fen` and measures the material swing. */
export function lineMaterial(
  fen: string,
  moves: readonly string[],
  maxPlies = moves.length,
): LineMaterial {
  const mover = sideToMove(fen)
  const sign = mover === 'w' ? 1 : -1
  const chess = new Chess(fen)
  const sans: string[] = []
  const captures: LineCapture[] = []
  let last: { to: Square; captured: boolean } | undefined

  for (const move of moves.slice(0, maxPlies)) {
    let played
    try {
      played = play(chess, move)
    } catch {
      break // PV went stale (e.g. cached for another move order); measure what was legal
    }
    if (played.captured) {
      captures.push({
        ply: sans.length,
        san: played.san,
        piece: played.captured,
        color: other(played.color),
      })
    }
    sans.push(played.san)
    last = { to: played.to, captured: Boolean(played.captured) }
  }

  let swing = sign * (materialBalance(chess.fen()) - materialBalance(fen))
  // Engine lines can end mid-exchange; count the recapture that is clearly coming.
  if (last?.captured) {
    const recapture = staticExchange(chess.fen(), last.to)
    if (recapture !== null && recapture > 0) {
      swing += (chess.turn() === mover ? 1 : -1) * recapture
    }
  }
  return { sans, captures, swing }
}

export type MaterialFinding =
  /** The engine's line wins material. */
  | { type: 'best-wins-material'; amount: number; sans: string[] }
  /** The played move, followed by the engine's reply line, loses material. */
  | { type: 'played-loses-material'; amount: number; sans: string[] }
  /** The played move leaves a piece that was safe before en prise. */
  | { type: 'hangs-piece'; piece: HangingPiece }
  /** An opponent piece was there for the taking, the engine took it, the played move didn't. */
  | { type: 'missed-capture'; piece: HangingPiece; bestSan: string }

export interface MaterialCheckInput {
  /** Position before the move. */
  fen: string
  /** The move played (UCI or SAN). */
  played: string
  /** Engine's best line from `fen`. */
  bestPv: readonly string[]
  /** Engine's best line for the opponent after the played move. */
  replyPv: readonly string[]
}

/** Material swings under one pawn are positional, not material, findings. */
export const MIN_MATERIAL_SWING = 1

export function materialFindings({
  fen,
  played,
  bestPv,
  replyPv,
}: MaterialCheckInput): MaterialFinding[] {
  const mover = sideToMove(fen)
  const findings: MaterialFinding[] = []

  const board = new Chess(fen)
  const move = play(board, played)
  const fenAfter = board.fen()
  const isBest =
    bestPv.length > 0 && sameMove(fen, bestPv[0], move.from + move.to + (move.promotion ?? ''))

  const best = bestPv.length > 0 ? lineMaterial(fen, bestPv) : undefined
  if (best && best.swing >= MIN_MATERIAL_SWING) {
    findings.push({ type: 'best-wins-material', amount: best.swing, sans: best.sans })
  }

  const playedLine = lineMaterial(fen, [move.san, ...replyPv])
  if (!isBest && playedLine.swing <= -MIN_MATERIAL_SWING) {
    findings.push({
      type: 'played-loses-material',
      amount: -playedLine.swing,
      sans: playedLine.sans,
    })
  }

  // Only blame a hanging piece when the engine agrees material is actually lost.
  if (!isBest && playedLine.swing < 0) {
    const before = new Set(hangingPieces(fen, mover).map((p) => p.square))
    for (const piece of hangingPieces(fenAfter, mover)) {
      const wasSafe = piece.square === move.to ? true : !before.has(piece.square)
      if (wasSafe) findings.push({ type: 'hangs-piece', piece })
    }
  }

  if (!isBest && best) {
    const bestFirst = new Chess(fen)
    const bestMove = tryPlay(bestFirst, bestPv[0])
    if (bestMove?.captured && move.to !== bestMove.to) {
      const free = hangingPieces(fen, other(mover)).find((p) => p.square === bestMove.to)
      if (free) findings.push({ type: 'missed-capture', piece: free, bestSan: bestMove.san })
    }
  }

  return findings
}

/** Convenience: material findings for a graded move. */
export function materialFindingsForGrading(fen: string, grading: MoveGrading): MaterialFinding[] {
  return materialFindings({
    fen,
    played: grading.played.uci,
    bestPv: grading.before.pv,
    replyPv: grading.after.pv,
  })
}

function tryPlay(chess: Chess, move: string) {
  try {
    return play(chess, move)
  } catch {
    return undefined
  }
}

function sameMove(fen: string, a: string, b: string): boolean {
  const ma = tryPlay(new Chess(fen), a)
  const mb = tryPlay(new Chess(fen), b)
  return ma !== undefined && mb !== undefined && ma.san === mb.san
}
