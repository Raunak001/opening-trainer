import 'fake-indexeddb/auto'
import { Chess } from 'chess.js'
import { createEmptyCard, Rating, State } from 'ts-fsrs'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, TrainerDB, type CardRow } from '../../db'
import type { CourseLine } from '../../repertoire/lines'
import { positionKey } from '../../repertoire/positionKey'
import {
  createLearn,
  isFast,
  knownPrefix,
  learnArrow,
  learnFen,
  learnHintSquare,
  learnReviews,
  learnTurn,
  newCardCount,
  nextLineToLearn,
  playLearnOpponent,
  requestLearnHint,
  saveLearnedLine,
  showBack,
  showDone,
  showNext,
  startPlay,
  submitLearnMove,
  type LearnState,
} from '../learn'

const keyAfter = (sans: string) => {
  const chess = new Chess()
  for (const san of sans.split(' ').filter(Boolean)) chess.move(san)
  return positionKey(chess.fen())
}

// Caro-Kann for Black. Black's cards sit after 1.e4, 2.d4 and 3.e5 / 3.Nc3.
const ADVANCE = { side: 'black' as const, moves: 'e4 c6 d4 d5 e5 Bf5'.split(' ') }
const MAIN = { side: 'black' as const, moves: 'e4 c6 d4 d5 Nc3 dxe4'.split(' ') }
const ALL_NEW = new Set(['e4', 'e4 c6 d4', 'e4 c6 d4 d5 e5', 'e4 c6 d4 d5 Nc3'].map(keyAfter))
// After learning the Advance, only 3…dxe4 is new in the main line.
const AFTER_ADVANCE = new Set([keyAfter('e4 c6 d4 d5 Nc3')])

const GRADING = DEFAULT_SETTINGS.grading

function play(state: LearnState, from: string, to: string, ms?: number) {
  return submitLearnMove(state, { from, to }, ms)
}

/** Opponent moves are played; returns the state at your next move (or the end). */
function toUser(state: LearnState): LearnState {
  let s = state
  while (learnTurn(s) === 'opponent') s = playLearnOpponent(s)
  return s
}

describe('show phase', () => {
  it('plays both sides one move at a time, your moves as arrows first', () => {
    let s = createLearn(ADVANCE, ALL_NEW)
    expect(s.prefix).toBe(0)
    expect(s.phase).toBe('show')
    expect(learnFen(s)).toBe(new Chess().fen())

    s = showNext(s) // 1.e4
    expect(s.ply).toBe(1)
    expect(learnArrow(s)).toBeUndefined()

    s = showNext(s) // arrow for 1…c6
    expect(s.ply).toBe(1)
    expect(learnArrow(s)).toMatchObject({ san: 'c6', from: 'c7', to: 'c6' })

    s = showNext(s) // 1…c6 played
    expect(s.ply).toBe(2)
    expect(learnArrow(s)).toBeUndefined()

    // Stepping back undoes the move, then the arrow is not redrawn going back.
    s = showBack(s)
    expect(s.ply).toBe(1)
    expect(learnArrow(s)).toBeUndefined()
    s = showBack(showBack(s))
    expect(s.ply).toBe(0)

    while (!showDone(s)) s = showNext(s)
    expect(s.ply).toBe(6)
    expect(learnFen(s)).toBe(ADVANCE.moves.reduce((c, m) => (c.move(m), c), new Chess()).fen())
    expect(showNext(s)).toBe(s)
  })

  it('takes back a drawn arrow before a move', () => {
    const s = showNext(showNext(createLearn(ADVANCE, ALL_NEW)))
    expect(s.arrowShown).toBe(true)
    const back = showBack(s)
    expect(back.arrowShown).toBe(false)
    expect(back.ply).toBe(1)
  })

  it('fast-plays the prefix learned in an earlier line, without arrows', () => {
    let s = createLearn(MAIN, AFTER_ADVANCE)
    // 1.e4 c6 2.d4 d5 are known; 3.Nc3 leads into new ground and is shown.
    expect(s.prefix).toBe(4)
    expect(isFast(s)).toBe(true)
    s = showNext(s) // 1.e4
    s = showNext(s) // 1…c6, known: no arrow stop
    expect(s.ply).toBe(2)
    s = showNext(showNext(s))
    expect(s.ply).toBe(4)
    expect(isFast(s)).toBe(false)
    s = showNext(s) // 3.Nc3
    s = showNext(s) // arrow for 3…dxe4
    expect(learnArrow(s)?.san).toBe('dxe4')
  })
})

