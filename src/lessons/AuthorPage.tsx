import { Chess } from 'chess.js'
import type { DrawShape } from 'chessground/draw'
import type { Key } from 'chessground/types'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ARROW_BRUSH, Board, type PromotionPiece } from '../board'
import { DEFAULT_SETTINGS, getDb, getSettings, type AppSettings, type TrainerDB } from '../db'
import { getSharedEngine, SearchCancelledError, type Engine, type InfoLine } from '../engine'
import { formatScore } from '../engine/explain'
import { TrainerLayout } from '../trainer/TrainerLayout'
import {
  candidateLines,
  draftExplanation,
  formFromLesson,
  lessonFromForm,
  moveLesson,
  nextLessonId,
  packToJson,
  putLesson,
  removeLesson,
  slugify,
  type LessonForm,
} from './authoring'
import { CONCEPTS, conceptLabel, lessonSide, validatePack, type LessonPack } from './lesson'
import { bundledPacks } from './packs'
import './lessons.css'

export interface AuthorPageProps {
  db?: TrainerDB
  /** The engine to analyse with; defaults to the app's shared Stockfish. */
  engine?: () => Engine
  /** Packs offered for editing; defaults to the bundled ones. */
  packs?: LessonPack[]
  /** Position to start from, e.g. a mined candidate. */
  initialFen?: string
  /** Concept to start with, e.g. a mined candidate's. */
  initialConcept?: string
  /** Saves the exported file; defaults to a download. */
  saveFile?: (name: string, text: string) => void
}

const START_FEN = new Chess().fen()

