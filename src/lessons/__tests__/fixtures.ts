import { Chess } from 'chess.js'
import type { Lesson, LessonPack } from '../lesson'

/** FEN after SAN moves from the start position. */
export function fenAfter(moves: string): string {
  const chess = new Chess()
  for (const san of moves.split(' ').filter(Boolean)) chess.move(san)
  return chess.fen()
}

/** Italian, 4...Nf6: White strikes with d4 (d3 is the quiet alternative). */
export const CENTER: Lesson = {
  id: 'center-01',
  concept: 'strike-center',
  fen: fenAfter('e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6'),
  prompt: 'c3 prepared it. Strike the center.',
  accepted: ['d4', 'd3'],
  hints: ['Which pawn can challenge e5?', 'c3 supports d4.'],
  explanation: 'd4 hits e5 and builds a big center.',
}

/** 1.e4 e5 2.Qh5: Black defends e5 with a developing move. */
export const QUEEN: Lesson = {
  id: 'queen-01',
  concept: 'punish-early-queen',
  fen: fenAfter('e4 e5 Qh5'),
  prompt: 'The queen attacks e5. Defend with development.',
  accepted: ['Nc6'],
  hints: [],
  explanation: 'Nc6 defends e5 and develops a piece.',
}

export const PACK: LessonPack = {
  id: 'test-pack',
  name: 'Test pack',
  description: 'Two lessons',
  lessons: [CENTER, QUEEN],
}
