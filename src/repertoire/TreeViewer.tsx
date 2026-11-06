import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useRef, useState } from 'react'
import { getDb, type RepertoireRow, type TrainerDB } from '../db'
import { buildAndSave, explorerQueryFor, listRepertoires, type BuildProgress } from './builder'
import { getExplorerClient, type ExplorerClient } from './explorer'
import { labelTree, loadOpeningIndex, type OpeningLabel } from './openings'
import type { PositionKey } from './positionKey'
import { sideToMove } from './tree'
import {
  allExpandable,
  childViews,
  expandedToPly,
  formatGames,
  formatPercent,
  moveLabel,
  overrideCandidates,
  withOverride,
  type Candidate,
  type EdgeView,
} from './treeView'
import './treeViewer.css'

export interface TreeViewerProps {
  db?: TrainerDB
  client?: ExplorerClient
}

/** Initial expansion depth in plies. */
const INITIAL_PLY = 3

type RebuildStatus =
  | { kind: 'idle' }
  | { kind: 'building'; progress?: BuildProgress }
  | { kind: 'done'; message: string }
  | { kind: 'error'; message: string }

type SwapState =
  | { key: PositionKey; kind: 'loading' }
  | { key: PositionKey; kind: 'ready'; candidates: Candidate[] }
  | { key: PositionKey; kind: 'error'; message: string }

