import type { BoardSound } from './sound'

/*
 * Board sounds, synthesised with Web Audio. The "felt tap": a very short burst of noise,
 * band-passed low and then low-passed, like a felt-bottomed piece set down on a board.
 * Check and promotion add a soft sine chime. No audio files, nothing copied from any
 * chess site.
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
  ctx ??= new window.AudioContext({ latencyHint: 'interactive' })
  return ctx
}

/**
 * Starts the audio engine and wakes the output device with a silent sample. Call it from
 * the first click or key press: otherwise the first move pays the start-up cost, and some
 * outputs (Bluetooth especially) stutter or double that first sound.
 */
export function primeAudio() {
  const ac = audio()
  if (!ac) return
  const wake = () => {
    const src = ac.createBufferSource()
    src.buffer = ac.createBuffer(1, 1, ac.sampleRate)
    src.connect(ac.destination)
    src.start()
  }
  if (ac.state === 'running') wake()
  else ac.resume().then(wake, () => {})
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
  gain.gain.exponentialRampToValueAtTime(peak, at + 0.0015)
  gain.gain.exponentialRampToValueAtTime(0.0001, at + decay)
  gain.connect(out)
  return gain
}

/** The felt tap. */
const TAP = { tone: 550, q: 0.7, lowpass: 1500, decay: 0.036, gain: 0.95 }

/** One piece set down. `pitch` scales the tone: lower for the opponent, higher for captures. */
function tap(ac: AudioContext, out: AudioNode, at: number, pitch = 1) {
  const src = ac.createBufferSource()
  src.buffer = noiseBuffer(ac)
  const band = ac.createBiquadFilter()
  band.type = 'bandpass'
  band.frequency.value = TAP.tone * pitch
  band.Q.value = TAP.q
  const low = ac.createBiquadFilter()
  low.type = 'lowpass'
  low.frequency.value = TAP.lowpass
  src
    .connect(band)
    .connect(low)
    .connect(envelope(ac, out, at, TAP.gain, TAP.decay))
  src.start(at)
  src.stop(at + TAP.decay + 0.02)
}

/** A soft sine note, for check, promotion and wrong moves. */
function chime(
  ac: AudioContext,
  out: AudioNode,
  at: number,
  freq: number,
  gain: number,
  decay: number,
) {
  const osc = ac.createOscillator()
  osc.type = 'sine'
  osc.frequency.value = freq
  osc.connect(envelope(ac, out, at, gain, decay))
  osc.start(at)
  osc.stop(at + decay + 0.02)
}

/**
 * Plays a board sound. `mine` is true for the user's own moves. Does nothing when sound is
 * off or the browser has no Web Audio (tests).
 */
export function playSound(sound: BoardSound, mine = true) {
  if (!enabled || volume === 0) return
  const ac = audio()
  if (!ac) return
  // A suspended context's clock is stopped: sounds scheduled on it would all fire together
  // when it resumes. Wait for it to run, then schedule.
  if (ac.state === 'running') render(ac, sound, mine)
  else
    ac.resume().then(
      () => render(ac, sound, mine),
      () => {},
    )
}

function render(ac: AudioContext, sound: BoardSound, mine: boolean) {
  const out = ac.createGain()
  out.gain.value = volume
  out.connect(ac.destination)
  const t = ac.currentTime + 0.005
  // The opponent's moves sit a little lower, so you can tell them apart by ear.
  const pitch = mine ? 1 : 0.85
  switch (sound) {
    case 'move':
      tap(ac, out, t, pitch)
      break
    case 'capture':
      tap(ac, out, t, 1.35)
      tap(ac, out, t + 0.016, 0.8)
      break
    case 'castle':
      // King, then rook.
      tap(ac, out, t, pitch)
      tap(ac, out, t + 0.075, pitch * 0.85)
      break
    case 'check':
      tap(ac, out, t, pitch)
      chime(ac, out, t + 0.02, 1319, 0.1, 0.12)
      break
    case 'promote':
      tap(ac, out, t, pitch)
      chime(ac, out, t + 0.03, 988, 0.09, 0.1)
      chime(ac, out, t + 0.11, 1319, 0.09, 0.16)
      break
    case 'wrong':
      // Just after the wrong move's own tap, which plays in the same frame: a soft low dip.
      chime(ac, out, t + 0.07, 330, 0.14, 0.09)
      chime(ac, out, t + 0.15, 247, 0.14, 0.16)
      break
  }
}
