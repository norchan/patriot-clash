// Auto-scan the NEW Pic Hunt scenes for recolorable spots, then render a
// numbered-circle preview per scene for VISUAL review before baking.
// A candidate circle must (a) be genuinely colorful (mean chroma), (b) shift
// hard under a hue rotation (mean delta — the same QA the baker runs), and
// (c) contain real structure (pixel variance — flat colorful walls recolor
// into obvious smudges). Survivors are greedily picked non-overlapping.
// Usage: node scripts/gen_spotit_scan.mjs <scratchpad>/spotit
import sharp from 'sharp'
import fs from 'fs'

const DIR = process.argv[2]
if (!DIR) { console.error('pass the scene dir'); process.exit(1) }

const SCENES = ['bbq', 'tailgate', 'dock', 'fair', 'diner', 'parade', 'foodtruck', 'garagesale', 'bowling', 'toystore']
const R_TRY = [110, 95, 80, 68]
const MAX_SPOTS = 14
const MIN_GAP = 1.15 // circles may not overlap more than ~this factor of radii sum

function hueMatrix(deg) {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a)
  return [
    0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928,
    0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.140, 0.072 - c * 0.072 - s * 0.283,
    0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072,
  ]
}
const M = hueMatrix(120)

function scoreCircle(data, W, H, C, px, py, pr) {
  let n = 0, dsum = 0, csum = 0, lsum = 0, l2sum = 0
  for (let y = py - pr; y <= py + pr; y += 3) {
    for (let x = px - pr; x <= px + pr; x += 3) {
      if ((x - px) ** 2 + (y - py) ** 2 > pr * pr) continue
      const i = (y * W + x) * C
      const r = data[i], g = data[i + 1], b = data[i + 2]
      dsum += (Math.abs(r - (M[0] * r + M[1] * g + M[2] * b))
             + Math.abs(g - (M[3] * r + M[4] * g + M[5] * b))
             + Math.abs(b - (M[6] * r + M[7] * g + M[8] * b))) / 3
      csum += Math.max(r, g, b) - Math.min(r, g, b)
      const lum = 0.299 * r + 0.587 * g + 0.114 * b
      lsum += lum; l2sum += lum * lum
      n++
    }
  }
  if (!n) return null
  const variance = l2sum / n - (lsum / n) ** 2
  return { delta: dsum / n, chroma: csum / n, sd: Math.sqrt(variance) }
}

for (const id of SCENES) {
  const src = `${DIR}/${id}.png`
  const { data, info } = await sharp(src).raw().toBuffer({ resolveWithObject: true })
  const { width: W, height: H, channels: C } = info

  // scan a grid at multiple radii, keep scoring candidates
  const cands = []
  for (const pr of R_TRY) {
    const step = Math.round(pr * 0.55)
    for (let py = pr + 4; py < H - pr - 4; py += step) {
      for (let px = pr + 4; px < W - pr - 4; px += step) {
        const s = scoreCircle(data, W, H, C, px, py, pr)
        if (!s) continue
        if (s.delta < 20 || s.chroma < 30 || s.sd < 14) continue
        cands.push({ x: px, y: py, r: pr, score: s.delta * Math.min(1.5, s.sd / 25) })
      }
    }
  }
  cands.sort((a, b) => b.score - a.score)

  // greedy non-overlapping pick
  const picked = []
  for (const c of cands) {
    if (picked.length >= MAX_SPOTS) break
    if (picked.some(p => Math.hypot(p.x - c.x, p.y - c.y) < (p.r + c.r) / MIN_GAP)) continue
    picked.push(c)
  }

  // preview: downscale FIRST, then composite scaled circles (sharp requires
  // the overlay to fit the current canvas)
  const PW = 1000, sc = PW / W, PH = Math.round(H * sc)
  const svg = `<svg width="${PW}" height="${PH}" xmlns="http://www.w3.org/2000/svg">${picked
    .map((p, i) => `<circle cx="${p.x * sc}" cy="${p.y * sc}" r="${p.r * sc}" fill="none" stroke="red" stroke-width="5"/>
      <text x="${p.x * sc}" y="${p.y * sc + 10}" font-size="34" font-weight="bold" fill="yellow" text-anchor="middle" stroke="black" stroke-width="1.5">${i + 1}</text>`)
    .join('')}</svg>`
  const base = await sharp(src).resize(PW).toBuffer()
  await sharp(base).composite([{ input: Buffer.from(svg) }]).jpeg({ quality: 80 }).toFile(`${DIR}/${id}_preview.jpg`)

  fs.writeFileSync(`${DIR}/${id}_spots.json`, JSON.stringify(picked.map(p => [p.x, p.y, p.r])))
  console.log(`${id}: ${picked.length} spots (from ${cands.length} candidates)`)
}
console.log('previews written — review *_preview.jpg')
