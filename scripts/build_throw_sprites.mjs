// Cut out the stylized wind-up (base) + release (_throw) frames for the 10
// redrawn enemy sprites. White-bg flood-fill (clean cel-shaded art).
import sharp from 'sharp'

const P = 'https://d8j0ntlcm91z4.cloudfront.net/user_3E3whk5P4Mu7JUJbag6TAxM80e7'
const JOBS = [
  // [url, outPath]
  // ── wind-ups → base images (overwrite the photoreal cutouts) ──
  [`${P}/hf_20260712_041621_d6b3eb92-0e54-4904-86b4-6761c7a9c011.png`, 'enemies/republican/ice_agent'],
  [`${P}/hf_20260712_041623_d333fd85-2427-46c7-ba2b-d868dbeba81b.png`, 'enemies/republican/soldier_boy'],
  [`${P}/hf_20260712_041626_6e23b156-7a39-4057-8256-568f954c404b.png`, 'enemies/republican/preppy'],
  [`${P}/hf_20260712_041629_1ecdf666-1683-47cb-8a9c-f6c8c1aea51d.png`, 'enemies/republican/influencer'],
  [`${P}/hf_20260712_041632_1b34171b-0e7e-480d-bae9-1fbf617311a4.png`, 'enemies/republican/billionaire'],
  [`${P}/hf_20260712_041648_7303c00e-54b5-4817-83e0-dd5bbd5e1176.png`, 'enemies/democrat/palestine'],
  [`${P}/hf_20260712_041655_6f7cc1c7-566f-4153-8469-7985de3d5615.png`, 'enemies/democrat/drag'],
  [`${P}/hf_20260712_042033_f70ffa3e-eb67-4d29-8f4e-3aff579daec0.png`, 'enemies/democrat/anchor'],
  [`${P}/hf_20260712_042036_ceaf0ddb-cff6-4f08-a0a5-4125bd86dcd7.png`, 'enemies/democrat/comrade'],
  [`${P}/hf_20260712_042038_bd36ab73-9cf8-4f67-a2ed-78dc1423492e.png`, 'enemies/democrat/senator'],
  // ── releases → _throw ──
  [`${P}/hf_20260712_042101_ef8a18a5-212f-476c-9e78-9f2f9a067a5b.png`, 'enemies/republican/ice_agent_throw'],
  [`${P}/hf_20260712_042104_2d212713-98fa-40f7-82da-1dbcb648c942.png`, 'enemies/republican/soldier_boy_throw'],
  [`${P}/hf_20260712_042107_760b7b11-29b5-4261-b186-db7f41b8f6fb.png`, 'enemies/republican/preppy_throw'],
  [`${P}/hf_20260712_042111_94562fe5-398c-4b1f-9c80-c7dabd7da4ac.png`, 'enemies/republican/influencer_throw'],
  [`${P}/hf_20260712_042113_7d904014-6500-4bb2-96b9-bafc966e2df9.png`, 'enemies/republican/billionaire_throw'],
  [`${P}/hf_20260712_042131_297801a6-c9d1-4ee1-ba45-c3b33ae891b5.png`, 'enemies/democrat/palestine_throw'],
  [`${P}/hf_20260712_042133_ed0fa49b-eded-4dd2-9649-0f1d4d5de78d.png`, 'enemies/democrat/drag_throw'],
  [`${P}/hf_20260712_042237_0d3f7b06-cfa2-46e8-9916-1d9dc49ef540.png`, 'enemies/democrat/anchor_throw'],
  [`${P}/hf_20260712_042240_408ca164-70ad-4785-9bdc-e71d86e067aa.png`, 'enemies/democrat/comrade_throw'],
  [`${P}/hf_20260712_042242_952652e9-cc4c-4d15-abfe-7303cf06d42a.png`, 'enemies/democrat/senator_throw'],
]

async function buildOne(url, key) {
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer())
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width: W, height: H } = info
  const isBg = i => {
    const r = data[i], g = data[i + 1], b = data[i + 2]
    return Math.max(r, g, b) - Math.min(r, g, b) < 16 && (r + g + b) / 3 > 200
  }
  const visited = new Uint8Array(W * H); const q = []
  for (let x = 0; x < W; x++) q.push(x, (H - 1) * W + x)
  for (let y = 0; y < H; y++) q.push(y * W, y * W + W - 1)
  while (q.length) {
    const p = q.pop(); if (visited[p]) continue; visited[p] = 1
    if (!isBg(p * 4)) continue; data[p * 4 + 3] = 0
    const x = p % W, y = (p / W) | 0
    if (x > 0) q.push(p - 1); if (x < W - 1) q.push(p + 1)
    if (y > 0) q.push(p - W); if (y < H - 1) q.push(p + W)
  }
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const p = y * W + x, i = p * 4
    if (data[i + 3] === 0 || !isBg(i)) continue
    const nb = (data[(p - 1) * 4 + 3] === 0 ? 1 : 0) + (data[(p + 1) * 4 + 3] === 0 ? 1 : 0) +
               (data[(p - W) * 4 + 3] === 0 ? 1 : 0) + (data[(p + W) * 4 + 3] === 0 ? 1 : 0)
    if (nb >= 1) data[i + 3] = Math.round(data[i + 3] * (nb >= 3 ? 0.1 : 0.45))
  }
  let minX = W, minY = H, maxX = 0, maxY = 0
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (data[(y * W + x) * 4 + 3] > 12) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y }
  }
  await sharp(Buffer.from(data), { raw: { width: W, height: H, channels: 4 } })
    .extract({ left: Math.max(0, minX - 4), top: Math.max(0, minY - 4), width: Math.min(W - 1, maxX + 4) - Math.max(0, minX - 4) + 1, height: Math.min(H - 1, maxY + 4) - Math.max(0, minY - 4) + 1 })
    .resize({ height: 760, fit: 'inside' })
    .png().toFile(`public/${key}.png`)
  console.log('ok', key)
}

for (const [url, key] of JOBS) await buildOne(url, key)
console.log('done')
