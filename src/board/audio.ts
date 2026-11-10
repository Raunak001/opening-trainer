import type { BoardSound } from './sound'

/*
 * Board sounds, synthesised with Web Audio: a short band-passed noise burst (the "tock" of
 * a wooden piece) over a low sine thump, plus a small tone for check and promotion. No audio
 * files, nothing copied from any chess site: only the general feel is mimicked.
 */

let enabled = true
let volume = 0.7
let ctx: AudioContext | null = null
let noise: AudioBuffer | null = null

/** Applies the sound settings. Takes effect from the next sound. */
export function configureSound(options: { enabled?: boolean; volume?: number }) {
  if (options.enabled !== undefined) enabled = options.enabled
  if (options.volume !== undefined) volume = Math.min(1, Math.max(0, options.volume))
}

function audio(): AudioContext | null {
  if (typeof window === 'undefined' || typeof window.AudioContext !== 'function') return null
  // Created on first use, which follows a click, so the autoplay policy lets it start.
  ctx ??= new window.AudioContext({ latencyHint: 'interactive' })
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  return ctx
}

function noiseBuffer(ac: AudioContext): AudioBuffer {
  if (noise) return noise
  const buffer = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.25), ac.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  noise = buffer
  return buffer
}

/** A gain node that spikes to `peak` and decays exponentially over `decay` seconds. */
function envelope(ac: AudioContext, out: AudioNode, at: number, peak: number, decay: number) {
  const gain = ac.createGain()
  gain.gain.setValueAtTime(0.0001, at)
  gain.gain.exponentialRampToValueAtTime(peak, at + 0.002)
  gain.gain.exponentialRampToValueAtTime(0.0001, at + decay)
  gain.connect(out)
  return gain
}

interface Knock {
  /** Centre of the noise band: higher is a sharper click. */
  tone: number
  /** Pitch of the low thump. */
  body: number
  decay: number
  gain: number
}

/** One piece landing on the board. */
function knock(ac: AudioContext, out: AudioNode, at: number, k: Knock) {
  const src = ac.createBufferSource()
  src.buffer = noiseBuffer(ac)
  const band = ac.createBiquadFilter()
  band.type = 'bandpass'
  band.frequency.value = k.tone
  band.Q.value = 1.4
  src.connect(band).connect(envelope(ac, out, at, k.gain, k.decay))
  src.start(at)
  src.stop(at + k.decay + 0.02)

  const thump = ac.createOscillator()
  thump.type = 'sine'
  thump.frequency.setValueAtTime(k.body, at)
  thump.frequency.exponentialRampToValueAtTime(k.body * 0.6, at + k.decay * 1.5)
  thump.connect(envelope(ac, out, at, k.gain * 0.8, k.decay * 1.5))
  thump.start(at)
  thump.stop(at + k.decay * 1.5 + 0.02)
}

/** A short pitched note, for check and promotion. */
function note(
  ac: AudioContext,
  out: AudioNode,
  at: number,
  freq: number,
  gain: number,
  decay = 0.2,
) {
  const osc = ac.createOscillator()
  osc.type = 'triangle'
  osc.frequency.value = freq
  osc.connect(envelope(ac, out, at, gain, decay))
  osc.start(at)
  osc.stop(at + decay + 0.02)
}

const MOVE: Knock = { tone: 1100, body: 190, decay: 0.07, gain: 0.9 }
// The opponent's moves sit a little lower, so you can tell them apart by ear.
const MOVE_OPPONENT: Knock = { tone: 850, body: 165, decay: 0.07, gain: 0.85 }
const CAPTURE: Knock = { tone: 2300, body: 150, decay: 0.05, gain: 1 }
const CAPTURE_TAIL: Knock = { tone: 900, body: 120, decay: 0.09, gain: 0.7 }

/**
 * Plays a board sound. `mine` is true for the user's own moves. Does nothing when sound is
 * off or the browser has no Web Audio (tests).
 */
export function playSound(sound: BoardSound, mine = true) {
  if (!enabled || volume === 0) return
  const ac = audio()
  if (!ac) return
  const out = ac.createGain()
  out.gain.value = volume
  out.connect(ac.destination)
  const t = ac.currentTime + 0.005
  const move = mine ? MOVE : MOVE_OPPONENT
  switch (sound) {
    case 'move':
      knock(ac, out, t, move)
      break
    case 'capture':
      knock(ac, out, t, CAPTURE)
      knock(ac, out, t + 0.012, CAPTURE_TAIL)
      break
    case 'castle':
      // King, then rook.
      knock(ac, out, t, move)
      knock(ac, out, t + 0.09, { ...move, tone: move.tone * 0.85 })
      break
    case 'check':
      knock(ac, out, t, move)
      note(ac, out, t + 0.02, 1047, 0.22, 0.18)
      break
    case 'promote':
      knock(ac, out, t, move)
      note(ac, out, t + 0.03, 784, 0.2, 0.12)
      note(ac, out, t + 0.11, 1175, 0.2, 0.22)
      break
    case 'wrong': {
      // Just after the wrong move's own sound, which plays in the same frame.
      const w = t + 0.07
      const osc = ac.createOscillator()
      osc.type = 'square'
      osc.frequency.setValueAtTime(220, w)
      osc.frequency.exponentialRampToValueAtTime(130, w + 0.2)
      const low = ac.createBiquadFilter()
      low.type = 'lowpass'
      low.frequency.value = 900
      osc.connect(low).connect(envelope(ac, out, w, 0.25, 0.25))
      osc.start(w)
      osc.stop(w + 0.27)
      break
    }
  }
}
