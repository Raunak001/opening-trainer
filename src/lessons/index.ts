// Lesson JSON packs, lesson player, authoring tool.

export {
  CONCEPTS,
  conceptLabel,
  duplicateLessonIds,
  isKnownConcept,
  lessonSide,
  validateLesson,
  validatePack,
  type ConceptInfo,
  type KnownConcept,
  type Lesson,
  type LessonPack,
  type PackResult,
} from './lesson'
export {
  createAttempt,
  hintsExhausted,
  hintUsed,
  mainAnswer,
  requestLessonHint,
  submitLessonMove,
  type LessonAttempt,
  type LessonMoveResult,
  type LessonStatus,
} from './attempt'
export { bundledPacks, loadPacks, type LoadedPacks } from './packs'
export { useLesson, type LessonOptions } from './useLesson'
export { LessonPlayer, type LessonPlayerProps } from './LessonPlayer'
export { LessonsPage, type LessonsPageProps } from './LessonsPage'
export {
  candidateLines,
  draftExplanation,
  formFromLesson,
  idPrefix,
  isWithin,
  lessonFromForm,
  moveLesson,
  nextLessonId,
  packToJson,
  putLesson,
  removeLesson,
  scoreValue,
  slugify,
  type CandidateLine,
  type LessonForm,
} from './authoring'
export { AuthorPage, type AuthorPageProps } from './AuthorPage'
export {
  DEFAULT_DETECT_OPTIONS,
  detectConcepts,
  developingMoves,
  occupiesCenter,
  prematureAttack,
  type ConceptHit,
  type DetectOptions,
} from './concepts'
export {
  DEFAULT_MINE_EXPLORER,
  mineExplorer,
  mineGames,
  type MinedCandidate,
  type MineExplorerOptions,
  type MineGamesOptions,
  type MineSource,
} from './mining'
export { MAX_CHECKS_PER_CONCEPT, MinePage, SHOWN_PER_CONCEPT, type MinePageProps } from './MinePage'
export {
  verifyCandidate,
  verifyCandidates,
  type MoveCheck,
  type Verdict,
  type VerifiedCandidate,
  type VerifyManyOptions,
  type VerifyOptions,
} from './verify'