function downloadFile(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

const EMPTY_PACK: LessonPack = { id: '', name: '', lessons: [] }

interface Analysis {
  fen: string
  lines: InfoLine[]
  running: boolean
  error?: string
}

function emptyForm(fen: string, concept: string, pack: LessonPack): LessonForm {
  return {
    id: nextLessonId(pack, concept),
    concept,
    fen,
    prompt: '',
    accepted: [],
    hints: '',
    explanation: '',
  }
}

/**
 * Lesson authoring: set up a position, let Stockfish pick the accepted moves (multi-PV,
 * within a margin of the best), write the text, collect lessons into a pack, export JSON.
 */
export function AuthorPage({
  db: dbProp,
  engine: engineProp,
  packs: packsProp,
  initialFen = START_FEN,
  initialConcept = 'strike-center',
  saveFile = downloadFile,
}: AuthorPageProps) {
  const db = dbProp ?? getDb()
  const packs = packsProp ?? bundledPacks().packs
  const [settings, setSettings] = useState<AppSettings['lessons']>(DEFAULT_SETTINGS.lessons)
  const [history, setHistory] = useState<string[]>([])
  const [pack, setPack] = useState<LessonPack>(EMPTY_PACK)
  const [form, setForm] = useState<LessonForm>(() =>
    emptyForm(new Chess(initialFen).fen(), initialConcept, EMPTY_PACK),
  )
  const [fenInput, setFenInput] = useState(form.fen)
  const [extraMove, setExtraMove] = useState('')
  const [analysis, setAnalysis] = useState<Analysis>()
  const [errors, setErrors] = useState<string[]>([])
  const [notice, setNotice] = useState<string>()
  const [json, setJson] = useState<string>()
  const abort = useRef<AbortController>(undefined)
  const fen = form.fen

  useEffect(() => {
    let live = true
    getSettings(db)
      .then((s) => live && setSettings(s.lessons))
      .catch(() => {
        // Defaults are fine for authoring.
      })
    return () => {
      live = false
    }
  }, [db])

  useEffect(() => () => abort.current?.abort(), [])

  const update = (patch: Partial<LessonForm>) => setForm((f) => ({ ...f, ...patch }))

  /** A new position: drops the analysis and the accepted moves. */
  const goTo = useCallback(
    (next: string, pushHistory: boolean) => {
      abort.current?.abort()
      setAnalysis(undefined)
      if (pushHistory) setHistory((h) => [...h, fen])
      setForm((f) => ({ ...f, fen: next, accepted: [] }))
      setFenInput(next)
      setErrors([])
    },
    [fen],
  )

  const onMove = useCallback(
    (from: Key, to: Key, promotion?: PromotionPiece) => {
      try {
        goTo(new Chess(fen).move({ from, to, promotion }).after, true)
      } catch {
        // The board only offers legal moves.
      }
    },
    [fen, goTo],
  )

  const loadFen = () => {
    try {
      goTo(new Chess(fenInput.trim()).fen(), true)
    } catch (error) {
      setErrors([`Invalid FEN: ${(error as Error).message}`])
    }
  }

  const undo = () => {
    const previous = history[history.length - 1]
    if (previous === undefined) return
    setHistory((h) => h.slice(0, -1))
    goTo(previous, false)
  }

  const candidates = useMemo(
    () =>
      analysis && analysis.fen === fen
        ? candidateLines(fen, analysis.lines, settings.acceptWithinCp)
        : [],
    [analysis, fen, settings.acceptWithinCp],
  )

  const analyse = async () => {
    let engine: Engine
    try {
      engine = (engineProp ?? getSharedEngine)()
    } catch (error) {
      setAnalysis({ fen, lines: [], running: false, error: (error as Error).message })
      return
    }
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    setAnalysis({ fen, lines: [], running: true })
    const latest = new Map<number, InfoLine>()
    try {
      const result = await engine.search(
        fen,
        { depth: settings.depth, multiPv: settings.multiPv },
        {
          signal: controller.signal,
          onInfo: (info) => {
            latest.set(info.multipv, info)
            setAnalysis({ fen, lines: [...latest.values()], running: true })
          },
        },
      )
      const found = candidateLines(fen, result.lines, settings.acceptWithinCp)
      setAnalysis({ fen, lines: result.lines, running: false })
      setForm((f) =>
        f.fen === fen
          ? {
              ...f,
              accepted: found.filter((c) => c.autoAccepted).map((c) => c.san),
              explanation: f.explanation.trim() === '' ? draftExplanation(found) : f.explanation,
            }
          : f,
      )
    } catch (error) {
      if (error instanceof SearchCancelledError) return
      setAnalysis({ fen, lines: [], running: false, error: (error as Error).message })
    }
  }

  const toggleAccepted = (san: string) =>
    setForm((f) => ({
      ...f,
      accepted: f.accepted.includes(san)
        ? f.accepted.filter((s) => s !== san)
        : [...f.accepted, san],
    }))

  const addExtraMove = () => {
    const text = extraMove.trim()
    if (!text) return
    try {
      const san = new Chess(fen).move(text).san
      if (!form.accepted.includes(san)) update({ accepted: [...form.accepted, san] })
      setExtraMove('')
      setErrors([])
    } catch {
      setErrors([`${text} is not legal here`])
    }
  }

  const makeMain = (san: string) =>
    update({ accepted: [san, ...form.accepted.filter((s) => s !== san)] })

  const saveLesson = () => {
    const { lesson, errors: formErrors } = lessonFromForm(form)
    if (!lesson) return setErrors(formErrors)
    const result = putLesson(pack, lesson)
    if (result.error !== undefined) return setErrors([result.error])
    setPack(result.pack)
    setErrors([])
    setJson(undefined)
    setNotice(`Saved ${lesson.id} to the pack.`)
  }

  const newLesson = () => {
    setForm((f) => emptyForm(f.fen, f.concept, pack))
    setAnalysis(undefined)
    setErrors([])
    setNotice(undefined)
  }

  const editLesson = (id: string) => {
    const lesson = pack.lessons.find((l) => l.id === id)
    if (!lesson) return
    abort.current?.abort()
    setForm(formFromLesson(lesson))
    setFenInput(lesson.fen)
    setAnalysis(undefined)
    setHistory([])
    setErrors([])
    setNotice(`Editing ${id}.`)
  }

  const openPack = (raw: unknown, what: string) => {
    const result = validatePack(raw)
    if (!result.ok) return setErrors(result.errors.map((e) => `${what}: ${e}`))
    setPack(result.pack)
    setForm((f) => ({ ...f, id: nextLessonId(result.pack, f.concept) }))
    setErrors([])
    setJson(undefined)
    setNotice(`Opened "${result.pack.name}" (${result.pack.lessons.length} lessons).`)
  }

  const onFile = async (file: File | undefined) => {
    if (!file) return
    try {
      openPack(JSON.parse(await file.text()), file.name)
    } catch (error) {
      setErrors([`${file.name}: ${(error as Error).message}`])
    }
  }

  const exportPack = () => {
    const id = pack.id.trim() || slugify(pack.name)
    const result = validatePack({ ...pack, id })
    if (!result.ok) return setErrors(result.errors)
    const text = packToJson(result.pack)
    setPack(result.pack)
    setJson(text)
    setErrors([])
    saveFile(`${result.pack.id}.json`, text)
    setNotice(`Exported ${result.pack.id}.json. Save it in src/lessons/packs/ to bundle it.`)
  }

  const shapes = useMemo<DrawShape[]>(() => {
    const chess = new Chess(fen)
    return form.accepted.flatMap((san, i) => {
      try {
        const m = new Chess(chess.fen()).move(san)
        return [{ orig: m.from, dest: m.to, brush: i === 0 ? ARROW_BRUSH : 'green' }]
      } catch {
        return []
      }
    })
  }, [fen, form.accepted])

  const side = lessonSide({ fen })
  const conceptOptions = Object.keys(CONCEPTS).includes(form.concept)
    ? Object.keys(CONCEPTS)
    : [...Object.keys(CONCEPTS), form.concept]

  return (
    <>
      <TrainerLayout className="author-layout">
        <Board fen={fen} orientation={side} shapes={shapes} onMove={onMove} />
        <aside className="author" aria-label="Lesson editor">
          <section className="author__section">
            <h2>Position</h2>
            <label>
              FEN
              <input value={fenInput} onChange={(e) => setFenInput(e.target.value)} />
            </label>
            <div className="author__row">
              <button type="button" onClick={loadFen}>
                Load FEN
              </button>
              <button type="button" onClick={undo} disabled={history.length === 0}>
                Undo
              </button>
              <button type="button" onClick={() => goTo(START_FEN, true)}>
                Start position
              </button>
            </div>
            <p className="lessons__muted">
              Play moves on the board to set up the position. {side === 'white' ? 'White' : 'Black'}{' '}
              to move: the user plays {side === 'white' ? 'White' : 'Black'}.
            </p>
          </section>

          <section className="author__section">
            <div className="author__row author__row--spread">
              <h2>Stockfish</h2>
              <button type="button" onClick={analyse} disabled={analysis?.running}>
                {analysis?.running ? 'Analysing…' : 'Analyse'}
              </button>
            </div>
            {analysis?.error && <p className="author__error">Engine: {analysis.error}</p>}
            {candidates.length > 0 && (
              <ul className="author__lines" aria-label="Engine lines">
                {candidates.map((c) => (
                  <li key={c.san}>
                    <label>
                      <input
                        type="checkbox"
                        checked={form.accepted.includes(c.san)}
                        onChange={() => toggleAccepted(c.san)}
                      />
                      <strong>{c.san}</strong> <span>{formatScore(c.whiteScore)}</span>
                    </label>
                    <span className="lessons__muted">{c.pvSan.slice(0, 6).join(' ')}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="lessons__muted">
              Depth {settings.depth}, {settings.multiPv} lines. Moves within{' '}
              {settings.acceptWithinCp}cp of the best are accepted.
            </p>
          </section>

          <section className="author__section">
            <h2>Lesson</h2>
            <div className="author__row">
              <label>
                Id
                <input value={form.id} onChange={(e) => update({ id: e.target.value })} />
              </label>
              <label>
                Concept
                <select value={form.concept} onChange={(e) => update({ concept: e.target.value })}>
                  {conceptOptions.map((c) => (
                    <option key={c} value={c}>
                      {conceptLabel(c)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div>
              <span className="author__label">Accepted moves</span>
              {form.accepted.length === 0 ? (
                <p className="lessons__muted">None yet: analyse, or add one below.</p>
              ) : (
                <ul className="author__accepted" aria-label="Accepted moves">
                  {form.accepted.map((san, i) => (
                    <li key={san}>
                      <span>
                        {san}
                        {i === 0 && ' (main)'}
                      </span>
                      <span className="author__row">
                        {i > 0 && (
                          <button type="button" onClick={() => makeMain(san)}>
                            Make main
                          </button>
                        )}
                        <button
                          type="button"
                          aria-label={`Remove ${san}`}
                          onClick={() => toggleAccepted(san)}
                        >
                          ×
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="author__row">
                <input
                  aria-label="Add move"
                  placeholder="SAN, e.g. Nf3"
                  value={extraMove}
                  onChange={(e) => setExtraMove(e.target.value)}
                />
                <button type="button" onClick={addExtraMove}>
                  Add
                </button>
              </div>
            </div>
            <label>
              Prompt
              <input value={form.prompt} onChange={(e) => update({ prompt: e.target.value })} />
            </label>
            <label>
              Hints (one per line)
              <textarea
                rows={3}
                value={form.hints}
                onChange={(e) => update({ hints: e.target.value })}
              />
            </label>
            <label>
              Explanation
              <textarea
                rows={3}
                value={form.explanation}
                onChange={(e) => update({ explanation: e.target.value })}
              />
            </label>
            <div className="author__row">
              <button type="button" onClick={saveLesson}>
                Save to pack
              </button>
              <button type="button" onClick={newLesson}>
                New lesson
              </button>
            </div>
            {errors.length > 0 && (
              <ul className="author__error" role="alert">
                {errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}
            {notice && errors.length === 0 && (
              <p className="lessons__muted" role="status">
                {notice}
              </p>
            )}
          </section>
        </aside>
      </TrainerLayout>

      <div className="lessons">
        <section className="lessons__panel" aria-label="Pack">
          <h2>Pack ({pack.lessons.length} lessons)</h2>
          <div className="author__row">
            <label>
              Pack name
              <input
                value={pack.name}
                onChange={(e) => setPack((p) => ({ ...p, name: e.target.value }))}
              />
            </label>
            <label>
              Pack id
              <input
                value={pack.id}
                placeholder={slugify(pack.name) || 'from the name'}
                onChange={(e) => setPack((p) => ({ ...p, id: e.target.value }))}
              />
            </label>
            <label>
              Description
              <input
                value={pack.description ?? ''}
                onChange={(e) => setPack((p) => ({ ...p, description: e.target.value }))}
              />
            </label>
          </div>
          {pack.lessons.length > 0 && (
            <ol className="author__pack-lessons">
              {pack.lessons.map((l, i) => (
                <li key={l.id}>
                  <span>
                    <strong>{l.id}</strong> · {conceptLabel(l.concept)} · {l.accepted.join(', ')}
                    {l.prompt && <span className="lessons__muted"> — {l.prompt}</span>}
                  </span>
                  <span className="author__row">
                    <button type="button" onClick={() => editLesson(l.id)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${l.id} up`}
                      disabled={i === 0}
                      onClick={() => setPack((p) => moveLesson(p, l.id, -1))}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${l.id} down`}
                      disabled={i === pack.lessons.length - 1}
                      onClick={() => setPack((p) => moveLesson(p, l.id, 1))}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove ${l.id}`}
                      onClick={() => setPack((p) => removeLesson(p, l.id))}
                    >
                      Remove
                    </button>
                  </span>
                </li>
              ))}
            </ol>
          )}
          <div className="author__row">
            <button type="button" onClick={exportPack} disabled={pack.lessons.length === 0}>
              Export JSON
            </button>
            <label>
              Open pack file
              <input
                type="file"
                accept="application/json,.json"
                onChange={(e) => void onFile(e.target.files?.[0])}
              />
            </label>
            {packs.length > 0 && (
              <label>
                Edit a bundled pack
                <select
                  value=""
                  onChange={(e) => {
                    const p = packs.find((x) => x.id === e.target.value)
                    if (p) openPack(p, p.id)
                  }}
                >
                  <option value="">Choose…</option>
                  {packs.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          {json && (
            <textarea
              className="author__json"
              aria-label="Pack JSON"
              readOnly
              rows={10}
              value={json}
            />
          )}
        </section>
      </div>
    </>
  )
}
