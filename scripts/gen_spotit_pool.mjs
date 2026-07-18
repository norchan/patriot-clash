// Build the RANDOMIZED difference pool for Barroom Eyes — HAND-CURATED spots.
// Auto-scanning failed on warm photos: high-chroma lamplight on wood counts as
// "colorful", and hue-rotating a glow paints a smudge, not a recolored object.
// So every pool spot below was placed BY HAND on a discrete object (viewed on
// the actual image), then machine-verified: a spot must produce a strong pixel
// change (delta) on a sufficiently colorful surface (chroma) or it's dropped
// with a warning. The game picks 6 random spots + random hue angles per round.
// Coordinates are in ORIGINAL source pixels (sw × sh); output is normalized.
// Usage: node scripts/gen_spotit_pool.mjs
import sharp from 'sharp'
import fs from 'fs'

const MIN_DELTA = 15
const MIN_CHROMA = 22

// [x, y, r] in source px
const HAND = {
  bar: { sw: 1200, sh: 896, label: 'The Dive Bar', spots: [
    [133, 57, 42], [912, 320, 80], [872, 428, 34], [778, 550, 27], [1095, 245, 52], [505, 545, 40],
    [270, 160, 45], [480, 110, 55], [700, 160, 45], [665, 520, 45], [770, 650, 50], [95, 745, 45],
    [60, 330, 55], [1145, 340, 45],
  ]},
  rally: { sw: 1200, sh: 896, label: 'Rally Day', spots: [
    [118, 268, 60], [280, 163, 60], [1048, 466, 52], [113, 612, 62], [255, 793, 34],
    [500, 430, 55], [75, 185, 55], [735, 105, 50], [745, 255, 40], [105, 725, 55],
    [135, 405, 40], [185, 688, 40], [1105, 455, 55], [640, 545, 45],
  ]},
  pub: { sw: 1200, sh: 896, label: 'The Corner Pub', spots: [
    [728, 305, 58], [975, 205, 52], [1148, 468, 52], [636, 462, 38], [372, 585, 52], [748, 700, 58],
    [75, 470, 60], [545, 505, 38], [285, 250, 45], [300, 390, 45], [880, 585, 45], [615, 140, 40],
  ]},
  market: { sw: 1200, sh: 896, label: 'Farmers Market', spots: [
    [855, 330, 72], [415, 578, 55], [832, 560, 62], [285, 793, 64], [495, 152, 38], [800, 722, 55],
    [270, 565, 50], [640, 570, 45], [535, 570, 45], [380, 380, 50], [135, 110, 40], [325, 120, 40],
    [240, 55, 55], [95, 720, 60], [1105, 570, 45], [130, 455, 45], [455, 765, 45],
  ]},
  photodiner: { sw: 1200, sh: 896, label: 'The Chrome Counter', spots: [
    [230, 300, 85], [105, 390, 42], [865, 140, 50], [450, 398, 50], [752, 388, 30], [740, 775, 78],
    [540, 105, 52], [700, 445, 45], [595, 465, 45], [940, 690, 60], [1060, 610, 50], [340, 790, 70],
    [330, 375, 40], [1120, 390, 55], [950, 330, 35],
  ]},
  diner: { sw: 578, sh: 758, label: 'Rollerskate Diner', spots: [
    [460, 70, 38], [212, 318, 40], [69, 220, 52], [374, 262, 30], [529, 105, 38], [517, 570, 40],
    [196, 202, 50], [150, 545, 45], [310, 470, 35], [390, 680, 40], [145, 635, 35], [185, 45, 45], [95, 700, 45],
  ]},
}

function hueMatrix(deg) {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a)
  return [
    0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928,
    0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.140, 0.072 - c * 0.072 - s * 0.283,
    0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072,
  ]
}

const out = []
for (const [id, def] of Object.entries(HAND)) {
  const { data, info } = await sharp(`public/spotit/${id}_a.jpg`).raw().toBuffer({ resolveWithObject: true })
  const { width: W, height: H, channels: C } = info
  const M = hueMatrix(120)
  const kept = []
  for (const [sx, sy, sr] of def.spots) {
    // normalized → jpg pixel space
    const nx = sx / def.sw, ny = sy / def.sh, nr = sr / def.sw
    const px = Math.round(nx * W), py = Math.round(ny * H), pr = Math.round(nr * W)
    if (px - pr < 0 || py - pr < 0 || px + pr >= W || py + pr >= H) {
      console.log(`  DROP ${id} [${sx},${sy}] — clips the edge`); continue
    }
    let dsum = 0, csum = 0, n = 0
    for (let y = py - pr; y <= py + pr; y += 2) {
      for (let x = px - pr; x <= px + pr; x += 2) {
        if ((x - px) ** 2 + (y - py) ** 2 > pr * pr) continue
        const i = (y * W + x) * C
        const r = data[i], g = data[i + 1], b = data[i + 2]
        dsum += (Math.abs(r - (M[0] * r + M[1] * g + M[2] * b))
               + Math.abs(g - (M[3] * r + M[4] * g + M[5] * b))
               + Math.abs(b - (M[6] * r + M[7] * g + M[8] * b))) / 3
        csum += Math.max(r, g, b) - Math.min(r, g, b)
        n++
      }
    }
    const delta = dsum / n, chroma = csum / n
    if (delta < MIN_DELTA || chroma < MIN_CHROMA) {
      console.log(`  DROP ${id} [${sx},${sy}] — delta ${delta.toFixed(0)} chroma ${chroma.toFixed(0)} (too dull, would smudge)`)
      continue
    }
    kept.push({ x: +nx.toFixed(4), y: +ny.toFixed(4), r: +nr.toFixed(4) })
  }
  out.push({ id, label: def.label, w: W, h: H, pool: kept })
  console.log(`${id}: ${kept.length}/${def.spots.length} hand spots verified`)
}
fs.writeFileSync('config/spotit-pool.json', JSON.stringify(out, null, 1))
console.log('DONE → config/spotit-pool.json')
