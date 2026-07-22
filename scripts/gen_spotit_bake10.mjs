// Bake the 10 NEW Pic Hunt scenes (Michael 2026-07-22: "10 more images...
// new scene each time... levels should get harder"). Same recipe as
// gen_spotit_variants.mjs — 20 pre-baked copies per scene, 6 chroma-masked
// recolors each — PLUS a difficulty ramp: later scenes get smaller spots and
// gentler hue shifts, so level 11 takes real staring and level 2 pops.
// Spots come from the auto-scan (gen_spotit_scan.mjs) minus the hand-reviewed
// rejects (grass/sky/bare-wall smudge risks dropped after visual pass).
// Usage: node scripts/gen_spotit_bake10.mjs <scratchpad>/spotit
import sharp from 'sharp'
import fs from 'fs'

const DIR = process.argv[2]
if (!DIR) { console.error('pass the scene dir'); process.exit(1) }

const VARIANTS = 20
const DIFFS = 6
const OUT_W = 1100
const MIN_CHANGED_DELTA = 40
const MIN_CHANGED_FRAC = 0.10

// keep = 1-based numbers from the reviewed previews ([] = keep all 14)
const ORDER = [
  { id: 'bbq',        label: 'Backyard Fourth',  keep: [1,2,3,4,5,6,7,8,9,10,12,13] },
  { id: 'tailgate',   label: 'The Tailgate',     keep: [] },
  { id: 'dock',       label: 'Dawn Dock',        keep: [1,2,3,4,5,6,8,9] },
  { id: 'fair',       label: 'County Fair',      keep: [1,2,3,4,5,6,7,8,9,10,11,12,14] },
  { id: 'diner',      label: 'Breakfast Counter',keep: [1,2,4,5,6,7,8,10,11] },
  { id: 'parade',     label: 'Main St. Parade',  keep: [1,2,3,4,5,6,7,8,9,10,11,12,14] },
  { id: 'foodtruck',  label: 'Truck Fest',       keep: [1,2,3,4,5,6,7,8,9,11,12,13,14] },
  { id: 'garagesale', label: 'The Garage Sale',  keep: [1,2,3,4,5,6,7,8,9,10,11,12,14] },
  { id: 'bowling',    label: 'Bowl-O-Rama',      keep: [1,2,3,4,6,7,8,10,11,12] },
  { id: 'toystore',   label: 'Toy Aisle',        keep: [] },
]

function hueMatrix(deg) {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a)
  return [
    0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928,
    0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.140, 0.072 - c * 0.072 - s * 0.283,
    0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072,
  ]
}
const clamp255 = v => Math.max(0, Math.min(255, v))

function applyDiff(data, W, H, C, d) {
  const pr = Math.round(d.r), px = Math.round(d.x), py = Math.round(d.y)
  const M = hueMatrix(d.deg)
  let changed = 0, total = 0, deltaSum = 0
  for (let y = Math.max(0, py - pr); y < Math.min(H, py + pr); y++) {
    for (let x = Math.max(0, px - pr); x < Math.min(W, px + pr); x++) {
      const dist = Math.hypot(x - px, y - py)
      if (dist > pr) continue
      total++
      const i = (y * W + x) * C
      const r = data[i], g = data[i + 1], b = data[i + 2]
      const chroma = Math.max(r, g, b) - Math.min(r, g, b)
      const cf = Math.max(0, Math.min(1, (chroma - 28) / 34))
      if (cf === 0) continue
      const ff = Math.min(1, (pr - dist) / (pr * 0.25))
      const f = cf * ff
      const nr = clamp255(r + f * (M[0] * r + M[1] * g + M[2] * b - r))
      const ng = clamp255(g + f * (M[3] * r + M[4] * g + M[5] * b - g))
      const nb = clamp255(b + f * (M[6] * r + M[7] * g + M[8] * b - b))
      const delta = Math.abs(nr - r) + Math.abs(ng - g) + Math.abs(nb - b)
      if (delta > 24) { changed++; deltaSum += delta }
      data[i] = nr; data[i + 1] = ng; data[i + 2] = nb
    }
  }
  return { changedFrac: changed / total, meanDelta: changed ? deltaSum / changed / 3 : 0 }
}

const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] } return a }

// existing catalog (keeps 'sale' as level 1)
const catalog = JSON.parse(fs.readFileSync('config/spotit-scenes.json', 'utf8'))
  .filter(s => !ORDER.some(o => o.id === s.id))

for (let li = 0; li < ORDER.length; li++) {
  const { id, label, keep } = ORDER[li]
  // difficulty ramp: level 2 → full-size spots, big hue swings;
  // level 11 → ~62% spots, gentler shifts
  const rFactor = 1.0 - li * 0.042
  const hueLo = 100 - li * 3, hueHi = 260 - li * 10

  const all = JSON.parse(fs.readFileSync(`${DIR}/${id}_spots.json`, 'utf8'))
  const spots = (keep.length ? keep.map(n => all[n - 1]) : all)
    .map(([x, y, r]) => [x, y, Math.round(r * rFactor)])

  const src = `${DIR}/${id}.png`
  const { data: baseData, info } = await sharp(src).raw().toBuffer({ resolveWithObject: true })
  const { width: W, height: H, channels: C } = info
  await sharp(src).resize(OUT_W).jpeg({ quality: 86 }).toFile(`public/spotit2/${id}.jpg`)

  const variants = []
  let v = 0, attempts = 0
  while (v < VARIANTS && attempts < VARIANTS * 10) {
    attempts++
    const picks = shuffle([...spots]).slice(0, DIFFS)
      .map(([x, y, r]) => ({ x, y, r, deg: (hueLo + Math.random() * (hueHi - hueLo)) * (Math.random() < 0.5 ? 1 : -1) }))
    const data = Buffer.from(baseData)
    let ok = true
    for (const d of picks) {
      const qa = applyDiff(data, W, H, C, d)
      if (qa.meanDelta < MIN_CHANGED_DELTA / 3 || qa.changedFrac < MIN_CHANGED_FRAC) { ok = false; break }
    }
    if (!ok) continue
    v++
    const name = `${id}_v${String(v).padStart(2, '0')}.jpg`
    await sharp(data, { raw: { width: W, height: H, channels: C } })
      .resize(OUT_W).jpeg({ quality: 86 }).toFile(`public/spotit2/${name}`)
    variants.push({
      img: name,
      diffs: picks.map(d => ({ x: +(d.x / W).toFixed(4), y: +(d.y / H).toFixed(4), r: +(d.r / W).toFixed(4) })),
    })
  }
  if (v < VARIANTS) throw new Error(`${id}: only ${v}/${VARIANTS} variants passed QA (pool ${spots.length})`)
  catalog.push({ id, label, w: OUT_W, h: Math.round(H * (OUT_W / W)), variants })
  console.log(`L${li + 2} ${id}: ${v} variants (${attempts} attempts, pool ${spots.length}, r×${rFactor.toFixed(2)}, hue ±${hueLo}–${hueHi})`)
}

fs.writeFileSync('config/spotit-scenes.json', JSON.stringify(catalog))
console.log(`DONE — ${catalog.length} scenes, ${catalog.reduce((s, c) => s + c.variants.length, 0)} baked variants`)
