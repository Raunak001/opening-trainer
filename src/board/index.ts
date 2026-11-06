// chessground React wrapper, theme CSS, promotion picker.

export { ARROW_BRUSH, Board, type BoardProps } from './Board'
export {
  inCheck,
  isPromotion,
  legalDests,
  normalizeCastle,
  turnColor,
  type PromotionPiece,
} from './dests'
export { PromotionPicker } from './PromotionPicker'
