// Drill loop, line-context playback, side panel UI.

export { SidePanel, type SidePanelProps } from './SidePanel'
export { TrainerLayout } from './TrainerLayout'
export {
  createDrill,
  expectedMove,
  MISSES_FOR_ARROW,
  playOpponentMove,
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
export { italianLine } from './sampleLines'
export { ANIMATION_MS, OPPONENT_DELAY_MS, useDrill, WRONG_FLASH_MS } from './useDrill'
