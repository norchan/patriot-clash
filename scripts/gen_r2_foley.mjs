// R2 (Michael 2026-08-17): foley-grade base SFX — CANONICAL generator,
// replaces scripts/gen_b8_sfx.mjs (deleted; git history keeps it).
//
// No recorded foley libraries exist in this environment, so this renders the
// most physical synthesis the pack can carry, offline where DSP is free:
//   · MODAL synthesis — decaying inharmonic partials = real material ring
//     (wood knock, metal clank, glass ping, coin chatter)
//   · GRAIN scatter — dozens of micro-transients = debris, rubble, footfalls
//   · pink/brown noise bodies instead of hissy white
//   · a small Schroeder reverb for room on the big moments
// Same 16 filenames as B8 → lib/base-sfx.ts needs zero changes.
// Deterministic seed: re-runs are byte-identical. node scripts/gen_r2_foley.mjs
import fs from 'fs'
import path from 'path'

const SR = 32000
const OUT = 'public/sfx/base'
fs.mkdirSync(OUT, { recursive: true })

let seed = 0xF01E4
const rnd = () => {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const sec = s => Math.round(s * SR)
const render = dur => new Float32Array(sec(dur))

function mix(dest, src, at = 0, gain = 1) {
  const o = sec(at)
  for (let i = 0; i < src.length && o + i < dest.length; i++) dest[o + i] += src[i] * gain
}

// ── building blocks ──────────────────────────────────────────────────────────

/** sum of decaying sine partials — THE material sound. parts: [freq, tau(s), gain] */
function modal(parts, dur, { attack = 0.0008, drift = 0 } = {}) {
  const n = sec(dur), out = new Float32Array(n)
  for (const [f0, tau, g] of parts) {
    const f = f0 * (1 + (rnd() * 2 - 1) * drift)
    let ph = rnd() * Math.PI * 2
    for (let i = 0; i < n; i++) {
      const ts = i / SR
      ph += (2 * Math.PI * f) / SR
      out[i] += Math.sin(ph) * Math.min(1, ts / attack) * Math.exp(-ts / tau) * g
    }
  }
  return out
}

function osc({ type = 'sine', f0, f1 = f0, dur, gain = 1, attack = 0.002, decay = dur, vib = 0, vibHz = 5 }) {
  const n = sec(dur), out = new Float32Array(n)
  let ph = 0
  for (let i = 0; i < n; i++) {
    const ts = i / SR
    const f = f0 * Math.pow(f1 / f0, i / n) * (1 + vib * Math.sin(2 * Math.PI * vibHz * ts))
    ph += (2 * Math.PI * f) / SR
    let v
    if (type === 'sine') v = Math.sin(ph)
    else if (type === 'tri') v = (2 / Math.PI) * Math.asin(Math.sin(ph))
    else v = ((ph / Math.PI) % 2) - 1
    out[i] = v * Math.min(1, ts / attack) * Math.exp(-ts / (decay / 5)) * gain
  }
  return out
}

function noiseBurst({ dur, gain = 1, attack = 0.0008, decay = dur, color = 'white' }) {
  const n = sec(dur), out = new Float32Array(n)
  let lp = 0, lp2 = 0
  for (let i = 0; i < n; i++) {
    const ts = i / SR
    let v = rnd() * 2 - 1
    if (color === 'pink') { lp = 0.96 * lp + 0.04 * v; v = lp * 6 + v * 0.25 }
    else if (color === 'brown') { lp = 0.985 * lp + 0.015 * v; lp2 = 0.985 * lp2 + 0.015 * lp; v = lp2 * 26 }
    out[i] = v * Math.min(1, ts / attack) * Math.exp(-ts / (decay / 5)) * gain
  }
  return out
}

function biquad(samples, type, f0, f1 = f0, Q = 0.9) {
  const out = new Float32Array(samples.length)
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  for (let b = 0; b < samples.length; b += 32) {
    const f = Math.min(SR * 0.45, f0 * Math.pow(f1 / f0, b / samples.length))
    const w = (2 * Math.PI * f) / SR
    const alpha = Math.sin(w) / (2 * Q), cw = Math.cos(w)
    let b0, b1, b2
    if (type === 'lowpass') { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2 }
    else if (type === 'highpass') { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2 }
    else { b0 = alpha; b1 = 0; b2 = -alpha }
    const a0 = 1 + alpha, a1 = -2 * cw, a2 = 1 - alpha
    for (let i = b; i < Math.min(b + 32, samples.length); i++) {
      const x = samples[i]
      const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0
      x2 = x1; x1 = x; y2 = y1; y1 = y
      out[i] = y
    }
  }
  return out
}

/** small Schroeder room — 4 combs + 2 allpasses, mixed UNDER the dry signal */
function reverb(dry, { mix: wet = 0.18, decay = 0.72 } = {}) {
  const out = new Float32Array(dry.length)
  const combs = [1557, 1617, 1491, 1422].map(d => ({ d: Math.round(d * SR / 44100), buf: new Float32Array(Math.round(d * SR / 44100)), i: 0 }))
  const alls = [225, 556].map(d => ({ d: Math.round(d * SR / 44100), buf: new Float32Array(Math.round(d * SR / 44100)), i: 0 }))
  for (let i = 0; i < dry.length; i++) {
    let s = 0
    for (const c of combs) {
      const y = c.buf[c.i]
      c.buf[c.i] = dry[i] + y * decay
      c.i = (c.i + 1) % c.d
      s += y
    }
    s /= combs.length
    for (const a of alls) {
      const y = a.buf[a.i]
      a.buf[a.i] = s + y * 0.5
      s = y - 0.5 * a.buf[a.i]
      a.i = (a.i + 1) % a.d
    }
    out[i] = dry[i] + s * wet
  }
  return out
}

/** scatter tiny sounds across a window — debris, rubble, coin pours */
function grains(dest, count, t0, t1, make, gain = 1) {
  for (let i = 0; i < count; i++) {
    const at = t0 + rnd() * (t1 - t0)
    mix(dest, make(i), at, gain * (0.5 + rnd() * 0.5))
  }
}

function writeWav(name, samples) {
  const clipped = samples.map(v => Math.tanh(v * 1.25))
  let m = 0
  for (const v of clipped) m = Math.max(m, Math.abs(v))
  const g = m > 1e-6 ? 0.85 / m : 1
  const n = clipped.length
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8)
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28)
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40)
  let rms = 0
  for (let i = 0; i < n; i++) {
    const v = clipped[i] * g
    rms += v * v
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), 44 + i * 2)
  }
  fs.writeFileSync(path.join(OUT, name + '.wav'), buf)
  console.log(`  ✔ ${name}.wav  ${(n / SR).toFixed(2)}s  ${Math.round(buf.length / 1024)}KB  rms ${Math.sqrt(rms / n).toFixed(3)}`)
}

