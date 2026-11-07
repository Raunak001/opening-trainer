import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { getDb, type TrainerDB } from '../db'
import { syncCards } from '../srs'
import { buildAndSave, listRepertoires, type BuildProgress } from './builder'
import {
  bucketUpperLabel,
  DEFAULT_FORM,
  formatLine,
  formFromRow,
  parseStartMoves,
  RATING_BUCKETS,
  SPEED_LABELS,
  SPEEDS,
  validateForm,
  type BuilderForm,
  type FormField,
} from './builderForm'
import { getExplorerClient, type ExplorerClient, type RatingBucket, type Speed } from './explorer'
import './builder.css'

export interface BuilderPageProps {
  /** Injected in tests; defaults to the app database and explorer client. */
  db?: TrainerDB
  client?: ExplorerClient
}

type Status =
  | { kind: 'idle' }
  | { kind: 'building'; progress?: BuildProgress }
  | { kind: 'done'; name: string; positions: number; cards: number }
  | { kind: 'cancelled' }
  | { kind: 'error'; message: string }

export function BuilderPage({ db: dbProp, client: clientProp }: BuilderPageProps) {
  const db = dbProp ?? getDb()
  const [form, setForm] = useState<BuilderForm>(DEFAULT_FORM)
  const [errors, setErrors] = useState<Partial<Record<FormField, string>>>({})
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const abortRef = useRef<AbortController | null>(null)
  const saved = useLiveQuery(() => listRepertoires(db), [db])

  // Cancel an in-flight build if the page goes away.
  useEffect(() => () => abortRef.current?.abort(), [])

  const building = status.kind === 'building'
  const parsedMoves = useMemo(() => parseStartMoves(form.startMoves), [form.startMoves])

  const update = <K extends keyof BuilderForm>(key: K, value: BuilderForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const toggleSpeed = (speed: Speed, on: boolean) =>
    update('speeds', on ? [...form.speeds, speed] : form.speeds.filter((s) => s !== speed))

  const edit = (next: BuilderForm) => {
    setForm(next)
    setErrors({})
    setStatus({ kind: 'idle' })
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const result = validateForm(form)
    if (!result.ok) {
      setErrors(result.errors)
      return
    }
    setErrors({})
    const controller = new AbortController()
    abortRef.current = controller
    setStatus({ kind: 'building' })
    try {
      const row = await buildAndSave(db, {
        ...result.value,
        client: clientProp ?? getExplorerClient(),
        signal: controller.signal,
        onProgress: (progress) => setStatus({ kind: 'building', progress }),
      })
      setForm(formFromRow(row))
      const cards = await syncCards(db, row.id)
      setStatus({
        kind: 'done',
        name: row.name,
        positions: Object.keys(row.tree.nodes).length,
        cards: cards.added + cards.reset + cards.resumed + cards.unchanged,
      })
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') setStatus({ kind: 'cancelled' })
      else setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
    } finally {
      abortRef.current = null
    }
  }

  return (
    <main className="builder">
      <form
        className="builder__form"
        onSubmit={onSubmit}
        noValidate
        aria-label="Repertoire builder"
      >
        <header className="builder__header">
          <h1>{form.id ? 'Edit repertoire' : 'New repertoire'}</h1>
          {form.id && (
            <button type="button" disabled={building} onClick={() => edit(DEFAULT_FORM)}>
              New
            </button>
          )}
        </header>

        <fieldset disabled={building}>
          <Field label="Name" error={errors.name}>
            {(id) => (
              <input
                id={id}
                type="text"
                value={form.name}
                placeholder="e.g. 1.e4 for White"
                onChange={(e) => update('name', e.target.value)}
              />
            )}
          </Field>

          <div className="builder__group" role="radiogroup" aria-label="Play as">
            <span className="builder__label">Play as</span>
            <div className="builder__segmented">
              {(['white', 'black'] as const).map((c) => (
                <label key={c} className={form.color === c ? 'is-selected' : undefined}>
                  <input
                    type="radio"
                    name="color"
                    value={c}
                    checked={form.color === c}
                    onChange={() => update('color', c)}
                  />
                  {c === 'white' ? 'White' : 'Black'}
                </label>
              ))}
            </div>
          </div>

          <Field
            label="Start moves"
            error={errors.startMoves}
            hint={
              parsedMoves.ok
                ? parsedMoves.sans.length
                  ? `Every line starts ${formatLine(parsedMoves.sans)}`
                  : 'Lines start from the initial position.'
                : parsedMoves.error
            }
          >
            {(id) => (
              <input
                id={id}
                type="text"
                value={form.startMoves}
                placeholder="1.e4 e5 2.Nf3"
                spellCheck={false}
                onChange={(e) => update('startMoves', e.target.value)}
              />
            )}
          </Field>

          <div className="builder__group">
            <span className="builder__label">Opponent rating</span>
            <div className="builder__row">
              <label>
                From{' '}
                <select
                  aria-label="Rating from"
                  value={form.ratingMin}
                  onChange={(e) => update('ratingMin', Number(e.target.value) as RatingBucket)}
                >
                  {RATING_BUCKETS.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                to{' '}
                <select
                  aria-label="Rating to"
                  value={form.ratingMax}
                  onChange={(e) => update('ratingMax', Number(e.target.value) as RatingBucket)}
                >
                  {RATING_BUCKETS.map((b) => (
                    <option key={b} value={b}>
                      {bucketUpperLabel(b)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {errors.rating && <p className="builder__error">{errors.rating}</p>}
          </div>

          <div className="builder__group" role="group" aria-label="Time controls">
            <span className="builder__label">Time controls</span>
            <div className="builder__chips">
              {SPEEDS.map((s) => (
                <label key={s} className={form.speeds.includes(s) ? 'is-selected' : undefined}>
                  <input
                    type="checkbox"
                    checked={form.speeds.includes(s)}
                    onChange={(e) => toggleSpeed(s, e.target.checked)}
                  />
                  {SPEED_LABELS[s]}
                </label>
              ))}
            </div>
            {errors.speeds && <p className="builder__error">{errors.speeds}</p>}
          </div>

          <div className="builder__row builder__row--numbers">
            <Field
              label="Coverage %"
              error={errors.coverage}
              hint="Keep opponent replies until they cover this share of games."
            >
              {(id) => (
                <input
                  id={id}
                  type="number"
                  min={1}
                  max={100}
                  value={form.coverage}
                  onChange={(e) => update('coverage', e.target.value)}
                />
              )}
            </Field>
            <Field label="Floor %" error={errors.floor} hint="Ignore replies rarer than this.">
              {(id) => (
                <input
                  id={id}
                  type="number"
                  min={0}
                  max={100}
                  step="0.5"
                  value={form.floor}
                  onChange={(e) => update('floor', e.target.value)}
                />
              )}
            </Field>
            <Field
              label="Depth (plies)"
              error={errors.maxPly}
              hint="Half-moves from the start; 6 ≈ three moves each."
            >
              {(id) => (
                <input
                  id={id}
                  type="number"
                  min={1}
                  max={40}
                  value={form.maxPly}
                  onChange={(e) => update('maxPly', e.target.value)}
                />
              )}
            </Field>
          </div>
        </fieldset>

        <footer className="builder__footer">
          {building ? (
            <button type="button" onClick={() => abortRef.current?.abort()}>
              Cancel
            </button>
          ) : (
            <button type="submit" className="builder__primary">
              {form.id ? 'Rebuild & save' : 'Build & save'}
            </button>
          )}
          <StatusLine status={status} />
        </footer>
      </form>

      <aside className="builder__saved" aria-label="Saved repertoires">
        <h2>Saved repertoires</h2>
        {saved === undefined ? null : saved.length === 0 ? (
          <p className="builder__muted">None yet.</p>
        ) : (
          <ul>
            {saved.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  disabled={building}
                  aria-current={r.id === form.id ? 'true' : undefined}
                  onClick={() => edit(formFromRow(r))}
                >
                  <span className="builder__saved-name">{r.name}</span>
                  <span className="builder__muted">
                    {r.color === 'white' ? 'White' : 'Black'} ·{' '}
                    {formatLine(r.startMoves) || 'start'} · {r.positionCount} positions
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </main>
  )
}

function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string
  error?: string
  hint?: string
  children: (id: string) => ReactNode
}) {
  const id = useId()
  return (
    <div className="builder__field">
      <label className="builder__label" htmlFor={id}>
        {label}
      </label>
      {children(id)}
      {error ? (
        <p className="builder__error">{error}</p>
      ) : (
        hint && <p className="builder__muted">{hint}</p>
      )}
    </div>
  )
}

function StatusLine({ status }: { status: Status }) {
  let text: string
  switch (status.kind) {
    case 'idle':
      return null
    case 'building':
      text = status.progress
        ? `Building… ${status.progress.positions} positions, ${status.progress.queued} to look up. Lichess rate limits can pause this for a minute.`
        : 'Building…'
      break
    case 'done':
      text = `Saved “${status.name}” · ${status.positions} positions · ${status.cards} ${status.cards === 1 ? 'card' : 'cards'}`
      break
    case 'cancelled':
      text = 'Build cancelled. Nothing was saved.'
      break
    case 'error':
      text = `Build failed: ${status.message}`
      break
  }
  return (
    <p className={`builder__status builder__status--${status.kind}`} role="status">
      {text}
    </p>
  )
}
