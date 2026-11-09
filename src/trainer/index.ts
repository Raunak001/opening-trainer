// Drill loop, line-context playback, side panel UI.

export { SidePanel, type SidePanelProps } from './SidePanel'
export { TrainerLayout } from './TrainerLayout'
export {
  createDrill,
  expectedMove,
  MISSES_FOR_ARROW,
  playOpponentMove,
  promptedMoveCount,
  requestHint,
  resolveLine,
  submitMove,
  type DrillState,
  type DrillStatus,
  type HintLevel,
  type Line,
  type MoveInput,
  type MoveRecord,
  type MoveResult,
  type Side,
  type Step,
} from './drill'
export {
  ANIMATION_MS,
  OPPONENT_DELAY_MS,
  REPLAY_DELAY_MS,
  useDrill,
  WRONG_FLASH_MS,
  type DrillOptions,
  type DrillOutcome,
} from './useDrill'
export { cardLine, formatInterval, gradeFeedback, isPlayable, ratingName } from './review'
export { NEXT_CARD_DELAY_MS, ReviewPage, type ReviewPageProps } from './ReviewPage'
export { LINES_SHOWN, ProgressPage, type ProgressPageProps } from './ProgressPage'
export {
  createMoveExplainer,
  drillFeedback,
  type ExplainRequest,
  type MoveExplainer,
} from './explainer'
export {
  createPlayout,
  gradeCounts,
  playEngineMove,
  playoutSummary,
  playUserMove,
  setGrade,
  userMovesPlayed,
  type PlayoutEnd,
  type PlayoutMove,
  type PlayoutState,
  type PlayoutStatus,
} from './playout'
export { usePlayout, playoutFeedback, type PlayoutOptions } from './usePlayout'
export { PlayoutView, type PlayoutViewProps } from './PlayoutView'
export { MoveList, type MoveListProps } from './MoveList'
export { fensAlong, moveRows, type MoveRow } from './moveRows'
export { LinePreview, type LinePreviewProps } from './LinePreview'
export {
  createLearn,
  isFast,
  knownPrefix,
  lastLearnMove,
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
  type LearnLine,
  type LearnPhase,
  type LearnRecord,
  type LearnReview,
  type LearnState,
  type LearnStep,
  type LearnTurn,
  type NextLine,
} from './learn'
export {
  conceptTags,
  lineNarration,
  narrateMove,
  numberedSan,
  type NarrationInput,
} from './narration'
export { SHOW_ARROW_MS, SHOW_MOVE_MS, useLearn, type LearnOptions } from './useLearn'
export { LearnView, type LearnViewProps } from './LearnView'
export {
  courseCounts,
  dueCount,
  linesWithStatus,
  loadCourse,
  loadLibrary,
  type CourseCounts,
  type CourseDetail,
  type LibraryItem,
  type LineWithStatus,
} from './courseData'
export { LibraryPage, type LibraryPageProps } from './LibraryPage'
export { CoursePage, type CoursePageProps } from './CoursePage'
