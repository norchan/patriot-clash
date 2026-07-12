// Sound + haptics "juice" layer for battle screens.
//
// Every effect is synthesized with WebAudio at runtime — no audio files to
// host, license, or download on cellular. The AudioContext is created lazily
// on the first call, which the browser only allows after a user gesture;
// battle screens are always entered via a tap, so the context unlocks
// naturally. All functions are safe to call on the server (no-ops).

let ctx: AudioContext | null = null
let master: GainNode | null = null

function ac(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const AC = window.AudioContext ?? (window as any).webkitAudioContext
    if (!AC) return null
    ctx = new AC()
    master = ctx.createGain()
    master.gain.value = 0.5
    master.connect(ctx.destination)
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  return ctx
}

// Shared white-noise buffer (built once)
let noiseBuf: AudioBuffer | null = null
function noise(c: AudioContext): AudioBuffer {
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate)
    const d = noiseBuf.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  }
  return noiseBuf
}

type ToneOpts = {
  freq: number; endFreq?: number; dur: number; type?: OscillatorType
  gain?: number; delay?: number
}
function tone({ freq, endFreq, dur, type = 'sine', gain = 0.3, delay = 0 }: ToneOpts) {
  const c = ac(); if (!c || !master) return
  const t = c.currentTime + delay
  const o = c.createOscillator()
  const g = c.createGain()
  o.type = type
  o.frequency.setValueAtTime(freq, t)
  if (endFreq) o.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), t + dur)
  g.gain.setValueAtTime(gain, t)
  g.gain.exponentialRampToValueAtTime(0.001, t + dur)
  o.connect(g).connect(master)
  o.start(t); o.stop(t + dur + 0.02)
}

type BurstOpts = {
  dur: number; gain?: number; delay?: number
  filter?: { type: BiquadFilterType; freq: number; endFreq?: number; q?: number }
}
function burst({ dur, gain = 0.3, delay = 0, filter }: BurstOpts) {
  const c = ac(); if (!c || !master) return
  const t = c.currentTime + delay
  const src = c.createBufferSource()
  src.buffer = noise(c)
  const g = c.createGain()
  g.gain.setValueAtTime(gain, t)
  g.gain.exponentialRampToValueAtTime(0.001, t + dur)
  let node: AudioNode = src
  if (filter) {
    const f = c.createBiquadFilter()
    f.type = filter.type
    f.frequency.setValueAtTime(filter.freq, t)
    if (filter.endFreq) f.frequency.exponentialRampToValueAtTime(Math.max(10, filter.endFreq), t + dur)
    f.Q.value = filter.q ?? 1
    node.connect(f); node = f
  }
  node.connect(g); g.connect(master)
  src.start(t); src.stop(t + dur + 0.02)
}

// ── Siege battle loop: a driving war-drum + brass-swell bed ─────────────────
// Synthesized, looped via setInterval; call siegeMusic.start() when the
// assault begins and .stop() when it ends. Self-contained (no files).
let siegeTimer: ReturnType<typeof setInterval> | null = null
let siegeBed: { osc: OscillatorNode; gain: GainNode } | null = null
export const siegeMusic = {
  start() {
    const c = ac(); if (!c || !master || siegeTimer) return
    // low droning brass pad for tension
    const osc = c.createOscillator()
    const g = c.createGain()
    osc.type = 'sawtooth'
    osc.frequency.value = 82 // low E
    const lp = c.createBiquadFilter()
    lp.type = 'lowpass'; lp.frequency.value = 320; lp.Q.value = 0.7
    g.gain.value = 0.05
    osc.connect(lp).connect(g).connect(master)
    osc.start()
    siegeBed = { osc, gain: g }

    // war-drum pattern: BOOM . boom boom . at ~132bpm (16th grid)
    const pattern = [1, 0, 0, 0.5, 0, 0, 1, 0, 0, 0.5, 0.5, 0, 1, 0, 0.6, 0]
    let step = 0
    siegeTimer = setInterval(() => {
      const hit = pattern[step % pattern.length]
      if (hit > 0) {
        tone({ freq: 130, endFreq: 44, dur: 0.18, type: 'sine', gain: 0.5 * hit })
        burst({ dur: 0.05, gain: 0.12 * hit, filter: { type: 'lowpass', freq: 1600, endFreq: 300 } })
      }
      // brass stab on the downbeat of every other bar
      if (step % 32 === 0) tone({ freq: 165, endFreq: 220, dur: 0.5, type: 'sawtooth', gain: 0.1 })
      step++
    }, 118) // ~16th at 132bpm
  },
  stop() {
    if (siegeTimer) { clearInterval(siegeTimer); siegeTimer = null }
    if (siegeBed) {
      try {
        const c = ac()
        if (c) siegeBed.gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.3)
        siegeBed.osc.stop((c?.currentTime ?? 0) + 0.35)
      } catch { /* noop */ }
      siegeBed = null
    }
  },
}

