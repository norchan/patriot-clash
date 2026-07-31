// AMBIENT BASE MUSIC (Michael 2026-07-31: "soft intoxicating music like CoC").
//
// Synthesized with WebAudio — no audio files, same philosophy as lib/juice.ts.
// A slow four-chord pad (Cmaj7 → Am7 → Fmaj7 → G6) on detuned triangle
// oscillators behind a gently breathing lowpass, plus an occasional soft
// pentatonic pluck on top so it sparkles without demanding attention.
//
// Browsers block audio until a user gesture, so start() must be called from a
// tap handler. The base page wires it to the first interaction and remembers
// the on/off choice in localStorage.

let ctx: AudioContext | null = null
let master: GainNode | null = null
let stopFns: Array<() => void> = []
let running = false

const CHORDS: number[][] = [
  [130.81, 164.81, 196.0, 246.94],  // Cmaj7
  [110.0, 130.81, 164.81, 196.0],   // Am7
  [87.31, 130.81, 174.61, 220.0],   // Fmaj7
  [98.0, 123.47, 146.83, 196.0],    // G6
]
const CHORD_SECS = 8
const PLUCK_SCALE = [523.25, 587.33, 659.25, 783.99, 880.0] // C pentatonic, up top

export function ambientRunning(): boolean { return running }

export function startAmbient(): void {
  if (running) return
  try {
    ctx = ctx ?? new (window.AudioContext || (window as any).webkitAudioContext)()
    if (ctx.state === 'suspended') ctx.resume()
  } catch { return }
  const ac = ctx!
  running = true

  master = ac.createGain()
  master.gain.value = 0
  master.gain.linearRampToValueAtTime(0.055, ac.currentTime + 3) // fade in, stay QUIET

  // breathing lowpass — the "underwater warmth" of the CoC-style pad
  const filter = ac.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = 750
  const lfo = ac.createOscillator()
  const lfoGain = ac.createGain()
  lfo.frequency.value = 0.05
  lfoGain.gain.value = 220
  lfo.connect(lfoGain); lfoGain.connect(filter.frequency)
  lfo.start()
  filter.connect(master); master.connect(ac.destination)

  // the pad: each chord gets slightly detuned triangle pairs, slow attack
  let chordIdx = 0
  let alive = true
  const playChord = () => {
    if (!alive) return
    const notes = CHORDS[chordIdx % CHORDS.length]
    chordIdx++
    const now = ac.currentTime
    for (const f of notes) {
      for (const detune of [-4, 3]) {
        const o = ac.createOscillator()
        const g = ac.createGain()
        o.type = 'triangle'
        o.frequency.value = f
        o.detune.value = detune
        g.gain.setValueAtTime(0, now)
        g.gain.linearRampToValueAtTime(0.16, now + 2.5)
        g.gain.setValueAtTime(0.16, now + CHORD_SECS - 2)
        g.gain.linearRampToValueAtTime(0, now + CHORD_SECS + 0.5)
        o.connect(g); g.connect(filter)
        o.start(now); o.stop(now + CHORD_SECS + 1)
      }
    }
  }
  playChord()
  const chordTimer = setInterval(playChord, CHORD_SECS * 1000)

  // occasional soft pluck — a little star over the pad every 5–11 seconds
  let pluckTimer: ReturnType<typeof setTimeout>
  const pluck = () => {
    if (!alive) return
    const now = ac.currentTime
    const o = ac.createOscillator()
    const g = ac.createGain()
    o.type = 'sine'
    o.frequency.value = PLUCK_SCALE[Math.floor(Math.random() * PLUCK_SCALE.length)]
    g.gain.setValueAtTime(0.045, now)
    g.gain.exponentialRampToValueAtTime(0.0001, now + 1.8)
    o.connect(g); g.connect(filter)
    o.start(now); o.stop(now + 2)
    pluckTimer = setTimeout(pluck, 5000 + Math.random() * 6000)
  }
  pluckTimer = setTimeout(pluck, 4000)

  stopFns = [() => {
    alive = false
    clearInterval(chordTimer)
    clearTimeout(pluckTimer)
    lfo.stop()
    if (master && ac) {
      master.gain.cancelScheduledValues(ac.currentTime)
      master.gain.linearRampToValueAtTime(0, ac.currentTime + 0.8)
    }
  }]
}

export function stopAmbient(): void {
  if (!running) return
  running = false
  for (const f of stopFns) f()
  stopFns = []
}
