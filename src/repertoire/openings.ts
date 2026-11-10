import { Chess } from 'chess.js'
import { positionKey, type PositionKey } from './positionKey'
import { shortestParent, type RepertoireTree, type TreeNode } from './tree'

/** One row of the Lichess chess-openings TSVs. */
export interface Opening {
  eco: string
  name: string
  /** Shortest known line to the position, e.g. "1. e4 c5 2. Nf3". */
  pgn: string
}

export type OpeningIndex = ReadonlyMap<PositionKey, Opening>

export interface OpeningLabel {
  opening: Opening
  /** False when the name is inherited from the nearest named position above. */
  exact: boolean
}

/** Parses one TSV file (header `eco\tname\tpgn`). Blank lines are skipped. */
export function parseOpeningsTsv(text: string): Opening[] {
  const [header, ...lines] = text.split(/\r?\n/)
  if (header?.trim() !== 'eco\tname\tpgn')
    throw new Error(`Unexpected openings header: "${header}"`)
  const rows: Opening[] = []
  for (const line of lines) {
    if (!line.trim()) continue
    const [eco, name, pgn] = line.split('\t')
    if (!eco || !name || !pgn) throw new Error(`Malformed openings row: "${line}"`)
    rows.push({ eco, name, pgn })
  }
  return rows
}

/** "1. e4 c5 2. Nf3" → ["e4", "c5", "Nf3"] */
export function sansFromPgn(pgn: string): string[] {
  return pgn
    .replace(/\d+\.(\.\.)?/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

/**
 * Maps each opening's final position to its name. Where several rows reach the
 * same position (transposition entries), the one with the shortest line wins,
 * then the first in file order.
 */
export function buildOpeningIndex(rows: readonly Opening[]): Map<PositionKey, Opening> {
  const index = new Map<PositionKey, Opening>()
  const plies = new Map<PositionKey, number>()
  // Lines share long prefixes, so remember the FEN after each prefix and only
  // replay the moves that are new. This cuts index build time several-fold.
  const fenAfter = new Map<string, string>([['', new Chess().fen()]])
  for (const row of rows) {
    const sans = sansFromPgn(row.pgn)
    let known = sans.length
    while (!fenAfter.has(sans.slice(0, known).join(' '))) known--
    const chess = new Chess(fenAfter.get(sans.slice(0, known).join(' ')))
    for (let i = known; i < sans.length; i++) {
      try {
        chess.move(sans[i])
      } catch {
        throw new Error(`Illegal move "${sans[i]}" in opening "${row.name}" (${row.pgn})`)
      }
      fenAfter.set(sans.slice(0, i + 1).join(' '), chess.fen())
    }
    const key = positionKey(chess.fen())
    const existing = plies.get(key)
    if (existing === undefined || sans.length < existing) {
      index.set(key, row)
      plies.set(key, sans.length)
    }
  }
  return index
}

let indexPromise: Promise<OpeningIndex> | undefined

/** Builds the index on the calling thread. Used in tests and when a worker is not available. */
function buildOnThisThread(): Promise<OpeningIndex> {
  return Promise.all([
    import('./openings/a.tsv?raw'),
    import('./openings/b.tsv?raw'),
    import('./openings/c.tsv?raw'),
    import('./openings/d.tsv?raw'),
    import('./openings/e.tsv?raw'),
  ]).then((files) => buildOpeningIndex(files.flatMap((f) => parseOpeningsTsv(f.default))))
}

type WorkerReply = { index: Map<PositionKey, Opening> } | { error: string }

/** Builds the index in a Web Worker, so the page keeps responding (and animating) meanwhile. */
function buildInWorker(): Promise<OpeningIndex> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./openings.worker.ts', import.meta.url), {
      type: 'module',
    })
    worker.onmessage = (event: MessageEvent<WorkerReply>) => {
      worker.terminate()
      if ('index' in event.data) resolve(event.data.index)
      else reject(new Error(event.data.error))
    }
    worker.onerror = (event) => {
      worker.terminate()
      reject(new Error(event.message || 'Opening index worker failed'))
    }
  })
}

/**
 * The bundled Lichess opening names, loaded on first use. The TSVs are a
 * separate chunk, so they cost nothing until something asks for a name.
 * Built in a worker where the browser has one, else on this thread.
 */
export function loadOpeningIndex(): Promise<OpeningIndex> {
  indexPromise ??=
    typeof Worker === 'function'
      ? buildInWorker().catch(() => buildOnThisThread())
      : buildOnThisThread()
  return indexPromise
}

function parentNode(tree: RepertoireTree, node: TreeNode): TreeNode | undefined {
  const link = shortestParent(tree, node)
  return link && tree.nodes[link.from]
}

/**
 * Opening name for one tree node: its own if the position is named, otherwise
 * the nearest named position walking back toward the root.
 */
export function openingFor(
  tree: RepertoireTree,
  index: OpeningIndex,
  key: PositionKey,
): OpeningLabel | undefined {
  let node: TreeNode | undefined = tree.nodes[key]
  let exact = true
  while (node) {
    const opening = index.get(node.key)
    if (opening) return { opening, exact }
    exact = false
    node = parentNode(tree, node)
  }
  return undefined
}

/** Labels every node of the tree in one pass (shallowest first). */
export function labelTree(
  tree: RepertoireTree,
  index: OpeningIndex,
): Record<PositionKey, OpeningLabel> {
  const labels: Record<PositionKey, OpeningLabel> = {}
  const byPly = Object.values(tree.nodes).sort((a, b) => a.ply - b.ply)
  for (const node of byPly) {
    const own = index.get(node.key)
    if (own) {
      labels[node.key] = { opening: own, exact: true }
      continue
    }
    const parent = parentNode(tree, node)
    const inherited = parent && labels[parent.key]
    if (inherited) labels[node.key] = { opening: inherited.opening, exact: false }
  }
  return labels
}
