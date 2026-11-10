import { Chess } from 'chess.js'
import type { Rng } from './pick'
import { shuffle } from './pick'
import type { Square, View } from './squares'

/** "Play this move": a position and the SAN to play in it. */
export interface MovePrompt {
  fen: string
  san: string
  from: Square
  to: Square
  promotion?: string
  /** The side to move, shown at the bottom. */
  view: View
  /** Where the position comes from, e.g. a course name. */
  source: string
}

/** A prompt for `san` in `fen`, or undefined when the move is not legal there. */
export function makePrompt(fen: string, san: string, source: string): MovePrompt | undefined {
  let chess: Chess
  try {
    chess = new Chess(fen)
  } catch {
    return undefined
  }
  try {
    const move = chess.move(san)
    return {
      fen,
      san: move.san,
      from: move.from,
      to: move.to,
      promotion: move.promotion,
      view: move.color === 'w' ? 'white' : 'black',
      source,
    }
  } catch {
    return undefined
  }
}

/** One prompt per move of each line (SAN from the initial position). */
export function promptsFromLine(sans: readonly string[], source: string): MovePrompt[] {
  const chess = new Chess()
  const out: MovePrompt[] = []
  for (const san of sans) {
    const p = makePrompt(chess.fen(), san, source)
    if (!p) break
    out.push(p)
    chess.move(san)
  }
  return out
}

/** The user's move matches the prompt (castling arrives as the king's real move). */
export function isPromptMove(p: MovePrompt, from: string, to: string, promotion?: string): boolean {
  return p.from === from && p.to === to && (p.promotion ?? undefined) === (promotion ?? undefined)
}

/**
 * A round of `n` prompts: card prompts first (shuffled), topped up from the
 * fallback pool; no position twice.
 */
export function pickPrompts(
  cards: readonly MovePrompt[],
  fallback: readonly MovePrompt[],
  n: number,
  rng: Rng,
): MovePrompt[] {
  const seen = new Set<string>()
  const out: MovePrompt[] = []
  for (const p of [...shuffle(cards, rng), ...shuffle(fallback, rng)]) {
    if (out.length >= n) break
    if (seen.has(p.fen)) continue
    seen.add(p.fen)
    out.push(p)
  }
  return out
}
