// Base sound layer (B8): one AudioContext for everything the base does.
//
// The samples are real WAVs under /sfx/base/ (rendered by
// scripts/gen_b8_sfx.mjs — ~460KB total); this module is a dumb, safe buffer
// player: lazy context, per-sound throttles, a global voice cap, and a
// limiter on the master bus so a full army + turret battery gets LOUD but
// never turns to clipping mush. All entry points are server-safe no-ops.
//
// lib/juice.ts (PvP/siege) and lib/ambient.ts (HQ music pad) are untouched —
// this is the base's own channel, mixed for its own dynamics.

export type BaseSfxName =
  | 'chip' | 'breach' | 'splinter' | 'gun' | 'hit' | 'death'
  | 'bark' | 'bite' | 'deploy' | 'win' | 'lose'
  | 'claim' | 'place' | 'hammer' | 'done' | 'ready'

let ctx: AudioContext | null = null
let master: GainNode | null = null
let voices = 0
const lastAt: Partial<Record<BaseSfxName, number>> = {}
const buffers = new Map<BaseSfxName, AudioBuffer | 'loading' | 'failed'>()

// per-sound mix: base gain + min ms between repeats (the spam killers)
const MIX: Record<BaseSfxName, { gain: number; every: number }> = {
  chip: { gain: 0.5, every: 70 },
  breach: { gain: 0.9, every: 120 },
  splinter: { gain: 0.65, every: 100 },
  gun: { gain: 0.4, every: 65 },
  hit: { gain: 0.45, every: 80 },
  death: { gain: 0.7, every: 110 },
  bark: { gain: 0.75, every: 400 },
  bite: { gain: 0.6, every: 200 },
  deploy: { gain: 0.5, every: 90 },
  win: { gain: 0.9, every: 2000 },
  lose: { gain: 0.8, every: 2000 },
  claim: { gain: 0.7, every: 150 },
  place: { gain: 0.7, every: 150 },
  hammer: { gain: 0.7, every: 150 },
  done: { gain: 0.7, every: 400 },
  ready: { gain: 0.45, every: 1500 },
}
const MAX_VOICES = 14

function ac(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const AC = window.AudioContext ?? (window as any).webkitAudioContext
    if (!AC) return null
    ctx = new AC()
    master = ctx.createGain()
    // reduced-motion users get a gentler mix, not silence
    let quiet = false
    try { quiet = window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch {}
    master.gain.value = quiet ? 0.5 : 0.9
    const limiter = ctx.createDynamicsCompressor()
    limiter.threshold.value = -14
    limiter.knee.value = 8
    limiter.ratio.value = 8
    limiter.attack.value = 0.003
    limiter.release.value = 0.22
    master.connect(limiter).connect(ctx.destination)
    // tab hidden → whole base channel sleeps (ambience included); back → resumes
    document.addEventListener('visibilitychange', () => {
      if (!ctx) return
      if (document.hidden) ctx.suspend().catch(() => {})
      else ctx.resume().catch(() => {})
    })
  }
  if (ctx.state === 'suspended' && !document.hidden) ctx.resume().catch(() => {})
  return ctx
}

function load(name: BaseSfxName): void {
  if (buffers.has(name)) return
  const c = ac()
  if (!c) return
  buffers.set(name, 'loading')
  fetch(`/sfx/base/${name}.wav`)
    .then(r => r.arrayBuffer())
    .then(ab => c.decodeAudioData(ab))
    .then(b => { buffers.set(name, b) })
    .catch(() => { buffers.set(name, 'failed') })
}

/** Warm the decode cache (call at raid deploy / HQ first gesture). */
export function preloadBaseSfx(names: BaseSfxName[]): void {
  try { for (const n of names) load(n) } catch {}
}

/**
 * Fire a one-shot. `rate` shifts pitch (1 = as recorded); `jitter` adds
 * ±jitter random rate variation so 40 chips don't sound like a machine.
 */
export function playBase(name: BaseSfxName, opts?: { gain?: number; rate?: number; jitter?: number }): void {
  try {
    const c = ac()
    if (!c || !master) return
    const now = performance.now()
    const mix = MIX[name]
    if (now - (lastAt[name] ?? -1e9) < mix.every) return
    const buf = buffers.get(name)
    if (!buf || buf === 'loading') { load(name); return } // first call warms, next one plays
    if (buf === 'failed') return
    if (voices >= MAX_VOICES) return
    lastAt[name] = now
    voices++
    const src = c.createBufferSource()
    src.buffer = buf
    const j = opts?.jitter ?? 0
    src.playbackRate.value = (opts?.rate ?? 1) * (j > 0 ? 1 - j + Math.random() * 2 * j : 1)
    const g = c.createGain()
    g.gain.value = mix.gain * (opts?.gain ?? 1)
    src.connect(g).connect(master)
    src.onended = () => { voices = Math.max(0, voices - 1); try { src.disconnect(); g.disconnect() } catch {} }
    src.start()
  } catch {}
}

