// Build the RANDOMIZED difference pool for Barroom Eyes. For each scene base
// image (public/spotit/<id>_a.jpg) it scans a grid of candidate circles and
// scores how VISIBLE a hue-shift would be there (mean |original - hue-rotated|
// per pixel). High-scoring, mutually non-overlapping circles go into the pool;
// the game picks 6 at random each round and paints them client-side, so every
// round has different differences. Output: config/spotit-pool.json
// Usage: node scripts/gen_spotit_pool.mjs
import sharp from 'sharp'
import fs from 'fs'

const SCENES = JSON.parse(fs.readFileSync('config/spotit.json', 'utf8'))
const MIN_SCORE = 45   // mean RGB delta a circle must produce to count as findable
const MIN_CHROMA = 42  // mean saturation floor — recolors on dull surfaces read
                       // as smudgy "marks", not as a different-colored object
const MAX_POOL = 40    // cap per scene
const RADII = [42, 56]
const STEP = 36        // grid step for candidate centers

// standard feColorMatrix hueRotate coefficients
function hueMatrix(deg) {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a)
  return [
    0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928,
    0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.140, 0.072 - c * 0.072 - s * 0.283,
    0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072,
  ]
}

const out = []
for (const scene of SCENES) {
  const { data, info } = await sharp(`public/spotit/${scene.id}_a.jpg`).raw().toBuffer({ resolveWithObject: true })
  const { width: W, height: H, channels: C } = info
  const M = hueMatrix(120)
  // precompute per-pixel hue-shift delta AND chroma (saturation)
  const delta = new Float32Array(W * H)
  const chroma = new Float32Array(W * H)
  for (let i = 0, p = 0; p < W * H; p++, i += C) {
    const r = data[i], g = data[i + 1], b = data[i + 2]
    const nr = M[0] * r + M[1] * g + M[2] * b
    const ng = M[3] * r + M[4] * g + M[5] * b
    const nb = M[6] * r + M[7] * g + M[8] * b
    delta[p] = (Math.abs(r - nr) + Math.abs(g - ng) + Math.abs(b - nb)) / 3
    chroma[p] = Math.max(r, g, b) - Math.min(r, g, b)
  }
  // score candidate circles — need BOTH a strong shift and a colorful surface
  const cands = []
  for (const r of RADII) {
    for (let cy = r + 8; cy < H - r - 8; cy += STEP) {
      for (let cx = r + 8; cx < W - r - 8; cx += STEP) {
        let sum = 0, csum = 0, n = 0
        for (let y = cy - r; y <= cy + r; y += 3) {
          for (let x = cx - r; x <= cx + r; x += 3) {
            if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue
            const p = y * W + x
            sum += delta[p]; csum += chroma[p]; n++
          }
        }
        const score = sum / n, mchroma = csum / n
        if (score >= MIN_SCORE && mchroma >= MIN_CHROMA) cands.push({ x: cx, y: cy, r, score })
      }
    }
  }
  // greedy non-overlapping pick, best first
  cands.sort((a, b) => b.score - a.score)
  const picked = []
  for (const c of cands) {
    if (picked.length >= MAX_POOL) break
    if (picked.every(p => Math.hypot(p.x - c.x, p.y - c.y) > (p.r + c.r) * 0.95)) picked.push(c)
  }
  out.push({
    id: scene.id, label: scene.label, w: W, h: H,
    pool: picked.map(p => ({ x: +(p.x / W).toFixed(4), y: +(p.y / H).toFixed(4), r: +(p.r / W).toFixed(4) })),
  })
  console.log(`${scene.id}: ${cands.length} candidates → pool of ${picked.length} (best score ${cands[0]?.score.toFixed(0) ?? '-'}, cutoff ${MIN_SCORE})`)
}
fs.writeFileSync('config/spotit-pool.json', JSON.stringify(out, null, 1))
console.log('DONE → config/spotit-pool.json')
