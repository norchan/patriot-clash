// Base Crown Jewel B8 (Grok 2026-08-16): the base sound pack.
//
// Every sample is RENDERED here — layered noise, swept biquads, formant
// synthesis — and shipped as a real 22.05kHz mono WAV under public/sfx/base/.
// Offline rendering buys DSP that would be wasteful live (per-block filter
// sweeps, crackle scatter, formant stacks) while the runtime stays a dumb
// buffer player. Deterministic seed so re-runs produce identical bytes.
// node scripts/gen_b8_sfx.mjs
import fs from 'fs'
import path from 'path'

const SR = 22050
const OUT = 'public/sfx/base'
fs.mkdirSync(OUT, { recursive: true })

// deterministic PRNG (mulberry32) — same pack every run
let seed = 0xB8B8B8
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

// oscillator with exponential freq sweep + attack/exp-decay envelope
function osc({ type = 'sine', f0, f1 = f0, dur, gain = 1, attack = 0.002, decay = dur }) {
  const n = sec(dur), out = new Float32Array(n)
  let ph = 0
  for (let i = 0; i < n; i++) {
    const f = f0 * Math.pow(f1 / f0, i / n)
    ph += (2 * Math.PI * f) / SR
    let v
    if (type === 'sine') v = Math.sin(ph)
    else if (type === 'tri') v = (2 / Math.PI) * Math.asin(Math.sin(ph))
    else v = ((ph / Math.PI) % 2) - 1 // saw
    const ts = i / SR
    out[i] = v * Math.min(1, ts / attack) * Math.exp(-ts / (decay / 5)) * gain
  }
  return out
}

function noiseBurst({ dur, gain = 1, attack = 0.001, decay = dur }) {
  const n = sec(dur), out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const ts = i / SR
    out[i] = (rnd() * 2 - 1) * Math.min(1, ts / attack) * Math.exp(-ts / (decay / 5)) * gain
  }
  return out
}

// RBJ biquad; coefficients recomputed per 32-sample block so f0→f1 sweeps work
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
    else { b0 = alpha; b1 = 0; b2 = -alpha } // bandpass
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