describe('knownPrefix', () => {
  const step = (byUser: boolean, isNew = false) => ({ byUser, isNew })
  it('stops after your last known move before the first new one', () => {
    expect(knownPrefix([step(false), step(true), step(false), step(true, true)])).toBe(2)
    expect(knownPrefix([step(true, true), step(false)])).toBe(0)
    // Nothing new: the whole line is shown again.
    expect(knownPrefix([step(false), step(true)])).toBe(0)
  })
})

describe('play phase', () => {
  it('new moves get the arrow from the first try; wrong snaps back', () => {
    let s = startPlay(createLearn(ADVANCE, ALL_NEW))
    expect(s.phase).toBe('play')
    expect(s.ply).toBe(0)
    expect(learnTurn(s)).toBe('opponent')
    s = toUser(s)
    expect(learnArrow(s)?.san).toBe('c6')

    const wrong = play(s, 'e7', 'e5')
    expect(wrong.result).toBe('wrong')
    expect(wrong.state.ply).toBe(1)
    expect(wrong.state.misses).toBe(1)
    expect(learnArrow(wrong.state)?.san).toBe('c6')

    expect(play(s, 'e7', 'e4').result).toBe('illegal')

    const right = play(wrong.state, 'c7', 'c6', 900)
    expect(right.result).toBe('correct')
    expect(right.state.records).toEqual([
      { ply: 1, misses: 1, hintRequested: false, guided: true, durationMs: 900 },
    ])
  })

  it('known moves have no arrow until a hint or two misses', () => {
    let s = toUser(startPlay(createLearn(MAIN, AFTER_ADVANCE)))
    expect(s.ply).toBe(1)
    expect(learnArrow(s)).toBeUndefined()
    expect(learnHintSquare(s)).toBeUndefined()

    const hinted = requestLearnHint(s)
    expect(learnHintSquare(hinted)).toBe('c7')
    expect(hinted.hintRequested).toBe(true)
    expect(learnArrow(requestLearnHint(hinted))?.san).toBe('c6')

    s = play(s, 'e7', 'e5').state
    expect(learnArrow(s)).toBeUndefined()
    s = play(s, 'e7', 'e6').state
    expect(learnArrow(s)?.san).toBe('c6')
  })

  it('ignores moves when it is not your turn', () => {
    const s = startPlay(createLearn(ADVANCE, ALL_NEW))
    expect(play(s, 'c7', 'c6').result).toBe('ignored')
    expect(playLearnOpponent(toUser(s))).toEqual(toUser(s))
  })

  it('completes after the last move', () => {
    let s = startPlay(createLearn(ADVANCE, ALL_NEW))
    for (const [from, to] of [
      ['c7', 'c6'],
      ['d7', 'd5'],
      ['c8', 'f5'],
    ]) {
      s = toUser(s)
      s = play(s, from, to).state
    }
    expect(s.phase).toBe('complete')
    expect(learnTurn(s)).toBeUndefined()
  })
})

