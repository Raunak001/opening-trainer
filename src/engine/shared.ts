// One Stockfish worker for the whole app, created on first use.

import { createEngine, createWorkerTransport, EngineError, type Engine } from './engine'

let shared: Engine | undefined

/** The app's engine. Throws EngineError where Web Workers are unavailable (e.g. tests). */
export function getSharedEngine(): Engine {
  if (shared) return shared
  if (typeof Worker === 'undefined') throw new EngineError('Web Workers are not available')
  shared = createEngine(createWorkerTransport())
  return shared
}
