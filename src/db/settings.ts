import type { TimeClass, TrainerDB } from './db'

/**
 * App-wide tunables. CLAUDE.md: grading thresholds live here, not in constants.
 * Stored as one document; fields missing from storage use these defaults, so
 * later tickets can add settings without a schema change.
 */
export interface AppSettings {
  grading: {
    /** Slower than this (or a hint used) → Hard. */
    hardAfterMs: number
    /** Faster than this → Easy. */
    easyUnderMs: number
  }
  fsrs: {
    requestRetention: number
  }
  daily: {
    newCards: number
    reviews: number
  }
  progress: {
    /** A card counts as fully mastered once its FSRS stability reaches this many days. */
    masteredAfterDays: number
  }
  /** Engine move grading (engine/grading.ts). Losses are in win% points (0–100 scale). */
  moveGrading: {
    /** Stockfish search depth for grading. */
    depth: number
    /** Losing at least this much win% → inaccuracy. */
    inaccuracy: number
    /** Losing at least this much win% → mistake. */
    mistake: number
    /** Losing at least this much win% → blunder. */
    blunder: number
    /** Repertoire sanity check: flag chosen moves losing more than this many centipawns. */
    sanityCpLoss: number
  }
  /** Playing on against a weakened Stockfish after a drilled line ends. */
  playout: {
    /** Moves the user plays before the play-out ends. */
    userMoves: number
    /** Stockfish `Skill Level`, 0 (weakest) to 20 (full strength). */
    skillLevel: number
    /** Search depth for the opponent's moves. */
    depth: number
  }
  /** chess.com game import (Phase 5). */
  importer: {
    /** chess.com username; empty until the user enters one. */
    username: string
    /** Time classes whose games are analysed. All are stored. */
    timeClasses: TimeClass[]
    /** Only games that ended within this many days can fail or create cards. */
    autoCardDays: number
    /** After the opponent leaves book, the user's reply must be at least this bad to make a card. */
    cardMinGrade: 'inaccuracy' | 'mistake' | 'blunder'
    /** Coverage gaps report: a missing reply must appear in at least this many games. */
    minGapGames: number
  }
}

export const DEFAULT_SETTINGS: AppSettings = {
  grading: { hardAfterMs: 15_000, easyUnderMs: 2_000 },
  fsrs: { requestRetention: 0.9 },
  daily: { newCards: 20, reviews: 200 },
  progress: { masteredAfterDays: 21 },
  // Lichess's judgement thresholds (0.1 / 0.2 / 0.3 winning chances) on the win% scale.
  moveGrading: { depth: 16, inaccuracy: 5, mistake: 10, blunder: 15, sanityCpLoss: 50 },
  playout: { userMoves: 10, skillLevel: 3, depth: 8 },
  importer: {
    username: '',
    timeClasses: ['bullet', 'blitz', 'rapid', 'daily'],
    autoCardDays: 30,
    cardMinGrade: 'mistake',
    minGapGames: 2,
  },
}

export type SettingsPatch = { [K in keyof AppSettings]?: Partial<AppSettings[K]> }

const SETTINGS_ID = 'app'

/** Stored settings over defaults, one level deep. */
export function mergeSettings(base: AppSettings, patch: SettingsPatch | undefined): AppSettings {
  return {
    grading: { ...base.grading, ...patch?.grading },
    fsrs: { ...base.fsrs, ...patch?.fsrs },
    daily: { ...base.daily, ...patch?.daily },
    progress: { ...base.progress, ...patch?.progress },
    moveGrading: { ...base.moveGrading, ...patch?.moveGrading },
    playout: { ...base.playout, ...patch?.playout },
    importer: { ...base.importer, ...patch?.importer },
  }
}

export async function getSettings(db: TrainerDB): Promise<AppSettings> {
  const row = await db.settings.get(SETTINGS_ID)
  return mergeSettings(DEFAULT_SETTINGS, row)
}

/** Applies a partial change and returns the full settings after it. */
export async function updateSettings(db: TrainerDB, patch: SettingsPatch): Promise<AppSettings> {
  return db.transaction('rw', db.settings, async () => {
    const next = mergeSettings(await getSettings(db), patch)
    await db.settings.put({ id: SETTINGS_ID, ...next })
    return next
  })
}