// ── Haptics ──────────────────────────────────────────────────────────────────
export function buzz(pattern: number | number[]) {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try { navigator.vibrate(pattern) } catch { /* unsupported */ }
  }
}

// ── Fight SFX ────────────────────────────────────────────────────────────────
export const sfx = {
  /** Fist meets face. heavy = uppercut/finisher */
  punch(heavy = false) {
    burst({ dur: 0.09, gain: heavy ? 0.5 : 0.35, filter: { type: 'lowpass', freq: 1400, endFreq: 300 } })
    tone({ freq: heavy ? 150 : 190, endFreq: 55, dur: 0.16, type: 'sine', gain: heavy ? 0.55 : 0.4 })
    buzz(heavy ? 40 : 20)
  },
  /** Boot meets ribs — deeper than a punch */
  kick() {
    burst({ dur: 0.12, gain: 0.45, filter: { type: 'lowpass', freq: 900, endFreq: 200 } })
    tone({ freq: 120, endFreq: 45, dur: 0.2, type: 'sine', gain: 0.55 })
    buzz(30)
  },
  /** Attack absorbed on the guard */
  block() {
    burst({ dur: 0.06, gain: 0.22, filter: { type: 'bandpass', freq: 700, q: 2 } })
    tone({ freq: 260, endFreq: 180, dur: 0.08, type: 'triangle', gain: 0.16 })
    buzz(12)
  },
  /** Swing and a miss */
  whoosh() {
    burst({ dur: 0.18, gain: 0.16, filter: { type: 'bandpass', freq: 500, endFreq: 2400, q: 1.5 } })
  },
  /** Round bell — double ding for start, single for end */
  bell(double = true) {
    for (let i = 0; i < (double ? 2 : 1); i++) {
      tone({ freq: 875, dur: 0.7, type: 'triangle', gain: 0.28, delay: i * 0.28 })
      tone({ freq: 2210, dur: 0.45, type: 'sine', gain: 0.1, delay: i * 0.28 })
    }
  },
  /** Crowd reaction — 0..1 intensity */
  crowd(intensity = 0.6) {
    burst({ dur: 0.9 + intensity * 0.7, gain: 0.1 + intensity * 0.16, filter: { type: 'bandpass', freq: 950, q: 0.6 } })
    burst({ dur: 0.7 + intensity * 0.5, gain: 0.08 + intensity * 0.1, delay: 0.05, filter: { type: 'lowpass', freq: 500 } })
  },
  /** Knockout: huge hit + pitch drop + roar */
  ko() {
    burst({ dur: 0.25, gain: 0.6, filter: { type: 'lowpass', freq: 1100, endFreq: 120 } })
    tone({ freq: 220, endFreq: 30, dur: 0.55, type: 'sine', gain: 0.65 })
    this.crowd(1)
    buzz([60, 40, 120])
  },
  /** Rising major arpeggio */
  victory() {
    const notes = [523, 659, 784, 1047]
    notes.forEach((f, i) => tone({ freq: f, dur: 0.32, type: 'triangle', gain: 0.24, delay: i * 0.11 }))
    tone({ freq: 1047, dur: 0.7, type: 'sine', gain: 0.14, delay: 0.44 })
    this.crowd(0.9)
    buzz([30, 50, 30, 50, 90])
  },
  /** Sad descending line */
  defeat() {
    const notes = [392, 349, 311, 262]
    notes.forEach((f, i) => tone({ freq: f, dur: 0.4, type: 'triangle', gain: 0.18, delay: i * 0.17 }))
    buzz(150)
  },
  /** Siege cannon-blow on the hall */
  siegeBlow() {
    burst({ dur: 0.35, gain: 0.55, filter: { type: 'lowpass', freq: 700, endFreq: 80 } })
    tone({ freq: 90, endFreq: 28, dur: 0.5, type: 'sine', gain: 0.6 })
    // rubble crackle
    burst({ dur: 0.3, gain: 0.14, delay: 0.12, filter: { type: 'highpass', freq: 1800 } })
    buzz([50, 30, 40])
  },
  /** Hall captured — bell + fanfare + roar */
  capture() {
    this.bell(false)
    this.victory()
  },
  /** Small UI confirmation blip */
  tap() {
    tone({ freq: 660, endFreq: 880, dur: 0.07, type: 'sine', gain: 0.12 })
  },
}
