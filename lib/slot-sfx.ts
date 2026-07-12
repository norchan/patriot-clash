// WebAudio sound effects for the Slots Salute machines. Self-contained, no
// assets — a shared AudioContext lazily created on first use (after a user
// gesture, per browser autoplay rules).

let ctx: AudioContext | null = null
function ac(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const AC = window.AudioContext || (window as any).webkitAudioContext
    if (!AC) return null
    ctx = new AC()
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  return ctx
}

function tone(freq: number, start: number, dur: number, type: OscillatorType, gain: number) {
  const c = ac(); if (!c) return
  const t0 = c.currentTime + start
  const osc = c.createOscillator()
  const g = c.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t0)
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  osc.connect(g).connect(c.destination)
  osc.start(t0)
  osc.stop(t0 + dur + 0.02)
}

// Rising whir while the reels spin
let spinTimer: ReturnType<typeof setInterval> | null = null
export function spinStart() {
  const c = ac(); if (!c) return
  stopSpin()
  let f = 220
  const tick = () => { tone(f, 0, 0.06, 'sawtooth', 0.04); f = Math.min(660, f + 12) }
  tick()
  spinTimer = setInterval(tick, 55)
}
export function stopSpin() {
  if (spinTimer) { clearInterval(spinTimer); spinTimer = null }
}

// Chunky click as each reel locks
export function reelStop() {
  tone(180, 0, 0.08, 'square', 0.08)
  tone(90, 0.01, 0.1, 'sine', 0.06)
}

// Coin-drop / small win
export function win() {
  [660, 880, 990].forEach((f, i) => tone(f, i * 0.09, 0.18, 'triangle', 0.09))
}

// Big win fanfare
export function jackpot() {
  const notes = [523, 659, 784, 1047, 784, 1047, 1319]
  notes.forEach((f, i) => tone(f, i * 0.1, 0.24, 'square', 0.08))
  ;[523, 659, 784].forEach(f => tone(f, 0, 0.6, 'sawtooth', 0.03))
}

// Soft thunk for a losing spin
export function lose() {
  tone(160, 0, 0.18, 'sine', 0.05)
  tone(120, 0.05, 0.22, 'sine', 0.04)
}