export function TreeViewer({ db: dbProp, client: clientProp }: TreeViewerProps) {
  const db = dbProp ?? getDb()
  const client = clientProp ?? null
  const rows = useLiveQuery(() => listRepertoires(db), [db])
  const [selectedId, setSelectedId] = useState<string>()
  const row = rows?.find((r) => r.id === selectedId) ?? rows?.[0]

  if (rows === undefined) return null
  if (!row)
    return (
      <main className="tree-viewer">
        <p className="tree-viewer__muted">No repertoires yet. Build one first.</p>
      </main>
    )

  return (
    <main className="tree-viewer">
      <header className="tree-viewer__header">
        <label>
          <span className="tree-viewer__label">Repertoire</span>{' '}
          <select value={row.id} onChange={(e) => setSelectedId(e.target.value)}>
            {rows.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
      </header>
      {/* Keyed so expansion and open panels reset when switching repertoires. */}
      <RepertoireTree key={row.id} row={row} db={db} client={client} />
    </main>
  )
}

function RepertoireTree({
  row,
  db,
  client,
}: {
  row: RepertoireRow
  db: TrainerDB
  client: ExplorerClient | null
}) {
  const tree = row.tree
  const [expanded, setExpanded] = useState(() => expandedToPly(tree, INITIAL_PLY))
  const [labels, setLabels] = useState<Record<PositionKey, OpeningLabel>>({})
  const [swap, setSwap] = useState<SwapState>()
  const [status, setStatus] = useState<RebuildStatus>({ kind: 'idle' })
  const abortRef = useRef<AbortController | null>(null)
  const overrides = useMemo(() => row.overrides ?? {}, [row.overrides])

  useEffect(() => () => abortRef.current?.abort(), [])

  useEffect(() => {
    let live = true
    loadOpeningIndex().then((index) => {
      if (live) setLabels(labelTree(tree, index))
    })
    return () => {
      live = false
    }
  }, [tree])

  const getClient = () => client ?? getExplorerClient()
  const building = status.kind === 'building'
  const nodes = Object.values(tree.nodes)
  const userMoves = nodes.filter((n) => sideToMove(n.key) === row.color && n.edges.length).length

  const toggle = (key: PositionKey) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  async function openSwap(key: PositionKey) {
    if (swap?.key === key) {
      setSwap(undefined)
      return
    }
    setSwap({ key, kind: 'loading' })
    try {
      const node = tree.nodes[key]
      const response = await getClient().get(explorerQueryFor(row, node.fen))
      const candidates = overrideCandidates(response, {
        ply: node.ply,
        userColor: row.color,
        settings: row.settings,
        currentSan: node.edges[0]?.san,
      })
      setSwap((s) => (s?.key === key ? { key, kind: 'ready', candidates } : s))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setSwap((s) => (s?.key === key ? { key, kind: 'error', message } : s))
    }
  }

  async function rebuild(
    nextOverrides: Record<PositionKey, string>,
    message: string,
    focus?: PositionKey,
  ) {
    setSwap(undefined)
    const controller = new AbortController()
    abortRef.current = controller
    setStatus({ kind: 'building' })
    try {
      const saved = await buildAndSave(db, {
        id: row.id,
        name: row.name,
        color: row.color,
        startMoves: row.startMoves,
        speeds: row.speeds,
        ratings: row.ratings,
        settings: row.settings,
        overrides: nextOverrides,
        client: getClient(),
        signal: controller.signal,
        onProgress: (progress) => setStatus({ kind: 'building', progress }),
      })
      // Open the changed line so the new continuation is visible.
      const next = focus && saved.tree.nodes[focus]?.edges[0]?.to
      if (focus && next) setExpanded((prev) => new Set(prev).add(focus).add(next))
      setStatus({ kind: 'done', message })
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError')
        setStatus({ kind: 'done', message: 'Rebuild cancelled. The tree is unchanged.' })
      else setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
    } finally {
      abortRef.current = null
    }
  }

  const choose = (key: PositionKey, candidate: Candidate, candidates: Candidate[]) => {
    const auto = candidates.find((c) => c.auto)?.san
    const label = moveLabel(tree.nodes[key].ply, candidate.san)
    rebuild(
      withOverride(overrides, key, candidate.san, auto),
      candidate.auto ? `Back to the automatic pick, ${label}.` : `Now playing ${label}.`,
      key,
    )
  }

  const overrideCount = Object.keys(overrides).length
  const rootLabel = labels[tree.rootKey]

  return (
    <>
      <div className="tree-viewer__toolbar">
        <p className="tree-viewer__muted">
          {row.color === 'white' ? 'White' : 'Black'} · {nodes.length} positions · {userMoves} of
          your moves
          {overrideCount > 0 && ` · ${overrideCount} changed by you`}
        </p>
        <div className="tree-viewer__actions">
          <button type="button" onClick={() => setExpanded(allExpandable(tree))}>
            Expand all
          </button>
          <button type="button" onClick={() => setExpanded(new Set([tree.rootKey]))}>
            Collapse all
          </button>
          {overrideCount > 0 && (
            <button
              type="button"
              disabled={building}
              onClick={() => rebuild({}, 'All your changes were cleared.')}
            >
              Reset changes
            </button>
          )}
        </div>
      </div>

      <RebuildStatusLine status={status} onCancel={() => abortRef.current?.abort()} />

      <div className="tree-viewer__tree" aria-busy={building}>
        <div className="tree-viewer__root">
          Start position{rootLabel && ` · ${rootLabel.opening.name}`}
        </div>
        <Children
          parentKey={tree.rootKey}
          ctx={{
            row,
            labels,
            expanded,
            overrides,
            swap,
            disabled: building,
            toggle,
            openSwap,
            choose,
          }}
        />
      </div>
    </>
  )
}

interface TreeContext {
  row: RepertoireRow
  labels: Record<PositionKey, OpeningLabel>
  expanded: Set<PositionKey>
  overrides: Record<PositionKey, string>
  swap: SwapState | undefined
  disabled: boolean
  toggle: (key: PositionKey) => void
  openSwap: (key: PositionKey) => void
  choose: (key: PositionKey, candidate: Candidate, candidates: Candidate[]) => void
}

function Children({ parentKey, ctx }: { parentKey: PositionKey; ctx: TreeContext }) {
  const views = childViews(ctx.row.tree, parentKey, ctx.row.color)
  if (views.length === 0) return null
  return (
    <ul className="tree-viewer__list">
      {views.map((view) => (
        <EdgeRow key={view.edge.uci} parentKey={parentKey} view={view} ctx={ctx} />
      ))}
    </ul>
  )
}

function EdgeRow({
  parentKey,
  view,
  ctx,
}: {
  parentKey: PositionKey
  view: EdgeView
  ctx: TreeContext
}) {
  const { child, canonical } = view
  const yours = view.mover === ctx.row.color
  // Start moves are part of the repertoire's definition; change them in the builder.
  const fixed = ctx.row.tree.nodes[parentKey].ply < ctx.row.startMoves.length
  const expandable = canonical && child.edges.length > 0
  const open = expandable && ctx.expanded.has(child.key)
  const label = ctx.labels[child.key]
  const changed = yours && ctx.overrides[parentKey] === view.edge.san
  const swapHere = ctx.swap?.key === parentKey

  return (
    <li className={yours ? 'tree-viewer__item is-yours' : 'tree-viewer__item'}>
      <div className="tree-viewer__row">
        {expandable ? (
          <button
            type="button"
            className="tree-viewer__toggle"
            aria-expanded={open}
            aria-label={`${open ? 'Collapse' : 'Expand'} ${view.label}`}
            onClick={() => ctx.toggle(child.key)}
          >
            {open ? '▾' : '▸'}
          </button>
        ) : (
          <span className="tree-viewer__toggle" aria-hidden="true" />
        )}
        <span className="tree-viewer__move">{view.label}</span>
        <span className="tree-viewer__name" title={label?.opening.name}>
          {!canonical
            ? '↪ transposes'
            : label?.exact
              ? `${label.opening.eco} ${label.opening.name}`
              : ''}
        </span>
        <span>{changed && <span className="tree-viewer__badge">your choice</span>}</span>
        <span className="tree-viewer__stat" title={`${view.games.toLocaleString()} games`}>
          {formatGames(view.games)}
        </span>
        <span className="tree-viewer__stat tree-viewer__stat--share">
          {view.share === undefined ? '' : formatPercent(view.share)}
        </span>
        <ResultBar view={view} />
        {yours && !fixed ? (
          <button
            type="button"
            className="tree-viewer__change"
            disabled={ctx.disabled}
            aria-expanded={swapHere}
            onClick={() => ctx.openSwap(parentKey)}
          >
            Change
          </button>
        ) : (
          <span className="tree-viewer__change" aria-hidden="true" />
        )}
      </div>
      {swapHere && ctx.swap && <SwapPanel parentKey={parentKey} swap={ctx.swap} ctx={ctx} />}
      {open && <Children parentKey={child.key} ctx={ctx} />}
    </li>
  )
}

function ResultBar({ view }: { view: EdgeView }) {
  const { white, draws, black } = view.split
  const title = `White ${Math.round(white)}% · Draw ${Math.round(draws)}% · Black ${Math.round(black)}%`
  return (
    <span className="tree-viewer__bar" title={title} aria-label={title} role="img">
      <span className="is-white" style={{ width: `${white}%` }} />
      <span className="is-draw" style={{ width: `${draws}%` }} />
      <span className="is-black" style={{ width: `${black}%` }} />
    </span>
  )
}

function SwapPanel({
  parentKey,
  swap,
  ctx,
}: {
  parentKey: PositionKey
  swap: SwapState
  ctx: TreeContext
}) {
  const ply = ctx.row.tree.nodes[parentKey].ply
  return (
    <div className="tree-viewer__swap" role="group" aria-label="Choose your move">
      {swap.kind === 'loading' && <p className="tree-viewer__muted">Loading moves…</p>}
      {swap.kind === 'error' && (
        <p className="tree-viewer__error">Could not load moves: {swap.message}</p>
      )}
      {swap.kind === 'ready' && (
        <>
          <p className="tree-viewer__muted">
            Pick your move here. Everything after it is rebuilt from the explorer.
          </p>
          <ul>
            {swap.candidates.map((c) => (
              <li key={c.san}>
                <button
                  type="button"
                  disabled={c.current || ctx.disabled}
                  aria-current={c.current ? 'true' : undefined}
                  onClick={() => ctx.choose(parentKey, c, swap.candidates)}
                >
                  <span className="tree-viewer__move">{moveLabel(ply, c.san)}</span>
                  <span>{formatPercent(c.share)} played</span>
                  <span>you score {formatPercent(c.score)}</span>
                  {c.auto && <span className="tree-viewer__badge">auto pick</span>}
                  {c.current && <span className="tree-viewer__badge">current</span>}
                  {!c.eligible && <span className="tree-viewer__muted">rare</span>}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

function RebuildStatusLine({ status, onCancel }: { status: RebuildStatus; onCancel: () => void }) {
  if (status.kind === 'idle') return null
  return (
    <div className="tree-viewer__status" role="status">
      {status.kind === 'building' && (
        <>
          <span>
            Rebuilding…
            {status.progress && ` ${status.progress.positions} positions so far`}
          </span>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        </>
      )}
      {status.kind === 'done' && <span>{status.message}</span>}
      {status.kind === 'error' && (
        <span className="tree-viewer__error">Rebuild failed: {status.message}</span>
      )}
    </div>
  )
}
