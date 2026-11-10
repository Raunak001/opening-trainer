import type { DrawShape } from 'chessground/draw'
import type { Key, SquareClasses } from 'chessground/types'
import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Board } from '../board'
import { getDb, getSettings, type AppSettings, type GameRow, type TrainerDB } from '../db'
import type { Engine } from '../engine/engine'
import { SearchCancelledError } from '../engine/engine'
import { dexieEvalCache } from '../engine/evalCache'
import { formatScore } from '../engine/explain'
import { getSharedEngine } from '../engine/shared'
import { loadOpeningIndex } from '../repertoire/openings'
import { positionKey } from '../repertoire/positionKey'
import { TrainerLayout } from '../trainer/TrainerLayout'
import { moveRows } from '../trainer/moveRows'
import { analysisRow, analyzeGame, gameFens, saveAnalysis } from './analyze'
import {
  bookPlies,
  KEY_MARKS,
  MARKS,
  reviewGame,
  type MoveMark,
  type MoveReview,
  type Side,
} from './classify'
import { describeMove, MARK_STYLES, markIconSvg, squareMarkSvg } from './describe'
import { EvalGraph } from './EvalGraph'
import './analysis.css'

export interface GameReviewProps {
  game: GameRow
  onBack: () => void
  db?: TrainerDB
  /** Stockfish by default. */
  engine?: Engine
}

type RunState =
  | { kind: 'idle' }
  | { kind: 'running'; done: number; total: number }
  | { kind: 'stopped' }
  | { kind: 'error'; message: string }

/** Marks that get a "best was" arrow on the board. */
const SHOW_BEST: ReadonlySet<MoveMark> = new Set([
  'good',
  'inaccuracy',
  'mistake',
  'miss',
  'blunder',
])

export function MarkIcon({ mark, size = 18 }: { mark: MoveMark; size?: number }) {
  return (
    <svg
      className="mark-icon"
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label={MARK_STYLES[mark].label}
      dangerouslySetInnerHTML={{ __html: markIconSvg(mark) }}
    />
  )
}

