// Builds the siege-mode town hall images: downloads the three generated
// damage stages, flood-fills away the white background, crops, and writes
// public/halls/hall_{stage}.webp.
//
// Usage: node scripts/build_hall.mjs
import sharp from 'sharp'
import fs from 'fs'

const SOURCES = {
  intact: 'https://d8j0ntlcm91z4.cloudfront.net/user_3E3whk5P4Mu7JUJbag6TAxM80e7/hf_20260709_183026_66172828-2a0b-4599-96c5-35904a60a355.png',
  damaged: 'https://d8j0ntlcm91z4.cloudfront.net/user_3E3whk5P4Mu7JUJbag6TAxM80e7/hf_20260709_184415_ef9680f5-0819-4afd-a48d-c9e64305c93f.png',
  wrecked: 'https://d8j0ntlcm91z4.cloudfront.net/user_3E3whk5P4Mu7JUJbag6TAxM80e7/hf_20260709_184416_ed4e5354-4b9a-45e8-968c-c6fe27f8e444.png',
}

fs.mkdirSync('public/halls', { recursive: true })

async function buildOne(name, url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const input = Buffer.from(await res.arrayBuffer())
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width: W, height: H } = info

  const isBg = i => {
    const r = data[i], g = data[i + 1], b = data[i + 2]
    return r > 230 && g > 230 && b > 230 && Math.max(r, g, b) - Math.min(r, g, b) < 24
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

  // De-halo the cut edge
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const p = y * W + x, i = p * 4
    if (data[i + 3] === 0) continue
    if (data[i] > 220 && data[i + 1] > 220 && data[i + 2] > 220) {
      const nb = (data[(p - 1) * 4 + 3] === 0 ? 1 : 0) + (data[(p + 1) * 4 + 3] === 0 ? 1 : 0) +
                 (data[(p - W) * 4 + 3] === 0 ? 1 : 0) + (data[(p + W) * 4 + 3] === 0 ? 1 : 0)
      if (nb >= 1) data[i + 3] = Math.round(data[i + 3] * (nb >= 3 ? 0.1 : 0.45))
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
    .resize({ height: 720, fit: 'inside' })
    .webp({ quality: 86 })
    .toFile(`public/halls/hall_${name}.webp`)
  console.log(`ok hall_${name}`)
}

for (const [name, url] of Object.entries(SOURCES)) await buildOne(name, url)
console.log('done')
