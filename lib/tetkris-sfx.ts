// WebAudio sound effects for Tet-Kris. Self-contained, no assets. Shared
// AudioContext created lazily on first user gesture.
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
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  osc.connect(g).connect(c.destination)
  osc.start(t0); osc.stop(t0 + dur + 0.02)
}

export const move = () => tone(240, 0, 0.04, 'square', 0.05)
export const rotate = () => { tone(420, 0, 0.05, 'square', 0.06); tone(560, 0.02, 0.05, 'square', 0.04) }
export const softDrop = () => tone(160, 0, 0.03, 'triangle', 0.04)
export const lock = () => { tone(150, 0, 0.07, 'square', 0.07); tone(90, 0.01, 0.09, 'sine', 0.05) }
export const hold = () => { tone(500, 0, 0.06, 'sine', 0.06); tone(380, 0.04, 0.06, 'sine', 0.05) }

// Line clear — brighter & longer with more lines (1..4)
export function lineClear(n: number) {
  const notes = [523, 659, 784, 1047]
  for (let i = 0; i < Math.max(1, n); i++) tone(notes[i] ?? 1047, i * 0.06, 0.2, 'triangle', 0.09)
  if (n >= 4) { [1047, 1319, 1568].forEach((f, i) => tone(f, 0.24 + i * 0.06, 0.24, 'square', 0.08)) }
}

export function levelUp() {
  const notes = [392, 523, 659, 784, 1047]
  notes.forEach((f, i) => tone(f, i * 0.08, 0.22, 'square', 0.08))
  ;[196, 262, 330].forEach(f => tone(f, 0, 0.7, 'sawtooth', 0.03))
}

export function gameOver() {
  const notes = [523, 440, 349, 262, 196]
  notes.forEach((f, i) => tone(f, i * 0.13, 0.3, 'sawtooth', 0.07))
}
