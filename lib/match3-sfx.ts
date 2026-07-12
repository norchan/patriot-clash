// WebAudio sound effects for Landslide (match-3). Self-contained, no assets.
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
  const osc = c.createOscillator(); const g = c.createGain()
  osc.type = type; osc.frequency.setValueAtTime(freq, t0)
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  osc.connect(g).connect(c.destination)
  osc.start(t0); osc.stop(t0 + dur + 0.02)
}

export const swap = () => { tone(500, 0, 0.06, 'sine', 0.06); tone(660, 0.03, 0.06, 'sine', 0.05) }
export const invalid = () => { tone(200, 0, 0.1, 'square', 0.06); tone(150, 0.06, 0.12, 'square', 0.05) }
// Match — pitch rises with the combo for a satisfying cascade
export function match(combo: number) {
  const base = 520 + Math.min(combo, 8) * 70
  tone(base, 0, 0.12, 'triangle', 0.09)
  tone(base * 1.5, 0.04, 0.14, 'sine', 0.06)
}
export function blast() {
  tone(180, 0, 0.18, 'sawtooth', 0.09)
  ;[440, 660, 880].forEach((f, i) => tone(f, i * 0.04, 0.16, 'square', 0.06))
}
export function levelUp() {
  const notes = [392, 523, 659, 784, 1047, 1319]
  notes.forEach((f, i) => tone(f, i * 0.09, 0.24, 'square', 0.08))
  ;[196, 262, 330].forEach(f => tone(f, 0, 0.9, 'sawtooth', 0.03))
}
export function gameOver() {
  [523, 415, 349, 262].forEach((f, i) => tone(f, i * 0.14, 0.3, 'sawtooth', 0.07))
}
export const coin = () => tone(1000 + Math.random() * 200, 0, 0.05, 'square', 0.05)