// wood knock partial sets (slightly inharmonic — real planks aren't pianos)
const WOOD = [[172, 0.045, 1], [315, 0.032, 0.7], [563, 0.022, 0.5], [917, 0.014, 0.3], [1480, 0.008, 0.18]]
const woodTick = (pitch = 1, dur = 0.08) =>
  modal(WOOD.map(([f, t, g]) => [f * pitch, t * 0.7, g]), dur, { drift: 0.05 })

// ── RAID ─────────────────────────────────────────────────────────────────────

{ // chip — a real plank knock: modal wood + hand thock + one flake of debris
  const a = render(0.24)
  mix(a, modal(WOOD, 0.2, { drift: 0.04 }), 0, 1.0)
  mix(a, biquad(noiseBurst({ dur: 0.05, decay: 0.025, color: 'pink' }), 'lowpass', 1400, 500), 0, 0.75)
  mix(a, woodTick(2.6, 0.05), 0.045, 0.16)
  writeWav('chip', a)
}

{ // breach — crash, then it RAINS: deep drop + brown-noise wall + 16 wood/stone grains + room
  const a = render(1.3)
  mix(a, osc({ f0: 95, f1: 28, dur: 0.6, decay: 0.42, gain: 1.2 }), 0)
  mix(a, biquad(noiseBurst({ dur: 0.55, decay: 0.26, color: 'brown' }), 'lowpass', 2400, 220), 0, 1.15)
  mix(a, biquad(noiseBurst({ dur: 0.09, decay: 0.045 }), 'highpass', 1800), 0, 0.5) // initial splinter spray
  grains(a, 16, 0.08, 0.85, i => i % 3 === 0
    ? biquad(noiseBurst({ dur: 0.05, decay: 0.03 }), 'bandpass', 700 + rnd() * 900, 700, 2)
    : woodTick(0.8 + rnd() * 1.6, 0.07), 0.4)
  mix(a, biquad(noiseBurst({ dur: 1.0, attack: 0.05, decay: 0.75, color: 'brown' }), 'lowpass', 160, 70), 0.1, 0.5)
  writeWav('breach', reverb(a, { mix: 0.14, decay: 0.7 }))
}

