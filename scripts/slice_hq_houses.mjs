// Slice Michael's 5-level HQ house sheet into game-ready cutouts.
//
// The sheet arrives as a JPG, so the transparency checkerboard is BAKED IN as
// pixels. Recovery: blank the numbered badges, crop each house, then flood-fill
// from the crop's borders eating neutral bright pixels (the checker is white +
// light gray, both unsaturated; the houses are colorful or warm cream, so the
// fill stops at their outlines. Same idea as build_sprites.mjs' white-bg cut).
//
//   node scripts/slice_hq_houses.mjs <sheet.jpg> [outPrefix]
// → public/house/<prefix>1.png .. <prefix>5.png   (prefix defaults to "hq";
//   Michael's sheets share the same 5-slot layout, so the safe sheet and any
//   future building sheet slice with the same boxes)
import sharp from 'sharp'
import fs from 'fs'

const src = process.argv[2]
const prefix = process.argv[3] || 'hq'
// --no-badges: sheet has no number badges (blanking would bite into art that
// extends where the house sheet's badges sat). Also tightens slot 5's crop —
// the badge-free sheets pack the pieces closer and slot 5 was catching its
// neighbor's corner.
const noBadges = process.argv.includes('--no-badges')
if (!src || !fs.existsSync(src)) { console.error('usage: node scripts/slice_hq_houses.mjs <sheet> [outPrefix]'); process.exit(1) }

const BADGES = [ // fractions of the full sheet — gold number hexagons to erase
  [0.035, 0.025, 0.150, 0.095], [0.525, 0.025, 0.640, 0.095],
  [0.035, 0.340, 0.150, 0.410], [0.525, 0.340, 0.650, 0.410],
  [0.265, 0.650, 0.380, 0.720],
]
const HOUSES = [ // crop box per level
  [0.02, 0.02, 0.52, 0.30], [0.52, 0.02, 1.00, 0.30],
  [0.02, 0.33, 0.52, 0.62], [0.52, 0.33, 1.00, 0.62],
  [0.24, 0.62, 0.80, 1.00],
]
if (noBadges) HOUSES[4] = [0.28, 0.665, 0.76, 1.00]

const img = sharp(src)
const meta = await img.metadata()
const W = meta.width, H = meta.height
console.log(`sheet ${W}x${H}`)

// blank the badges with white so the flood fill eats them like background
const patches = BADGES.map(([x0, y0, x1, y1]) => ({
  input: { create: { width: Math.round((x1 - x0) * W), height: Math.round((y1 - y0) * H), channels: 3, background: '#ffffff' } },
  left: Math.round(x0 * W), top: Math.round(y0 * H),
}))
const clean = noBadges ? await img.png().toBuffer() : await img.composite(patches).png().toBuffer()

fs.mkdirSync('public/house', { recursive: true })

for (let i = 0; i < HOUSES.length; i++) {
  const [x0, y0, x1, y1] = HOUSES[i]
  const left = Math.round(x0 * W), top = Math.round(y0 * H)
  const cw = Math.round((x1 - x0) * W), ch = Math.round((y1 - y0) * H)
  const { data, info } = await sharp(clean)
    .extract({ left, top, width: cw, height: ch })
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true })

  const { width: w, height: h } = info
  const px = (x, y) => (y * w + x) * 4
  // background = unsaturated and bright (checker white/gray + jpg noise)
  const isBg = (x, y) => {
    const i4 = px(x, y), r = data[i4], g = data[i4 + 1], b = data[i4 + 2]
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
    return mx - mn < 26 && mn > 150
  }
  // flood fill from every border pixel
  const seen = new Uint8Array(w * h)
  const stack = []
  for (let x = 0; x < w; x++) { stack.push([x, 0], [x, h - 1]) }
  for (let y = 0; y < h; y++) { stack.push([0, y], [w - 1, y]) }
  while (stack.length) {
    const [x, y] = stack.pop()
    if (x < 0 || y < 0 || x >= w || y >= h) continue
    const idx = y * w + x
    if (seen[idx]) continue
    seen[idx] = 1
    if (!isBg(x, y)) continue
    data[px(x, y) + 3] = 0 // transparent
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1])
  }
  const out = `public/house/${prefix}${i + 1}.png`
  await sharp(Buffer.from(data), { raw: { width: w, height: h, channels: 4 } })
    .trim({ threshold: 8 })
    .resize({ width: 460, height: 460, fit: 'inside' })
    .png({ compressionLevel: 9 })
    .toFile(out)
  console.log(`✔ ${out} (${Math.round(fs.statSync(out).size / 1024)} KB)`)
}
console.log('done — eyeball each cutout before shipping')
