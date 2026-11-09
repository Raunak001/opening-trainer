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
export {
  hangingPieces,
  lineMaterial,
  materialBalance,
  materialFindings,
  materialFindingsForGrading,
  MIN_MATERIAL_SWING,
  PIECE_VALUES,
  staticExchange,
} from './material'
export type {
  HangingPiece,
  LineCapture,
  LineMaterial,
  MaterialCheckInput,
  MaterialFinding,
} from './material'
export { findForks, forkAt, tacticFindings, tacticFindingsForGrading } from './tactics'
export type { Fork, ForkTarget, TacticCheckInput, TacticFinding } from './tactics'
export { DEFAULT_PRINCIPLE_OPTIONS, principleFindings } from './principles'
export type { PrincipleFinding, PrincipleOptions } from './principles'
export { amountWords, explainMove, fill, formatScore, GRADE_LABELS, PHRASES } from './explain'
export type { ExplainInput, Explanation, Finding } from './explain'
export { createOpponentEngine, getSharedEngine } from './shared'
export { checkRepertoireMoves, clampedCp } from './sanity'
export type { RepertoireMove, SanityFlag, SanityOptions } from './sanity'