function writeWav(name, samples) {
  let m = 0
  const clipped = samples.map(v => Math.tanh(v * 1.3))
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

// ── RAID ─────────────────────────────────────────────────────────────────────

// chip — troop swing lands: light woody knock, runtime adds pitch jitter
{
  const a = render(0.18)
  mix(a, biquad(noiseBurst({ dur: 0.09, decay: 0.05 }), 'bandpass', 950, 700, 1.8), 0, 0.9)
  mix(a, osc({ f0: 230, f1: 95, dur: 0.13, decay: 0.09, gain: 0.8 }), 0)
  writeWav('chip', a)
}

// breach — a building goes DOWN: boom + crash + scattered crackle + rumble tail
{
  const a = render(1.05)
  mix(a, osc({ f0: 120, f1: 34, dur: 0.55, decay: 0.4, gain: 1.15 }), 0)
  mix(a, biquad(noiseBurst({ dur: 0.6, decay: 0.3 }), 'lowpass', 1500, 180), 0, 0.95)
  mix(a, biquad(noiseBurst({ dur: 0.9, decay: 0.7 }), 'lowpass', 220, 90), 0.08, 0.5)
  for (let i = 0; i < 7; i++) { // debris crackle raining after the hit
    mix(a, biquad(noiseBurst({ dur: 0.045, decay: 0.03 }), 'highpass', 1300 + rnd() * 900), 0.1 + rnd() * 0.5, 0.28)
  }
  writeWav('breach', a)
}

// splinter — fence dies: dry double CRACK, no boom (must not read as a building)
{
  const a = render(0.5)
  for (const [at, g] of [[0, 1], [0.07, 0.75]]) {
    mix(a, biquad(noiseBurst({ dur: 0.05, decay: 0.03 }), 'highpass', 2400), at, g)
    mix(a, biquad(noiseBurst({ dur: 0.12, decay: 0.07 }), 'bandpass', 1700, 900, 2.5), at, g * 0.9)
  }
  mix(a, osc({ f0: 310, f1: 130, dur: 0.12, decay: 0.08, gain: 0.55 }), 0.02)
  writeWav('splinter', a)
}

// gun — turret crack: snap + body thump + tiny metallic ring (runtime pitches by level)
{
  const a = render(0.32)
  mix(a, biquad(noiseBurst({ dur: 0.05, decay: 0.022 }), 'highpass', 1300), 0, 1.1)
  mix(a, biquad(noiseBurst({ dur: 0.14, decay: 0.07 }), 'lowpass', 3200, 380), 0, 0.8)
  mix(a, osc({ f0: 175, f1: 58, dur: 0.16, decay: 0.1, gain: 0.85 }), 0.004)
  mix(a, biquad(noiseBurst({ dur: 0.2, decay: 0.14 }), 'bandpass', 2900, 2600, 9), 0.01, 0.16)
  writeWav('gun', a)
}

// hit — turret round lands on a troop: short slap, lighter than death
{
  const a = render(0.2)
  mix(a, biquad(noiseBurst({ dur: 0.12, decay: 0.06 }), 'lowpass', 950, 260), 0, 0.95)
  mix(a, osc({ f0: 265, f1: 105, dur: 0.14, decay: 0.09, gain: 0.75 }), 0)
  writeWav('hit', a)
}

// death — troop drops: heavier, slower thud with weight
{
  const a = render(0.55)
  mix(a, osc({ f0: 150, f1: 44, dur: 0.42, decay: 0.28, gain: 1.05 }), 0)
  mix(a, biquad(noiseBurst({ dur: 0.32, decay: 0.16 }), 'lowpass', 750, 140), 0, 0.8)
  mix(a, biquad(noiseBurst({ dur: 0.08, decay: 0.05 }), 'bandpass', 500, 400, 1.5), 0.03, 0.4)
  writeWav('death', a)
}

// bark — K-9 aggro: two formant-stacked "WUF"s, unmistakably not a gun
function wuf(a, at, g) {
  const voiced = osc({ type: 'saw', f0: 430, f1: 225, dur: 0.17, attack: 0.01, decay: 0.11, gain: 1 })
  mix(a, biquad(voiced, 'bandpass', 640, 470, 3.5), at, g * 1.1)
  mix(a, biquad(voiced, 'bandpass', 1500, 1150, 4.5), at, g * 0.65)
  mix(a, biquad(noiseBurst({ dur: 0.1, attack: 0.006, decay: 0.06 }), 'bandpass', 1900, 1400, 2), at, g * 0.3)
  mix(a, osc({ f0: 190, f1: 120, dur: 0.13, attack: 0.008, decay: 0.09, gain: 0.5 }), at)
}
{
  const a = render(0.62)
  wuf(a, 0, 1); wuf(a, 0.27, 0.85)
  writeWav('bark', a)
}

// bite — jaw snap + short growl underneath
{
  const a = render(0.38)
  mix(a, biquad(noiseBurst({ dur: 0.03, decay: 0.015 }), 'highpass', 2800), 0, 0.9)
  mix(a, biquad(noiseBurst({ dur: 0.035, decay: 0.018 }), 'highpass', 2200), 0.055, 1)
  mix(a, osc({ f0: 330, f1: 170, dur: 0.09, decay: 0.05, gain: 0.6 }), 0.05)
  const growl = osc({ type: 'saw', f0: 95, f1: 70, dur: 0.32, attack: 0.02, decay: 0.24, gain: 1 })
  for (let i = 0; i < growl.length; i++) growl[i] *= 0.65 + 0.35 * Math.sin((2 * Math.PI * 27 * i) / SR) // AM rasp
  mix(a, biquad(growl, 'lowpass', 340), 0.03, 0.55)
  writeWav('bite', a)
}

// deploy — boots hit the grass: soft double thump, quietest raid sound
{
  const a = render(0.3)
  mix(a, biquad(noiseBurst({ dur: 0.09, decay: 0.05 }), 'lowpass', 520, 170), 0, 0.85)
  mix(a, biquad(noiseBurst({ dur: 0.09, decay: 0.05 }), 'lowpass', 460, 150), 0.09, 0.7)
  mix(a, osc({ f0: 135, f1: 70, dur: 0.12, decay: 0.08, gain: 0.5 }), 0.005)
  writeWav('deploy', a)
}

// win — full clear: rising major arpeggio into a held chord + sparkle
{
  const a = render(1.5)
  const N = [523.25, 659.25, 783.99, 1046.5]
  N.forEach((f, i) => {
    mix(a, osc({ type: 'tri', f0: f, dur: 0.45, attack: 0.008, decay: 0.3, gain: 0.8 }), i * 0.095)
    mix(a, osc({ f0: f * 2, dur: 0.3, decay: 0.2, gain: 0.18 }), i * 0.095)
  })
  for (const f of [523.25, 659.25, 783.99]) { // held resolve under the top note
    mix(a, osc({ type: 'tri', f0: f, dur: 1.0, attack: 0.01, decay: 0.75, gain: 0.5 }), 0.38)
  }
  mix(a, biquad(noiseBurst({ dur: 0.7, attack: 0.05, decay: 0.5 }), 'bandpass', 4200, 5200, 3), 0.38, 0.12)
  writeWav('win', a)
}

// lose — army spent, base still standing: two dull low horn notes, subdued not clownish
{
  const a = render(1.25)
  mix(a, biquad(osc({ type: 'saw', f0: 196, dur: 0.42, attack: 0.03, decay: 0.34, gain: 1 }), 'lowpass', 620), 0)
  mix(a, biquad(osc({ type: 'saw', f0: 155.6, dur: 0.6, attack: 0.03, decay: 0.45, gain: 1 }), 'lowpass', 540), 0.38)
  mix(a, osc({ f0: 98, f1: 62, dur: 0.5, decay: 0.35, gain: 0.5 }), 0.42)
  writeWav('lose', a)
}

// ── HOME ─────────────────────────────────────────────────────────────────────

// claim — FP/firecracker collected: three coin pings + glitter
{
  const a = render(0.6)
  ;[1568, 2093, 2637].forEach((f, i) => {
    mix(a, osc({ f0: f, dur: 0.32, decay: 0.16, gain: 0.85 }), i * 0.065)
    mix(a, osc({ f0: f * 1.99, dur: 0.18, decay: 0.09, gain: 0.2 }), i * 0.065)
  })
  mix(a, biquad(noiseBurst({ dur: 0.3, attack: 0.01, decay: 0.2 }), 'bandpass', 5200, 6200, 4), 0.05, 0.15)
  writeWav('claim', a)
}

// place — building bought: woody drop-thunk + a small confirming blip
{
  const a = render(0.45)
  mix(a, biquad(noiseBurst({ dur: 0.12, decay: 0.07 }), 'lowpass', 800, 200), 0, 0.95)
  mix(a, osc({ f0: 185, f1: 72, dur: 0.18, decay: 0.12, gain: 0.9 }), 0)
  mix(a, osc({ f0: 660, f1: 880, dur: 0.12, decay: 0.08, gain: 0.3 }), 0.16)
  writeWav('place', a)
}

// hammer — upgrade starts: two ringing metal taps
{
  const a = render(0.55)
  for (const [at, g] of [[0, 1], [0.22, 0.85]]) {
    mix(a, biquad(noiseBurst({ dur: 0.16, decay: 0.1 }), 'bandpass', 1850, 1750, 11), at, g)
    mix(a, osc({ f0: 340, f1: 190, dur: 0.09, decay: 0.05, gain: 0.55 }), at)
    mix(a, biquad(noiseBurst({ dur: 0.03, decay: 0.015 }), 'highpass', 3000), at, g * 0.4)
  }
  writeWav('hammer', a)
}

// done — upgrade/training finished: warm two-note completion chime
{
  const a = render(1.0)
  mix(a, osc({ type: 'tri', f0: 784, dur: 0.4, attack: 0.008, decay: 0.26, gain: 0.8 }), 0)
  mix(a, osc({ type: 'tri', f0: 1046.5, dur: 0.65, attack: 0.008, decay: 0.45, gain: 0.85 }), 0.17)
  mix(a, osc({ f0: 2093, dur: 0.4, decay: 0.25, gain: 0.14 }), 0.17)
  writeWav('done', a)
}

// ready — something is claimable: one soft glass ping (subtle by design)
{
  const a = render(0.4)
  mix(a, osc({ f0: 1174.7, dur: 0.34, attack: 0.004, decay: 0.2, gain: 0.8 }), 0)
  mix(a, osc({ f0: 2349.3, dur: 0.2, decay: 0.1, gain: 0.16 }), 0)
  writeWav('ready', a)
}

console.log('DONE')