{ // splinter — dry wood CRACK, two snaps + bright splinter ring + flakes; no boom
  const a = render(0.55)
  for (const [at, g] of [[0, 1], [0.06, 0.8]]) {
    mix(a, biquad(noiseBurst({ dur: 0.035, decay: 0.016 }), 'highpass', 2600), at, g)
    mix(a, modal([[820, 0.03, 1], [1440, 0.022, 0.8], [2350, 0.014, 0.55], [3900, 0.008, 0.3]], 0.1, { drift: 0.06 }), at, g * 0.8)
  }
  mix(a, woodTick(1, 0.12), 0.015, 0.55)
  grains(a, 5, 0.08, 0.38, () => woodTick(1.8 + rnd() * 1.5, 0.05), 0.2)
  writeWav('splinter', a)
}

{ // gun — crack, mech clank, muzzle thump, tight tail; touch of yard air
  const a = render(0.4)
  mix(a, noiseBurst({ dur: 0.012, decay: 0.005 }), 0, 1.25)                              // the crack
  mix(a, biquad(noiseBurst({ dur: 0.16, decay: 0.07 }), 'bandpass', 2200, 1200, 1.2), 0.002, 0.8) // mid report
  mix(a, osc({ f0: 160, f1: 52, dur: 0.18, decay: 0.11, gain: 0.9 }), 0.004)             // muzzle thump
  mix(a, modal([[2680, 0.05, 1], [4150, 0.03, 0.5]], 0.14, { drift: 0.03 }), 0.015, 0.14) // action ring
  mix(a, biquad(noiseBurst({ dur: 0.3, attack: 0.01, decay: 0.2, color: 'pink' }), 'lowpass', 3800, 420), 0.02, 0.4)
  writeWav('gun', reverb(a, { mix: 0.1, decay: 0.6 }))
}

{ // hit — a round lands: dull body slap + cloth rustle
  const a = render(0.24)
  mix(a, biquad(noiseBurst({ dur: 0.1, decay: 0.05, color: 'pink' }), 'lowpass', 1000, 260), 0, 1.1)
  mix(a, osc({ f0: 240, f1: 95, dur: 0.15, decay: 0.09, gain: 0.8 }), 0)
  grains(a, 3, 0.02, 0.12, () => biquad(noiseBurst({ dur: 0.03, decay: 0.02 }), 'bandpass', 3400, 3000, 2), 0.12)
  writeWav('hit', a)
}

{ // death — two-stage fall: impact, then the ground settle + dust
  const a = render(0.65)
  mix(a, osc({ f0: 135, f1: 42, dur: 0.4, decay: 0.24, gain: 1.05 }), 0)
  mix(a, biquad(noiseBurst({ dur: 0.22, decay: 0.1, color: 'brown' }), 'lowpass', 900, 150), 0, 0.95)
  mix(a, biquad(noiseBurst({ dur: 0.14, decay: 0.07, color: 'pink' }), 'lowpass', 500, 130), 0.13, 0.6) // settle
  grains(a, 4, 0.12, 0.4, () => biquad(noiseBurst({ dur: 0.04, decay: 0.025 }), 'bandpass', 900 + rnd() * 600, 800, 1.8), 0.16)
  writeWav('death', a)
}

