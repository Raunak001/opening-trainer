/**
 * Glicko-2 (Glickman, "Example of the Glicko-2 system"), one puzzle per rating period.
 * The puzzle is the opponent: its rating is the bundled Lichess rating and its RD a fixed,
 * well-settled value.
 */

export interface GlickoRating {
  rating: number
  rd: number
  vol: number
}

export interface GlickoOptions {
  /** System constant: how fast volatility can change. */
  tau: number
  /** RD never falls below this, so the rating keeps moving as the user improves. */
  minRd: number
  maxRd: number
  /** RD assumed for every puzzle. */
  puzzleRd: number
  /** Ratings never go below this. */
  floor: number
}

export const DEFAULT_GLICKO: GlickoOptions = {
  tau: 0.5,
  minRd: 60,
  maxRd: 350,
  puzzleRd: 75,
  floor: 100,
}

/** A new player: 1000 with the widest RD, so the first puzzles move the rating fast. */
export const INITIAL_RATING: GlickoRating = { rating: 1000, rd: 350, vol: 0.06 }

const SCALE = 173.7178
const EPSILON = 0.000001

const g = (phi: number) => 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI))

/** Chance the player solves a puzzle of `puzzleRating`, per the Glicko-2 model. */
export function expectedScore(
  player: GlickoRating,
  puzzleRating: number,
  options: GlickoOptions = DEFAULT_GLICKO,
): number {
  const mu = (player.rating - 1500) / SCALE
  const muJ = (puzzleRating - 1500) / SCALE
  return 1 / (1 + Math.exp(-g(options.puzzleRd / SCALE) * (mu - muJ)))
}

/** The player's rating after one puzzle: `solved` is a win, anything else a loss. */
export function updateRating(
  player: GlickoRating,
  puzzleRating: number,
  solved: boolean,
  options: GlickoOptions = DEFAULT_GLICKO,
): GlickoRating {
  const mu = (player.rating - 1500) / SCALE
  const phi = player.rd / SCALE
  const sigma = player.vol
  const muJ = (puzzleRating - 1500) / SCALE
  const gJ = g(options.puzzleRd / SCALE)
  const e = 1 / (1 + Math.exp(-gJ * (mu - muJ)))
  const score = solved ? 1 : 0

  const v = 1 / (gJ * gJ * e * (1 - e))
  const delta = v * gJ * (score - e)

  // New volatility by the Illinois algorithm (step 5).
  const a = Math.log(sigma * sigma)
  const tau2 = options.tau * options.tau
  const f = (x: number) => {
    const ex = Math.exp(x)
    const d = phi * phi + v + ex
    return (ex * (delta * delta - phi * phi - v - ex)) / (2 * d * d) - (x - a) / tau2
  }
  let A = a
  let B: number
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v)
  } else {
    let k = 1
    while (f(a - k * options.tau) < 0) k++
    B = a - k * options.tau
  }
  let fA = f(A)
  let fB = f(B)
  for (let i = 0; Math.abs(B - A) > EPSILON && i < 100; i++) {
    const C = A + ((A - B) * fA) / (fB - fA)
    const fC = f(C)
    if (fC * fB <= 0) {
      A = B
      fA = fB
    } else {
      fA /= 2
    }
    B = C
    fB = fC
  }
  const newVol = Math.exp(A / 2)

  const phiStar = Math.sqrt(phi * phi + newVol * newVol)
  const newPhi = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v)
  const newMu = mu + newPhi * newPhi * gJ * (score - e)

  const rd = Math.min(options.maxRd, Math.max(options.minRd, newPhi * SCALE))
  const rating = Math.max(options.floor, newMu * SCALE + 1500)
  return { rating, rd, vol: newVol }
}