// ── Yard ambience: a generative quiet bed (wind + birds + distant town) ─────
// No file, no loop seam — filtered noise breathes under occasional pentatonic
// bird chirps. Sits UNDER the music pad (lib/ambient.ts) at whisper level and
// ducks while a sheet is open so menus feel like stepping indoors.

let amb: { gain: GainNode; stop: () => void } | null = null
let ducked = false

export const yardAmbience = {
  running(): boolean { return !!amb },
  start(): void {
    try {
      if (amb) return
      const c = ac()
      if (!c || !master) return
      const bed = c.createGain()
      bed.gain.value = 0
      bed.gain.linearRampToValueAtTime(ducked ? 0.35 : 1, c.currentTime + 2.5)
      bed.connect(master)

      // wind: looped noise through a slowly breathing lowpass
      const nb = c.createBuffer(1, c.sampleRate * 2, c.sampleRate)
      const d = nb.getChannelData(0)
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
      const wind = c.createBufferSource()
      wind.buffer = nb; wind.loop = true
      const lp = c.createBiquadFilter()
      lp.type = 'lowpass'; lp.frequency.value = 380; lp.Q.value = 0.4
      const windGain = c.createGain()
      windGain.gain.value = 0.055
      const lfo = c.createOscillator()
      const lfoGain = c.createGain()
      lfo.frequency.value = 0.06; lfoGain.gain.value = 130
      lfo.connect(lfoGain); lfoGain.connect(lp.frequency)
      wind.connect(lp).connect(windGain).connect(bed)
      wind.start(); lfo.start()

      // distant town: barely-there low rumble floor
      const rumble = c.createBufferSource()
      rumble.buffer = nb; rumble.loop = true; rumble.playbackRate.value = 0.5
      const rlp = c.createBiquadFilter()
      rlp.type = 'lowpass'; rlp.frequency.value = 110
      const rGain = c.createGain()
      rGain.gain.value = 0.03
      rumble.connect(rlp).connect(rGain).connect(bed)
      rumble.start()

      // birds: a 2–4 note chirp every 4–10s, high and quiet
      let chirpTimer: ReturnType<typeof setTimeout>
      let alive = true
      const chirp = () => {
        if (!alive || !ctx) return
        const t0 = c.currentTime
        const notes = 2 + Math.floor(Math.random() * 3)
        const base = 2300 + Math.random() * 900
        for (let i = 0; i < notes; i++) {
          const o = c.createOscillator()
          const og = c.createGain()
          const at = t0 + i * (0.09 + Math.random() * 0.05)
          o.frequency.setValueAtTime(base * (1 + Math.random() * 0.25), at)
          o.frequency.exponentialRampToValueAtTime(base * (0.8 + Math.random() * 0.5), at + 0.07)
          og.gain.setValueAtTime(0, at)
          og.gain.linearRampToValueAtTime(0.035, at + 0.015)
          og.gain.exponentialRampToValueAtTime(0.0005, at + 0.11)
          o.connect(og).connect(bed)
          o.start(at); o.stop(at + 0.13)
        }
        chirpTimer = setTimeout(chirp, 4000 + Math.random() * 6000)
      }
      chirpTimer = setTimeout(chirp, 1500 + Math.random() * 2000)

      amb = {
        gain: bed,
        stop: () => {
          alive = false
          clearTimeout(chirpTimer)
          try {
            bed.gain.cancelScheduledValues(c.currentTime)
            bed.gain.linearRampToValueAtTime(0, c.currentTime + 0.6)
          } catch {}
          setTimeout(() => {
            try { wind.stop(); rumble.stop(); lfo.stop(); bed.disconnect() } catch {}
          }, 700)
        },
      }
    } catch {}
  },
  stop(): void {
    if (!amb) return
    amb.stop()
    amb = null
  },
  /** Sheet/modal open → the yard steps back; close → it breathes again. */
  duck(on: boolean): void {
    ducked = on
    try {
      if (!amb || !ctx) return
      amb.gain.gain.cancelScheduledValues(ctx.currentTime)
      amb.gain.gain.linearRampToValueAtTime(on ? 0.35 : 1, ctx.currentTime + 0.35)
    } catch {}
  },
}
