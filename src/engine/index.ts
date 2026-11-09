// Stockfish worker wrapper (UCI), eval cache, move grading, explainers.

export {
  createEngine,
  createWorkerTransport,
  EngineError,
  SearchCancelledError,
  STOCKFISH_URL,
} from './engine'
export type { Engine, SearchCallbacks, SearchOptions, SearchResult, UciTransport } from './engine'
export { parseBestMove, parseInfo, toWhitePov } from './uci'
export type { BestMove, InfoLine, Score, ScoreBound } from './uci'
export {
  dexieEvalCache,
  evalCacheKey,
  evalToRow,
  evaluatePosition,
  rowToEval,
  terminalEval,
} from './evalCache'
export type { EvalCache, EvaluateOptions, PositionEval } from './evalCache'
export { CP_CEILING, gradeForLoss, gradeMove, playMove, winPercent, WIN_PERCENT_K } from './grading'
export type { GradeMoveOptions, GradeThresholds, MoveGrade, MoveGrading } from './grading'
