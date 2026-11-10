import type { RatingBucket, Speed } from '../repertoire/explorer'
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
    /** Review cards per day. New cards are not capped. */
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
  /** Concept lessons (Phase 6). */
  lessons: {
    /** Stockfish depth for the authoring tool's analysis. */
    depth: number
    /** Lines shown by the authoring tool (UCI MultiPV). */
    multiPv: number
    /** Moves within this many centipawns of the best are accepted automatically. */
    acceptWithinCp: number
    /** Stockfish depth for checking mined positions (many evals: keep it shallow). */
    mineDepth: number
  }
  /** Library courses (Phase 7): which explorer games courses are built from. */
  courses: {
    /** Explorer rating buckets (lower bounds) of the opponents to prepare for. */
    ratings: RatingBucket[]
    speeds: Speed[]
  }
  /** Board sounds. */
  /** Full-game review of imported games (src/analysis). Losses are win% points (0–100). */
  analysis: {
    /** Stockfish depth per position (two lines per position). */
    depth: number
    /** A non-best move losing less than this is Excellent… */
    excellent: number
    /** …less than this Good… */
    good: number
    /** …less than this an Inaccuracy… */
    inaccuracy: number
    /** …less than this a Mistake; anything more is a Blunder. */
    mistake: number
    /** Great move: the best move, with the second-best losing at least this much. */
    greatGap: number
    /** Brilliant move: gives up at least this much material (pawns) and stays sound. */
    minSacrifice: number
  }
  /** Coordinate drills (Phase 10). */
  coordinates: {
    /** Length of a Find / Name round. */
    roundSeconds: number
    /** Questions in a Play the move / Visualize round. */
    questions: number
  }
  sound: {
    enabled: boolean
    /** 0 (silent) to 1. */
    volume: number
  }
}

export const DEFAULT_SETTINGS: AppSettings = {
  grading: { hardAfterMs: 15_000, easyUnderMs: 2_000 },
  fsrs: { requestRetention: 0.9 },
  daily: { reviews: 200 },
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
  lessons: { depth: 18, multiPv: 5, acceptWithinCp: 30, mineDepth: 12 },
  // Same band as the builder's defaults.
  courses: { ratings: [1600, 1800], speeds: ['blitz', 'rapid'] },
  // chess.com's published expected-points bands (0.02 / 0.05 / 0.10 / 0.20) on the win% scale.
  analysis: {
    depth: 14,
    excellent: 2,
    good: 5,
    inaccuracy: 10,
    mistake: 20,
    greatGap: 20,
    minSacrifice: 2,
  },
  coordinates: { roundSeconds: 30, questions: 10 },
  sound: { enabled: true, volume: 0.7 },
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
    lessons: { ...base.lessons, ...patch?.lessons },
    courses: { ...base.courses, ...patch?.courses },
    analysis: { ...base.analysis, ...patch?.analysis },
    coordinates: { ...base.coordinates, ...patch?.coordinates },
    sound: { ...base.sound, ...patch?.sound },
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