describe('completion', () => {
  function playLine(newCards: Set<string>, line = ADVANCE): LearnState {
    let s = toUser(startPlay(createLearn(line, newCards)))
    // 1…c6: wrong first. 2…d5: hint asked (no-op: the arrow is up). Last: instant.
    s = play(s, 'e7', 'e5').state
    s = toUser(play(s, 'c7', 'c6', 3000).state)
    s = requestLearnHint(s)
    s = toUser(play(s, 'd7', 'd5', 3000).state)
    const last = line === ADVANCE ? (['c8', 'f5'] as const) : (['d5', 'e4'] as const)
    return play(s, last[0], last[1], 500).state
  }

  it('reviews only the new cards, graded as in Review', () => {
    const s = playLine(ALL_NEW)
    // The arrow is already up on new moves, so asking for a hint changes nothing.
    expect(s.records[1]).toMatchObject({ guided: true, hintRequested: false })
    expect(newCardCount(s)).toBe(3)
    expect(learnReviews(s, GRADING)).toEqual([
      {
        positionKey: keyAfter('e4'),
        rating: Rating.Again,
        details: { mistakes: 1, hintUsed: false, durationMs: 3000 },
      },
      {
        positionKey: keyAfter('e4 c6 d4'),
        rating: Rating.Good,
        details: { mistakes: 0, hintUsed: false, durationMs: 3000 },
      },
      // Following the arrow in 0.5s is not recall: Good, not Easy.
      {
        positionKey: keyAfter('e4 c6 d4 d5 e5'),
        rating: Rating.Good,
        details: { mistakes: 0, hintUsed: false, durationMs: 500 },
      },
    ])
  })

  it('leaves known cards of the shared prefix alone', () => {
    const s = playLine(AFTER_ADVANCE, MAIN)
    expect(learnReviews(s, GRADING).map((r) => r.positionKey)).toEqual([
      keyAfter('e4 c6 d4 d5 Nc3'),
    ])
  })

  it('has nothing to review before completion', () => {
    expect(learnReviews(createLearn(ADVANCE, ALL_NEW), GRADING)).toEqual([])
  })

  const dbs: TrainerDB[] = []
  afterEach(async () => {
    for (const db of dbs.splice(0)) await db.delete()
  })

  it('saves the first review of each new card', async () => {
    const db = new TrainerDB(`learn-${crypto.randomUUID()}`)
    dbs.push(db)
    const now = new Date(2026, 10, 9, 12)
    for (const key of ALL_NEW)
      await db.cards.put({
        ...createEmptyCard(now),
        id: `rep:${key}`,
        repertoireId: 'rep',
        positionKey: key,
        answer: 'x',
      })
    const s = playLine(ALL_NEW)
    await saveLearnedLine(db, 'rep', learnReviews(s, GRADING), now)
    const after = await db.cards.get(`rep:${keyAfter('e4 c6 d4 d5 e5')}`)
    expect(after?.reps).toBe(1)
    expect(after?.state).not.toBe(State.New)
    expect(await db.reviewLogs.count()).toBe(3)
    // The 3.Nc3 card is not on this line.
    expect((await db.cards.get(`rep:${keyAfter('e4 c6 d4 d5 Nc3')}`))?.reps).toBe(0)
  })
})

describe('nextLineToLearn', () => {
  const lineOf = (moves: string, frequency: number): CourseLine => {
    const sans = moves.split(' ')
    const positions = [keyAfter('')]
    sans.forEach((_, i) => positions.push(keyAfter(sans.slice(0, i + 1).join(' '))))
    return { id: positions.at(-1) as string, moves: sans, positions, frequency }
  }
  const advance = lineOf('e4 c6 d4 d5 e5 Bf5', 0.42)
  const main = lineOf('e4 c6 d4 d5 Nc3 dxe4', 0.18)
  const card = (moves: string, state: State): [string, CardRow] => {
    const key = keyAfter(moves)
    return [
      key,
      {
        ...createEmptyCard(),
        state,
        id: `r:${key}`,
        repertoireId: 'r',
        positionKey: key,
        answer: 'x',
      },
    ]
  }
  const fresh = new Map([
    card('e4', State.New),
    card('e4 c6 d4', State.New),
    card('e4 c6 d4 d5 e5', State.New),
    card('e4 c6 d4 d5 Nc3', State.New),
  ])
  const lines = [advance, main]

  it('picks the most frequent line with new cards', () => {
    expect(nextLineToLearn(lines, fresh, { left: 20, total: 20 })).toEqual({
      line: advance,
      newCards: 3,
    })
    const learned = new Map([
      ...fresh,
      card('e4', State.Learning),
      card('e4 c6 d4', State.Review),
      card('e4 c6 d4 d5 e5', State.Learning),
    ])
    expect(nextLineToLearn(lines, learned, { left: 20, total: 20 })).toEqual({
      line: main,
      newCards: 1,
    })
    const all = new Map([...learned, card('e4 c6 d4 d5 Nc3', State.Review)])
    expect(nextLineToLearn(lines, all, { left: 20, total: 20 })).toEqual({
      line: undefined,
      reason: 'done',
    })
  })

  it('respects the daily new-card cap', () => {
    expect(nextLineToLearn(lines, fresh, { left: 2, total: 20 })).toEqual({
      line: undefined,
      reason: 'cap',
    })
    expect(nextLineToLearn(lines, fresh, { left: 0, total: 20 })).toMatchObject({ reason: 'cap' })
    // A line bigger than the whole cap is still offered first thing in the day.
    expect(nextLineToLearn(lines, fresh, { left: 2, total: 2 })).toMatchObject({ line: advance })
  })
})
