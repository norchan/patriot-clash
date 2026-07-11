// Builds the comic OUCH variants for every battle enemy: downloads the
// generated images, flood-fills away the white background, and writes
// public/enemies/{party}/{id}_ouch.png next to the base cutouts.
//
// Usage: node scripts/build_ouch.mjs
import sharp from 'sharp'
import fs from 'fs'

const P = 'https://d8j0ntlcm91z4.cloudfront.net/user_3E3whk5P4Mu7JUJbag6TAxM80e7'
const SOURCES = {
  'republican/cowboy':          `${P}/hf_20260711_033716_7167f4ed-99f8-4644-8c0b-c073aa3ce4f2.png`,
  'republican/eagle':           `${P}/hf_20260711_033717_3d7a6d5d-abcd-4b3c-a655-59608be2fb30.png`,
  'republican/hick':            `${P}/hf_20260711_033718_7c6a1a54-b839-478e-a328-0f2ca5496223.png`,
  'republican/oil_baron':       `${P}/hf_20260711_033720_bafa631a-555d-48c2-bd3e-ffcbfb70ab49.png`,
  'republican/politician':      `${P}/hf_20260711_033722_a1059e8a-dbc4-4279-93c9-ceb5cf304459.png`,
  'democrat/crazy_liberal':     `${P}/hf_20260711_033734_8cc6ff29-789d-4d2c-8590-43163e6a70d2.png`,
  'democrat/crying_liberal':    `${P}/hf_20260711_033737_e0f8c72c-8a5f-41ea-89a4-6a611207183a.png`,
  'democrat/politician_dems':   `${P}/hf_20260711_033742_221c7cfd-5d05-4c69-9068-41ea9b059aca.png`,
  'democrat/protestor':         `${P}/hf_20260711_033744_e01b29ee-4889-4125-b718-e0601c3baa10.png`,
  'democrat/purple_hair':       `${P}/hf_20260711_033745_c98e541b-90d6-47ce-9979-608fe037c3d5.png`,
}

async function buildOne(key, url) {
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
  const pad = 6
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad)
  maxX = Math.min(W - 1, maxX + pad); maxY = Math.min(H - 1, maxY + pad)

  await sharp(Buffer.from(data), { raw: { width: W, height: H, channels: 4 } })
    .extract({ left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 })
    .resize({ height: 512, fit: 'inside' })
    .png()
    .toFile(`public/enemies/${key}_ouch.png`)
  console.log(`ok ${key}_ouch`)
}

for (const [key, url] of Object.entries(SOURCES)) await buildOne(key, url)
console.log('done')
