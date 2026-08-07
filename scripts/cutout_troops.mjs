// Adaptive background removal for troop sprites (2026-08-04). The house
// slicer's flood-fill eats only NEUTRAL-BRIGHT pixels — gpt-image-1 ignored
// the gray-background instruction on most troops and painted parchment/dark
// texture instead. This fill is seeded from the actual border: it averages the
// border color and eats connected pixels within tolerance of it, so whatever
// backdrop the model picked, it disappears — the dark character outlines stop
// the spread.
//
//   node scripts/cutout_troops.mjs <in.png> <out.png> [tolerance=58]
import sharp from 'sharp'

const [src, out, tolArg] = process.argv.slice(2)
if (!src || !out) { console.error('usage: node scripts/cutout_troops.mjs <in> <out> [tol]'); process.exit(1) }
const TOL = Number(tolArg) || 58

const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const { width: W, height: H } = info
const px = (x, y) => (y * W + x) * 4

// average border color = the backdrop
let r = 0, g = 0, b = 0, n = 0
for (let x = 0; x < W; x++) for (const y of [0, H - 1]) { const i = px(x, y); r += data[i]; g += data[i + 1]; b += data[i + 2]; n++ }
for (let y = 0; y < H; y++) for (const x of [0, W - 1]) { const i = px(x, y); r += data[i]; g += data[i + 1]; b += data[i + 2]; n++ }
r /= n; g /= n; b /= n

const near = i => {
  const dr = data[i] - r, dg = data[i + 1] - g, db = data[i + 2] - b
  return Math.sqrt(dr * dr + dg * dg + db * db) < TOL
}

// BFS from every border pixel that matches the backdrop
const seen = new Uint8Array(W * H)
const q = []
for (let x = 0; x < W; x++) for (const y of [0, H - 1]) if (near(px(x, y))) { q.push(x, y); seen[y * W + x] = 1 }
for (let y = 0; y < H; y++) for (const x of [0, W - 1]) if (near(px(x, y)) && !seen[y * W + x]) { q.push(x, y); seen[y * W + x] = 1 }
while (q.length) {
  const y = q.pop(), x = q.pop()
  data[px(x, y) + 3] = 0
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx, ny = y + dy
    if (nx < 0 || ny < 0 || nx >= W || ny >= H || seen[ny * W + nx]) continue
    if (near(px(nx, ny))) { seen[ny * W + nx] = 1; q.push(nx, ny) }
  }
}

// soften the cut edge: any opaque pixel touching a cleared one gets feathered
const alpha = new Uint8Array(W * H)
for (let i = 0; i < W * H; i++) alpha[i] = data[i * 4 + 3]
for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
  const i = y * W + x
  if (alpha[i] === 0) continue
  let clear = 0
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (alpha[(y + dy) * W + (x + dx)] === 0) clear++
  if (clear > 0) data[i * 4 + 3] = Math.round(alpha[i] * (1 - clear * 0.22))
}

await sharp(data, { raw: { width: W, height: H, channels: 4 } }).trim().png().toFile(out)
const meta = await sharp(out).metadata()
console.log(`✔ ${out} (${meta.width}x${meta.height})`)
