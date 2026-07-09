// Builds the fighting-game sprite set from generated images.
// Reads scripts/sprite_jobs.json: { archetype: { pose: url } } (red originals
// on white backgrounds), then for each image:
//   1. flood-fill removes the white background (BFS from the borders)
//   2. de-halos the cut edge
//   3. crops to the character's bounding box
//   4. writes public/sprites/{arch}_red_{pose}.webp (height 512)
//   5. hue-shifts the red garments to blue → {arch}_blue_{pose}.webp
//
// Usage: node scripts/build_sprites.mjs
import sharp from 'sharp'
import fs from 'fs'

const jobs = JSON.parse(fs.readFileSync(new URL('./sprite_jobs.json', import.meta.url), 'utf8'))
fs.mkdirSync('public/sprites', { recursive: true })

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else h = ((r - g) / d + 4) / 6
  return [h * 360, s, l]
}

function hslToRgb(h, s, l) {
  h /= 360
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v] }
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ]
}

async function buildOne(name, url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${name}`)
  const input = Buffer.from(await res.arrayBuffer())

  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width: W, height: H } = info

  const isBg = i => {
    const r = data[i], g = data[i + 1], b = data[i + 2]
    return r > 232 && g > 232 && b > 232 && Math.max(r, g, b) - Math.min(r, g, b) < 22
  }

  // BFS from every border pixel — only background CONNECTED to the border is
  // removed, so white shirts/eyes inside the character survive
  const visited = new Uint8Array(W * H)
  const queue = []
  for (let x = 0; x < W; x++) { queue.push(x, (H - 1) * W + x) }
  for (let y = 0; y < H; y++) { queue.push(y * W, y * W + W - 1) }
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

  // De-halo: near-white opaque pixels touching transparency get feathered out
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const p = y * W + x, i = p * 4
      if (data[i + 3] === 0) continue
      const r = data[i], g = data[i + 1], b = data[i + 2]
      if (r > 222 && g > 222 && b > 222) {
        const nbTransparent =
          (data[(p - 1) * 4 + 3] === 0 ? 1 : 0) + (data[(p + 1) * 4 + 3] === 0 ? 1 : 0) +
          (data[(p - W) * 4 + 3] === 0 ? 1 : 0) + (data[(p + W) * 4 + 3] === 0 ? 1 : 0)
        if (nbTransparent >= 1) data[i + 3] = Math.round(data[i + 3] * (nbTransparent >= 3 ? 0.1 : 0.45))
      }
    }
  }

  // Bounding box of visible pixels
  let minX = W, minY = H, maxX = 0, maxY = 0
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (data[(y * W + x) * 4 + 3] > 12) {
      if (x < minX) minX = x; if (x > maxX) maxX = x
      if (y < minY) minY = y; if (y > maxY) maxY = y
    }
  }
  if (minX >= maxX || minY >= maxY) throw new Error(`empty cutout for ${name}`)
  const pad = 6
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad)
  maxX = Math.min(W - 1, maxX + pad); maxY = Math.min(H - 1, maxY + pad)

  const cut = (buf) => sharp(buf, { raw: { width: W, height: H, channels: 4 } })
    .extract({ left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 })
    .resize({ height: 512, fit: 'inside' })
    .webp({ quality: 88 })

  await cut(Buffer.from(data)).toFile(`public/sprites/${name.replace('_COLOR_', '_red_')}.webp`)

  // Blue variant: shift saturated red hues to blue, leave skin/gold/black alone
  const blue = Buffer.from(data)
  for (let p = 0; p < W * H; p++) {
    const i = p * 4
    if (blue[i + 3] === 0) continue
    const [h, s, l] = rgbToHsl(blue[i], blue[i + 1], blue[i + 2])
    const dHue = h > 180 ? h - 360 : h // signed distance from pure red
    // Garment red sits at hue ~350-10 with high saturation; skin tones sit at
    // hue ~15-32 — the band must stop short of them
    if (s > 0.42 && dHue >= -30 && dHue <= 12 && l > 0.06 && l < 0.94) {
      const [nr, ng, nb] = hslToRgb(225 + dHue * 0.6, Math.min(1, s * 1.02), l)
      blue[i] = nr; blue[i + 1] = ng; blue[i + 2] = nb
    }
  }
  await cut(blue).toFile(`public/sprites/${name.replace('_COLOR_', '_blue_')}.webp`)
}

let done = 0, failed = 0
for (const [arch, poses] of Object.entries(jobs)) {
  for (const [pose, url] of Object.entries(poses)) {
    try {
      await buildOne(`${arch}_COLOR_${pose}`, url)
      done++
      console.log(`ok  ${arch}/${pose}`)
    } catch (e) {
      failed++
      console.log(`FAIL ${arch}/${pose}: ${e.message}`)
    }
  }
}
console.log(`sprites built: ${done * 2} files (${done} poses x 2 colors), failures: ${failed}`)
