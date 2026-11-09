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
export { DrillPage } from './DrillPage'
export { italianLine, SAMPLE_LINES, SPECIAL_MOVE_LINES } from './sampleLines'
export {
  ANIMATION_MS,
  OPPONENT_DELAY_MS,
  REPLAY_DELAY_MS,
  useDrill,
  WRONG_FLASH_MS,
  type DrillOptions,
  type DrillOutcome,
} from './useDrill'
export { cardLine, formatInterval, gradeFeedback, ratingName } from './review'
export { NEXT_CARD_DELAY_MS, ReviewPage, type ReviewPageProps } from './ReviewPage'
export { LINES_SHOWN, ProgressPage, type ProgressPageProps } from './ProgressPage'
