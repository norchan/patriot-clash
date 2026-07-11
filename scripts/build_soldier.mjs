// Builds the siege soldier animation frames: downloads the generated
// full-body ninja poses, flood-fills away the white background, and writes
// transparent PNGs to public/halls/soldier_{run1,run2,atk1,atk2}.png.
//
// Usage: node scripts/build_soldier.mjs
import sharp from 'sharp'

const P = 'https://d8j0ntlcm91z4.cloudfront.net/user_3E3whk5P4Mu7JUJbag6TAxM80e7'
const SOURCES = {
  soldier_run1: `${P}/hf_20260711_050604_85d5872f-ed8f-46df-897e-fb3674c7267a.png`,
  soldier_run2: `${P}/hf_20260711_050613_6e2cba16-457f-4e00-99c1-571f4a696140.png`,
  soldier_atk1: `${P}/hf_20260711_050620_5cb5ce61-07b7-4876-ba07-cf10a0801f87.png`,
  soldier_atk2: `${P}/hf_20260711_050621_f80e557c-ba04-475f-b07f-a9b59dd7d7c2.png`,
}

async function buildOne(name, url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const input = Buffer.from(await res.arrayBuffer())
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width: W, height: H } = info

  const isBg = i => {
    const r = data[i], g = data[i + 1], b = data[i + 2]
    return r > 228 && g > 228 && b > 228 && Math.max(r, g, b) - Math.min(r, g, b) < 14
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
    .resize({ height: 300, fit: 'inside' })
    .png()
    .toFile(`public/halls/${name}.png`)
  console.log(`ok ${name}`)
}

for (const [name, url] of Object.entries(SOURCES)) await buildOne(name, url)
console.log('done')
