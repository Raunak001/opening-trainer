// Full-game review of imported games: Stockfish evals, move marks, accuracy. Pure (no React);
// the review page is imported from './GameReview' directly.

export {
  bookPlies,
  gameAccuracy,
  KEY_MARKS,
  MARKS,
  moveAccuracy,
  reviewGame,
  sacrificeValue,
  whiteWinPercent,
  type GameReview,
  type MarkThresholds,
  type MoveMark,
  type MoveReview,
  type ReviewOptions,
  type Side,
} from './classify'
export { analysisRow, analyzeGame, gameFens, saveAnalysis, type AnalyzeOptions } from './analyze'
export {
  describeMove,
  MARK_STYLES,
  markIconSvg,
  squareMarkSvg,
  type MarkStyle,
  type MoveComment,
} from './describe'