// bark — chest + throat formants + breath; a big dog in a yard, not a synth
function wuf(a, at, g, pitch = 1) {
  const voiced = osc({ type: 'saw', f0: 410 * pitch, f1: 215 * pitch, dur: 0.19, attack: 0.012, decay: 0.12, gain: 1 })
  mix(a, biquad(voiced, 'bandpass', 610, 460, 3), at, g * 1.15)          // throat
  mix(a, biquad(voiced, 'bandpass', 1180, 950, 4), at, g * 0.6)          // mouth
  mix(a, biquad(voiced, 'bandpass', 2350, 2100, 5), at, g * 0.28)        // teeth
  mix(a, biquad(osc({ type: 'saw', f0: 118 * pitch, f1: 82 * pitch, dur: 0.17, attack: 0.01, decay: 0.11, gain: 1 }), 'lowpass', 300), at, g * 0.75) // chest
  mix(a, biquad(noiseBurst({ dur: 0.12, attack: 0.004, decay: 0.07, color: 'pink' }), 'bandpass', 1700, 1100, 1.4), at + 0.005, g * 0.34) // breath
}
{
  const a = render(0.7)
  wuf(a, 0, 1, 1)
  wuf(a, 0.28, 0.9, 0.94) // second bark drops a touch — dogs do that
  writeWav('bark', reverb(a, { mix: 0.12, decay: 0.65 }))
}

{ // bite — snap, wet crunch cluster, and the growl underneath
  const a = render(0.42)
  mix(a, biquad(noiseBurst({ dur: 0.018, decay: 0.008 }), 'highpass', 3200), 0, 1)
  mix(a, biquad(noiseBurst({ dur: 0.02, decay: 0.01 }), 'highpass', 2400), 0.05, 1.1)
  grains(a, 6, 0.04, 0.16, () => biquad(noiseBurst({ dur: 0.025, decay: 0.014 }), 'bandpass', 900 + rnd() * 1200, 900, 2.2), 0.5) // crunch
  const growl = osc({ type: 'saw', f0: 92, f1: 68, dur: 0.36, attack: 0.02, decay: 0.26, gain: 1 })
  for (let i = 0; i < growl.length; i++) growl[i] *= 0.6 + 0.4 * Math.sin((2 * Math.PI * 26 * i) / SR)
  mix(a, biquad(growl, 'lowpass', 320), 0.03, 0.6)
  writeWav('bite', a)
}

{ // deploy — two boots into grass: soft thumps + blade swish
  const a = render(0.34)
  for (const [at, g, p] of [[0, 1, 1], [0.1, 0.85, 0.92]]) {
    mix(a, biquad(noiseBurst({ dur: 0.07, decay: 0.035, color: 'pink' }), 'lowpass', 480, 150), at, g)
    mix(a, osc({ f0: 130 * p, f1: 68, dur: 0.09, decay: 0.06, gain: 0.55 }), at + 0.004)
    mix(a, biquad(noiseBurst({ dur: 0.05, attack: 0.006, decay: 0.03 }), 'bandpass', 4200, 3200, 1.2), at + 0.008, 0.16) // grass
  }
  writeWav('deploy', a)
}

{ // win — snare hit into a rising brass-y arpeggio, sparkle rain, room tail
  const a = render(1.65)
  mix(a, biquad(noiseBurst({ dur: 0.12, decay: 0.05, color: 'pink' }), 'bandpass', 1900, 1300, 0.9), 0, 0.5)
  mix(a, osc({ f0: 180, f1: 90, dur: 0.12, decay: 0.07, gain: 0.5 }), 0)
  const N = [523.25, 659.25, 783.99, 1046.5]
  N.forEach((f, i) => {
    const at = 0.06 + i * 0.095
    mix(a, osc({ type: 'tri', f0: f, dur: 0.5, attack: 0.008, decay: 0.3, gain: 0.7 }), at)
    mix(a, osc({ type: 'saw', f0: f, dur: 0.4, attack: 0.01, decay: 0.24, gain: 0.16 }), at) // brass edge
    mix(a, osc({ f0: f * 2.01, dur: 0.3, decay: 0.18, gain: 0.14 }), at)
  })
  for (const f of [523.25, 659.25, 783.99]) mix(a, osc({ type: 'tri', f0: f, dur: 1.05, attack: 0.02, decay: 0.8, gain: 0.42 }), 0.44)
  grains(a, 8, 0.4, 1.1, () => modal([[3200 + rnd() * 2600, 0.06, 1]], 0.1), 0.1) // sparkle
  writeWav('win', reverb(a, { mix: 0.2, decay: 0.78 }))
}

