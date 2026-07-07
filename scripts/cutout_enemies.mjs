// Removes the fake-transparency checkerboard / white backgrounds baked into
// the enemy character JPGs, producing real transparent PNGs.
// Method: flood-fill from the image borders, erasing background-ish pixels
// (near-white or the light checker grays). The characters' bold dark outlines
// stop the fill, so whites INSIDE the character (eyes, teeth) survive.
import sharp from 'sharp'
import fs from 'fs'
import path from 'path'

const ROOT = new URL('../public/enemies/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

function isBackground(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
  // Checker squares range from pure white to warm-tinted light gray; real
  // character colors at these brightness levels are far more saturated, and
  // interior whites (eyes/teeth) are protected by the outline flood barrier.
  const lowSat = mx - mn < 32
  const light = mn > 168
  return lowSat && light
}

async function cutout(file) {
  const img = sharp(file).ensureAlpha()
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true })
  const { width: w, height: h } = info

  const visited = new Uint8Array(w * h)
  const queue = []
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return
    const i = y * w + x
    if (visited[i]) return
    const o = i * 4
    if (!isBackground(data[o], data[o + 1], data[o + 2])) return
    visited[i] = 1
    queue.push(i)
  }

  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1) }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y) }

  while (queue.length) {
    const i = queue.pop()
    const x = i % w, y = (i / w) | 0
    data[i * 4 + 3] = 0
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1)
  }

  // Soften the cut edge: any remaining bg-ish pixel touching transparency
  // gets partial alpha (cheap 1px anti-halo)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const o = i * 4
      if (data[o + 3] === 0) continue
      const nearClear =
        data[((y - 1) * w + x) * 4 + 3] === 0 || data[((y + 1) * w + x) * 4 + 3] === 0 ||
        data[(y * w + x - 1) * 4 + 3] === 0 || data[(y * w + x + 1) * 4 + 3] === 0
      if (nearClear && isBackground(data[o], data[o + 1], data[o + 2])) data[o + 3] = 90
    }
  }

  const out = file.replace(/\.jpg$/i, '.png')
  const buf = await sharp(data, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer()
  await sharp(buf).trim().png().toFile(out)
  const cleared = visited.reduce((a, b) => a + b, 0)
  console.log(`${path.basename(file)} -> ${path.basename(out)} (cleared ${Math.round(cleared / (w * h) * 100)}% of pixels)`)
}

for (const party of ['republican', 'democrat']) {
  const dir = path.join(ROOT, party)
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith('.jpg')) await cutout(path.join(dir, f))
  }
}
console.log('done')
