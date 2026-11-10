import type { Api } from 'chessground/api'
import type { Key, PieceNode, Pieces } from 'chessground/types'
import { animPlan, squarePos, type Slide } from './animPlan'

/**
 * Piece animation on the compositor.
 *
 * chessground's own animation moves pieces from JavaScript, one `requestAnimationFrame` at a
 * time, so any busy moment on the main thread shows up as dropped frames. Here chessground
 * is told not to animate: it puts pieces straight on their squares, and each moved piece
 * gets a Web Animations `transform` animation from its old square. The browser runs those
 * off the main thread at the display's full refresh rate (the pieces already have
 * `will-change: transform`). Only transform and opacity are animated, so they stay
 * compositor-only.
 */

/** Slide length. Matches the trainer's input lock (`ANIMATION_MS`). */
export const MOVE_ANIMATION_MS = 200
const EASING = 'cubic-bezier(0.25, 0.1, 0.25, 1)'
/** Above other pieces while sliding, like chessground's `piece.anim`. */
const SLIDING_Z = '8'

function pieceAt(board: HTMLElement, key: Key): PieceNode | undefined {
  for (let el = board.firstElementChild; el; el = el.nextElementSibling) {
    const node = el as PieceNode
    if (node.tagName === 'PIECE' && node.cgKey === key && !node.classList.contains('ghost'))
      return node
  }
  return undefined
}

export interface Animator {
  /**
   * Animates from `prev` to the position chessground holds now. Call right after changing
   * chessground's pieces. `dragged` is a move the user already showed by dragging: that
   * piece and anything it captured stay as they are.
   */
  animate(api: Api, prev: Pieces, dragged?: Slide): void
  /** Jumps every running animation to its end. */
  cancel(): void
}

export function createAnimator(): Animator {
  const running = new Set<Animation>()
  const cleanups = new Set<() => void>()

  function cancel() {
    for (const a of running) a.cancel()
    running.clear()
    for (const done of cleanups) done()
    cleanups.clear()
  }

  function track(a: Animation, done: () => void) {
    running.add(a)
    cleanups.add(done)
    a.onfinish = () => {
      running.delete(a)
      cleanups.delete(done)
      done()
    }
  }

  function animate(api: Api, prev: Pieces, dragged?: Slide) {
    const plan = animPlan(prev, api.state.pieces)
    const slides = plan.slides.filter(
      (s) => !(dragged && s.from === dragged.from && s.to === dragged.to),
    )
    const fades = dragged ? [] : plan.fades
    if (slides.length === 0 && fades.length === 0) return
    const board = api.state.dom.elements.board
    // No Web Animations (tests): the pieces are already in place.
    if (typeof board.animate !== 'function') return
    cancel()
    // Put the DOM in the final position now, instead of on chessground's next frame.
    api.state.dom.redrawNow()

    const size = api.state.dom.bounds().width / 8
    const asWhite = api.state.orientation === 'white'
    const at = (key: Key) => {
      const [file, rank] = squarePos(key)
      const x = (asWhite ? file : 7 - file) * size
      const y = (asWhite ? 7 - rank : rank) * size
      return `translate(${x}px,${y}px)`
    }
    const timing: KeyframeAnimationOptions = { duration: MOVE_ANIMATION_MS, easing: EASING }

    for (const { from, to } of slides) {
      const el = pieceAt(board, to)
      if (!el) continue
      el.style.zIndex = SLIDING_Z
      const a = el.animate([{ transform: at(from) }, { transform: at(to) }], timing)
      track(a, () => {
        el.style.zIndex = ''
      })
    }

    // Captured pieces stay put and fade as the capturing piece arrives. They live outside
    // cg-board, whose children chessground owns and would remove on its next render.
    const container = board.parentElement
    if (!container) return
    for (const { key, piece } of fades) {
      const ghost = document.createElement('piece')
      ghost.className = `${piece.color} ${piece.role}`
      ghost.style.transform = at(key)
      container.appendChild(ghost)
      const a = ghost.animate([{ opacity: 1 }, { opacity: 1, offset: 0.6 }, { opacity: 0 }], timing)
      track(a, () => ghost.remove())
    }
  }

  return { animate, cancel }
}