{ // lose — two tired horn notes with vibrato on the drop, soft timpani under
  const a = render(1.35)
  const horn = (f, at, dur, vib) => {
    const v = osc({ type: 'saw', f0: f, dur, attack: 0.04, decay: dur * 0.8, gain: 1, vib, vibHz: 4.5 })
    mix(a, biquad(v, 'lowpass', 640), at, 0.9)
    mix(a, biquad(v, 'lowpass', 240), at, 0.5) // body warmth
  }
  horn(196, 0, 0.45, 0)
  horn(155.6, 0.4, 0.7, 0.012)
  mix(a, osc({ f0: 90, f1: 55, dur: 0.5, decay: 0.32, gain: 0.5 }), 0.44)
  mix(a, biquad(noiseBurst({ dur: 0.3, decay: 0.16, color: 'brown' }), 'lowpass', 200, 90), 0.44, 0.3)
  writeWav('lose', reverb(a, { mix: 0.14, decay: 0.7 }))
}

// ── HOME ─────────────────────────────────────────────────────────────────────

{ // claim — a small POUR of coins: 9 metallic modal chinks, staggered, ringing
  const a = render(0.7)
  const coin = () => modal([
    [3080 * (0.92 + rnd() * 0.16), 0.045, 1],
    [4230 * (0.92 + rnd() * 0.16), 0.032, 0.6],
    [5810 * (0.92 + rnd() * 0.16), 0.02, 0.35],
  ], 0.12)
  mix(a, coin(), 0, 0.9)
  grains(a, 8, 0.03, 0.34, coin, 0.55)
  mix(a, biquad(noiseBurst({ dur: 0.25, attack: 0.01, decay: 0.16 }), 'bandpass', 6800, 7600, 3), 0.02, 0.08)
  writeWav('claim', a)
}

{ // place — heavy timber set down: deep wood knock + dirt settle + soft confirm
  const a = render(0.5)
  mix(a, modal([[128, 0.07, 1], [242, 0.05, 0.7], [415, 0.03, 0.45], [700, 0.018, 0.25]], 0.3, { drift: 0.04 }), 0, 1.1)
  mix(a, biquad(noiseBurst({ dur: 0.1, decay: 0.05, color: 'pink' }), 'lowpass', 800, 220), 0, 0.8)
  grains(a, 5, 0.05, 0.22, () => biquad(noiseBurst({ dur: 0.03, decay: 0.018 }), 'bandpass', 1100 + rnd() * 700, 1000, 2), 0.2)
  mix(a, osc({ f0: 690, f1: 930, dur: 0.11, decay: 0.07, gain: 0.2 }), 0.2)
  writeWav('place', a)
}

{ // hammer — steel on nail on wood, twice: clank + wood body + overtone beat
  const a = render(0.6)
  for (const [at, g] of [[0, 1], [0.22, 0.88]]) {
    mix(a, biquad(noiseBurst({ dur: 0.012, decay: 0.006 }), 'highpass', 3000), at, g * 0.7)
    mix(a, modal([[1870, 0.06, 1], [1930, 0.055, 0.7], [3320, 0.035, 0.55], [5140, 0.02, 0.3]], 0.2, { drift: 0.015 }), at, g)
    mix(a, modal(WOOD, 0.12, { drift: 0.05 }), at + 0.002, g * 0.5)
  }
  writeWav('hammer', reverb(a, { mix: 0.08, decay: 0.55 }))
}

{ // done — small bell, two notes: modal with real inharmonic hum + long ring
  const a = render(1.15)
  const bell = (f, at, g) => mix(a, modal([
    [f, 0.35, 1], [f * 2.02, 0.22, 0.5], [f * 2.94, 0.13, 0.28], [f * 4.1, 0.07, 0.14], [f * 0.5, 0.4, 0.22],
  ], 0.9, { attack: 0.001 }), at, g)
  bell(784, 0, 0.75)
  bell(1046.5, 0.18, 0.9)
  writeWav('done', reverb(a, { mix: 0.16, decay: 0.7 }))
}

{ // ready — one glass ping, quiet by design
  const a = render(0.5)
  mix(a, modal([[1174.7, 0.16, 1], [2356, 0.09, 0.4], [3540, 0.05, 0.18]], 0.42, { attack: 0.0006 }), 0, 0.9)
  writeWav('ready', a)
}

console.log('DONE')
