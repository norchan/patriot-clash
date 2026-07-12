// Cutouts for the new Republican sprites (user-supplied art). Detects the
// border background (white and/or checkerboard) by sampling, flood-fills it
// away, de-halos, crops, resizes to match the existing roster (~900px tall).
//
// Usage: node scripts/build_new_sprites.mjs
import sharp from 'sharp'

const SCRATCH = 'C:/Users/Micha/AppData/Local/Temp/claude/c--Users-Micha-patriot-clash/acd84d08-0df9-435a-8904-192f5d4e95a8/scratchpad'
const JOBS = [
  { src: `${SCRATCH}/sprite_ice.png`,     out: 'public/enemies/republican/ice_agent.png' },
  { src: `${SCRATCH}/sprite_hick.png`,    out: 'public/enemies/republican/hick.png' },
  { src: `${SCRATCH}/sprite_preppy.png`,  out: 'public/enemies/republican/preppy.png' },
  { src: `${SCRATCH}/sprite_soldier.png`, out: 'public/enemies/republican/soldier_boy.png' },
]

async function buildOne(job) {
  const { data, info } = await sharp(job.src).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width: W, height: H } = info

  // If the image already has real transparency, respect it and just crop
  let transparentBorder = 0, borderCount = 0
  const sampleBorder = []
  for (let x = 0; x < W; x += 3) {
    for (const y of [0, 1, H - 2, H - 1]) {
      const i = (y * W + x) * 4
      borderCount++
      if (data[i + 3] < 10) transparentBorder++
      else sampleBorder.push([data[i], data[i + 1], data[i + 2]])
    }
  }
  for (let y = 0; y < H; y += 3) {
    for (const x of [0, 1, W - 2, W - 1]) {
      const i = (y * W + x) * 4
      borderCount++
      if (data[i + 3] < 10) transparentBorder++
      else sampleBorder.push([data[i], data[i + 1], data[i + 2]])
    }
  }
  const alreadyTransparent = transparentBorder / borderCount > 0.6

  if (!alreadyTransparent) {
    // Background (white and/or checkerboard) = bright neutral pixels.
    // Character colors survive: camo/khaki/denim all carry saturation or
    // sit below the luminance floor; interior whites (text, shirt collars)
    // are safe because the flood only spreads from the borders.
    const isBg = i => {
      const r = data[i], g = data[i + 1], b = data[i + 2]
      return Math.max(r, g, b) - Math.min(r, g, b) < 16 && (r + g + b) / 3 > 193
    }

    const visited = new Uint8Array(W * H)
    const queue = []
    for (let x = 0; x < W; x++) queue.push(x, (H - 1) * W + x)
    for (let y = 0; y < H; y++) queue.push(y * W, y * W + W - 1)
    while (queue.length) {
      const p = queue.pop()
      if (visited[p]) continue
      visited[p] = 1
      if (!isBg(p * 4)) continue
      data[p * 4 + 3] = 0
      const x = p % W, y = (p / W) | 0
      if (x > 0) queue.push(p - 1)
      if (x < W - 1) queue.push(p + 1)
      if (y > 0) queue.push(p - W)
      if (y < H - 1) queue.push(p + W)
    }
    // de-halo
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const p = y * W + x, i = p * 4
      if (data[i + 3] === 0) continue
      if (isBg(i)) {
        const nb = (data[(p - 1) * 4 + 3] === 0 ? 1 : 0) + (data[(p + 1) * 4 + 3] === 0 ? 1 : 0) +
                   (data[(p - W) * 4 + 3] === 0 ? 1 : 0) + (data[(p + W) * 4 + 3] === 0 ? 1 : 0)
        if (nb >= 1) data[i + 3] = Math.round(data[i + 3] * (nb >= 3 ? 0.1 : 0.45))
      }
    }
  }

  let minX = W, minY = H, maxX = 0, maxY = 0
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (data[(y * W + x) * 4 + 3] > 12) {
      if (x < minX) minX = x; if (x > maxX) maxX = x
      if (y < minY) minY = y; if (y > maxY) maxY = y
    }
  }
  const pad = 4
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad)
  maxX = Math.min(W - 1, maxX + pad); maxY = Math.min(H - 1, maxY + pad)

  await sharp(Buffer.from(data), { raw: { width: W, height: H, channels: 4 } })
    .extract({ left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 })
    .resize({ height: 900, fit: 'inside' })
    .png()
    .toFile(job.out)
  console.log(`ok ${job.out}`)
}

for (const j of JOBS) await buildOne(j)
console.log('done')