/** chess.com-style review of one imported game: marks, accuracy, eval graph. */
export function GameReview({ game, onBack, db: dbProp, engine: engineProp }: GameReviewProps) {
  const db = dbProp ?? getDb()
  const stored = useLiveQuery(async () => (await db.analyses.get(game.id)) ?? null, [db, game.id])
  const [settings, setSettings] = useState<AppSettings>()
  const [book, setBook] = useState<number>()
  const [run, setRun] = useState<RunState>({ kind: 'idle' })
  const [ply, setPly] = useState(0)
  const abort = useRef<AbortController>(undefined)
  const fens = useMemo(() => gameFens(game.sans), [game.sans])
  const n = game.sans.length

  useEffect(() => {
    let live = true
    getSettings(db).then((s) => live && setSettings(s))
    loadOpeningIndex()
      .then((index) => live && setBook(bookPlies(game.sans, (f) => index.has(positionKey(f)))))
      .catch(() => live && setBook(0))
    return () => {
      live = false
      abort.current?.abort()
    }
  }, [db, game.sans])

  const analyze = useCallback(async () => {
    if (!settings) return
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    setRun({ kind: 'running', done: 0, total: n + 1 })
    try {
      const engine = engineProp ?? getSharedEngine()
      const evals = await analyzeGame(engine, game.sans, {
        depth: settings.analysis.depth,
        signal: controller.signal,
        cache: dexieEvalCache(db),
        onProgress: (done, total) => setRun({ kind: 'running', done, total }),
      })
      await saveAnalysis(
        db,
        analysisRow(game.id, game.sans, evals, settings.analysis.depth, Date.now()),
      )
      setRun({ kind: 'idle' })
    } catch (err) {
      if (err instanceof SearchCancelledError || controller.signal.aborted) {
        if (abort.current === controller) setRun({ kind: 'stopped' })
      } else setRun({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }, [db, engineProp, game.id, game.sans, n, settings])

  // Start straight away, like chess.com, when the game has no stored analysis.
  const started = useRef(false)
  useEffect(() => {
    if (stored === null && settings && !started.current) {
      started.current = true
      void analyze()
    }
  }, [stored, settings, analyze])

  const review = useMemo(() => {
    if (!stored || !settings || book === undefined) return undefined
    if (stored.evals.length !== n + 1) return undefined
    return reviewGame(game.sans, stored.evals, { thresholds: settings.analysis, book })
  }, [stored, settings, book, game.sans, n])

  const go = useCallback((p: number) => setPly(Math.max(0, Math.min(n, p))), [n])
  const mine: Side = game.color
  const nextKey = useCallback(
    (dir: 1 | -1) => {
      if (!review) return
      const list = review.moves.filter((m) => m.color === mine && KEY_MARKS.has(m.mark))
      const target =
        dir === 1
          ? list.find((m) => m.ply + 1 > ply)
          : [...list].reverse().find((m) => m.ply + 1 < ply)
      if (target) go(target.ply + 1)
    },
    [review, mine, ply, go],
  )

  // ← → (and Home/End) step through the game from anywhere on the page, not only the board.
  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.defaultPrevented) return
      const target = e.target
      if (
        target instanceof Element &&
        target.closest('input, textarea, select, [contenteditable="true"]')
      )
        return
      const step: Record<string, (p: number) => number> = {
        ArrowLeft: (p) => p - 1,
        ArrowRight: (p) => p + 1,
        Home: () => 0,
        End: () => n,
      }
      const next = step[e.key]
      if (!next) return
      e.preventDefault()
      setPly((p) => Math.max(0, Math.min(n, next(p))))
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [n])

  const current: MoveReview | undefined = review && ply > 0 ? review.moves[ply - 1] : undefined
  const lastMove: [Key, Key] | undefined = useMemo(() => {
    if (ply === 0) return undefined
    const m = review?.moves[ply - 1]
    if (m) return [m.from as Key, m.to as Key]
    return undefined
  }, [ply, review])

  const shapes = useMemo<DrawShape[]>(() => {
    if (!current) return []
    const out: DrawShape[] = [
      { orig: current.to as Key, customSvg: { html: squareMarkSvg(current.mark) } },
    ]
    if (SHOW_BEST.has(current.mark) && current.best) {
      out.push({
        orig: current.best.uci.slice(0, 2) as Key,
        dest: current.best.uci.slice(2, 4) as Key,
        brush: 'green',
      })
    }
    return out
  }, [current])

  const squareClasses = useMemo<SquareClasses>(() => {
    const map: SquareClasses = new Map()
    if (current) {
      map.set(current.from as Key, `review-mark review-mark--${current.mark}`)
      map.set(current.to as Key, `review-mark review-mark--${current.mark}`)
    }
    return map
  }, [current])

  const comment =
    current && stored
      ? describeMove(current, stored.evals[ply - 1], stored.evals[ply], game.sans)
      : undefined

  const whiteWin = review?.whiteWin[ply] ?? 50
  const evalText = stored?.evals[ply]
    ? formatScore(
        fens[ply].split(' ')[1] === 'w'
          ? stored.evals[ply].score
          : flipScore(stored.evals[ply].score),
      )
    : ''
  const names: Record<Side, string> = {
    white: game.color === 'white' ? 'You' : game.opponent,
    black: game.color === 'black' ? 'You' : game.opponent,
  }

  return (
    <TrainerLayout className="game-review">
      <section
        className={`game-review__board game-review__board--${game.color}`}
        aria-label="Board"
      >
        <div className="eval-bar" aria-label={`Evaluation ${evalText}`}>
          <div className="eval-bar__white" style={{ height: `${whiteWin}%` }} />
          <span className={`eval-bar__text eval-bar__text--${whiteWin >= 50 ? 'white' : 'black'}`}>
            {evalText.replace(/^\+/, '')}
          </span>
        </div>
        <Board
          fen={fens[ply]}
          orientation={game.color}
          lastMove={lastMove}
          interactive={false}
          shapes={shapes}
          squareClasses={squareClasses}
        />
      </section>

      <aside className="side-panel review-panel" aria-label="Game review">
        <header className="review-panel__header">
          <button type="button" onClick={onBack}>
            ‹ Games
          </button>
          <span className="review-panel__title">Game Review</span>
          <a href={game.id} target="_blank" rel="noreferrer" className="review-panel__link">
            chess.com ↗
          </a>
        </header>

        <div className="review-panel__players">
          {(['white', 'black'] as const).map((side) => (
            <div key={side} className="review-panel__player">
              <span className="review-panel__name">{names[side]}</span>
              <span className={`review-panel__acc review-panel__acc--${side}`}>
                {review ? review.accuracy[side].toFixed(1) : '–'}
              </span>
            </div>
          ))}
          <span className="review-panel__acc-label">Accuracy</span>
        </div>

        {run.kind === 'running' && (
          <div className="review-panel__progress" role="status">
            <span>
              Analyzing with Stockfish… {run.done}/{run.total}
            </span>
            <progress value={run.done} max={run.total} />
            <button type="button" onClick={() => abort.current?.abort()}>
              Stop
            </button>
          </div>
        )}
        {(run.kind === 'stopped' || run.kind === 'error') && (
          <div className="review-panel__progress" role={run.kind === 'error' ? 'alert' : 'status'}>
            <span>
              {run.kind === 'error' ? `Analysis failed: ${run.message}` : 'Analysis stopped.'}
            </span>
            <button type="button" className="review-panel__primary" onClick={() => void analyze()}>
              Analyze
            </button>
          </div>
        )}

        {review && (
          <>
            <div className={`review-panel__coach review-panel__coach--${current?.mark ?? 'none'}`}>
              {current && comment ? (
                <>
                  <p className="review-panel__headline">
                    <MarkIcon mark={current.mark} size={22} />
                    <span>{comment.headline}</span>
                    <span className="review-panel__eval">{comment.evalText}</span>
                  </p>
                  {comment.lines.map((line) => (
                    <p key={line} className="review-panel__line">
                      {line}
                    </p>
                  ))}
                </>
              ) : (
                <p className="review-panel__line">
                  Step through the game with ← →, or jump between your key moments.
                </p>
              )}
            </div>

            <EvalGraph whiteWin={review.whiteWin} moves={review.moves} ply={ply} onSelect={go} />

            <ReviewMoveList moves={review.moves} ply={ply} onSelect={go} />

            <div className="review-panel__nav">
              <button type="button" aria-label="Start" onClick={() => go(0)} disabled={ply === 0}>
                «
              </button>
              <button
                type="button"
                aria-label="Back"
                onClick={() => go(ply - 1)}
                disabled={ply === 0}
              >
                ‹
              </button>
              <button
                type="button"
                aria-label="Forward"
                onClick={() => go(ply + 1)}
                disabled={ply === n}
              >
                ›
              </button>
              <button type="button" aria-label="End" onClick={() => go(n)} disabled={ply === n}>
                »
              </button>
            </div>
            <div className="review-panel__nav">
              <button type="button" onClick={() => nextKey(-1)}>
                ‹ Previous
              </button>
              <button type="button" className="review-panel__primary" onClick={() => nextKey(1)}>
                Next key moment ›
              </button>
            </div>

            <table className="review-panel__summary">
              <thead>
                <tr>
                  <th>{names.white}</th>
                  <th />
                  <th>{names.black}</th>
                </tr>
              </thead>
              <tbody>
                {MARKS.map((mark) => (
                  <tr key={mark} style={{ color: MARK_STYLES[mark].color }}>
                    <td>{review.counts.white[mark]}</td>
                    <td className="review-panel__summary-mark">
                      <MarkIcon mark={mark} />
                      {MARK_STYLES[mark].label}
                    </td>
                    <td>{review.counts.black[mark]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="review-panel__muted">
              Stockfish depth {stored?.depth} · accuracy uses the Lichess formula
            </p>
          </>
        )}
      </aside>
    </TrainerLayout>
  )
}

function flipScore(score: { type: 'cp' | 'mate'; value: number }) {
  return score.type === 'mate'
    ? { type: 'mate' as const, value: score.value === 0 ? 0 : -score.value }
    : { type: 'cp' as const, value: -score.value }
}

function ReviewMoveList({
  moves,
  ply,
  onSelect,
}: {
  moves: readonly MoveReview[]
  ply: number
  onSelect: (ply: number) => void
}) {
  const listRef = useRef<HTMLOListElement>(null)
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[aria-current="true"]')
      ?.scrollIntoView?.({ block: 'nearest' })
  }, [ply])

  const cell = (m: { ply: number } | undefined) => {
    const r = m && moves[m.ply]
    if (!r) return <span />
    return (
      <button
        type="button"
        className="review-moves__move"
        aria-current={r.ply + 1 === ply ? 'true' : undefined}
        onClick={() => onSelect(r.ply + 1)}
        title={MARK_STYLES[r.mark].label}
      >
        <MarkIcon mark={r.mark} size={16} />
        {r.san}
      </button>
    )
  }

  return (
    <ol className="review-moves" aria-label="Moves" ref={listRef}>
      {moveRows(moves.map((m) => m.san)).map((row) => (
        <li key={row.number} className="review-moves__row">
          <span className="review-moves__number">{row.number}.</span>
          {cell(row.white)}
          {cell(row.black)}
        </li>
      ))}
    </ol>
  )
}
