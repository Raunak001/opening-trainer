// Pure UCI output parsing. No worker, no DOM.

/** Engine score from the side-to-move's point of view, as UCI reports it. */
export type Score = { type: 'cp'; value: number } | { type: 'mate'; value: number }

/** `lowerbound` / `upperbound` mark fail-high/fail-low scores that are not exact. */
export type ScoreBound = 'exact' | 'lower' | 'upper'

/** One `info` line that carries an evaluated principal variation. */
export interface InfoLine {
  depth: number
  seldepth?: number
  /** 1-based; 1 when MultiPV is off. */
  multipv: number
  score: Score
  bound: ScoreBound
  /** UCI moves, e.g. ['e2e4', 'e7e5']. */
  pv: string[]
  nodes?: number
  nps?: number
  timeMs?: number
}

export interface BestMove {
  /** null when the engine has no legal move (`bestmove (none)`: mate or stalemate). */
  move: string | null
  ponder?: string
}

const INT_FIELDS = {
  depth: 'depth',
  seldepth: 'seldepth',
  multipv: 'multipv',
  nodes: 'nodes',
  nps: 'nps',
  time: 'timeMs',
} as const

function parseIntToken(token: string | undefined): number | undefined {
  if (token === undefined || !/^-?\d+$/.test(token)) return undefined
  return Number(token)
}

/**
 * Parses an `info ...` line. Returns null for info lines without both a score and a pv
 * (`info string`, `currmove`, `hashfull`-only lines, ...), since they cannot grade a move.
 */
export function parseInfo(line: string): InfoLine | null {
  const tokens = line.trim().split(/\s+/)
  if (tokens[0] !== 'info') return null

  const ints: Partial<Record<(typeof INT_FIELDS)[keyof typeof INT_FIELDS], number>> = {}
  let score: Score | undefined
  let bound: ScoreBound = 'exact'
  let pv: string[] | undefined

  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i]
    if (token === 'string') return null // rest of line is free text
    if (token === 'pv') {
      pv = tokens.slice(i + 1)
      break // pv is always last
    }
    if (token === 'score') {
      const kind = tokens[i + 1]
      const value = parseIntToken(tokens[i + 2])
      if ((kind === 'cp' || kind === 'mate') && value !== undefined) {
        score = { type: kind, value }
        i += 2
        const next = tokens[i + 1]
        if (next === 'lowerbound' || next === 'upperbound') {
          bound = next === 'lowerbound' ? 'lower' : 'upper'
          i++
        }
      }
      continue
    }
    if (token in INT_FIELDS) {
      const value = parseIntToken(tokens[i + 1])
      if (value !== undefined) {
        ints[INT_FIELDS[token as keyof typeof INT_FIELDS]] = value
        i++
      }
    }
  }

  if (!score || !pv || pv.length === 0 || ints.depth === undefined) return null

  const info: InfoLine = { depth: ints.depth, multipv: ints.multipv ?? 1, score, bound, pv }
  if (ints.seldepth !== undefined) info.seldepth = ints.seldepth
  if (ints.nodes !== undefined) info.nodes = ints.nodes
  if (ints.nps !== undefined) info.nps = ints.nps
  if (ints.timeMs !== undefined) info.timeMs = ints.timeMs
  return info
}

/** Parses `bestmove <move> [ponder <move>]`. Returns null for any other line. */
export function parseBestMove(line: string): BestMove | null {
  const tokens = line.trim().split(/\s+/)
  if (tokens[0] !== 'bestmove' || tokens.length < 2) return null
  const move = tokens[1] === '(none)' || tokens[1] === '0000' ? null : tokens[1]
  const result: BestMove = { move }
  if (tokens[2] === 'ponder' && tokens[3]) result.ponder = tokens[3]
  return result
}

/**
 * Converts a side-to-move score to White's point of view. `fen` is the position the
 * engine searched (only its side-to-move field is read). `mate 0` (side to move is already
 * mated) stays `mate 0`, since zero has no sign; callers should check the FEN for that case.
 */
export function toWhitePov(score: Score, fen: string): Score {
  const side = fen.trim().split(/\s+/)[1]
  if (side !== 'b') return score
  return { type: score.type, value: score.value === 0 ? 0 : -score.value }
}
