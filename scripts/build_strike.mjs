// Builds the siege special-attack sprites + extra ninja frames: downloads
// the generated art, flood-fills away the white background, writes
// transparent PNGs. Usage: node scripts/build_strike.mjs
import sharp from 'sharp'

const P = 'https://d8j0ntlcm91z4.cloudfront.net/user_3E3whk5P4Mu7JUJbag6TAxM80e7'
const SOURCES = {
  'siege/poor_run1':    { url: `${P}/hf_20260711_054138_eb48e796-526d-4198-b8f6-a668bde2ade9.png`, h: 300 },
  'siege/poor_run2':    { url: `${P}/hf_20260711_054139_50050f36-cc4d-4e0b-aaef-dfca196317fc.png`, h: 300 },
  'siege/poor_atk':     { url: `${P}/hf_20260711_054140_f7cbd2cd-1965-4487-b2cf-ee31ea280d82.png`, h: 300 },
  'siege/crowd':        { url: `${P}/hf_20260711_054142_1f3e4446-cb6d-4ef1-8b6e-9567b8ada6c7.png`, h: 420 },
  'siege/pitchfork':    { url: `${P}/hf_20260711_054151_106c383d-4e94-4299-aee4-262d1aa2e579.png`, h: 220 },
  'siege/eagle1':       { url: `${P}/hf_20260711_054153_3a3261ce-0fb2-476e-85e7-ae36c2a6946a.png`, h: 260 },
  'siege/eagle2':       { url: `${P}/hf_20260711_054155_59907c6f-6614-4c4f-890c-cd0126950945.png`, h: 260 },
  'siege/missile':      { url: `${P}/hf_20260711_054156_ba5053db-387c-4024-9772-f7207ddd3189.png`, h: 300 },
  'siege/statue':       { url: `${P}/hf_20260711_054205_9d1308d1-a209-4701-a864-95b8742c6294.png`, h: 460 },
  'halls/soldier_run3': { url: `${P}/hf_20260711_054208_303df0fc-4460-45aa-98ee-b883a5a9fe8c.png`, h: 300 },
  'halls/soldier_atk3': { url: `${P}/hf_20260711_054211_77960fce-5a62-4354-a45f-ce0fb6fe61a5.png`, h: 300 },
}

async function buildOne(key, { url, h }) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${key}`)
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
    .resize({ height: h, fit: 'inside' })
    .png()
    .toFile(`public/${key}.png`)
  console.log(`ok ${key}`)
}

for (const [key, src] of Object.entries(SOURCES)) await buildOne(key, src)
console.log('done')
