// Barroom Eyes v3: PRE-BAKED variant copies (Michael's spec).
// Each scene ships as one base image + ~20 baked copies, each copy carrying 6
// differences. The recolor is CHROMA-MASKED: only pixels that are actually
// colorful get shifted, so backgrounds/dull areas stay byte-identical — no
// purple halo tell. Spots are hand-curated on big objects (phone-visible).
// Output: public/spotit2/<id>.jpg + <id>_vNN.jpg + config/spotit-scenes.json
// Usage: node scripts/gen_spotit_variants.mjs <scratchpad-dir>
import sharp from 'sharp'
import fs from 'fs'

const SP = process.argv[2]
if (!SP) { console.error('pass scratchpad dir'); process.exit(1) }

const VARIANTS = 20
const DIFFS = 6
const OUT_W = 1100
const MIN_CHANGED_DELTA = 40 // mean delta across CHANGED pixels must exceed this
const MIN_CHANGED_FRAC = 0.10 // ≥10% of the circle's pixels must actually change

// [x, y, r] source px (1200×896) — every spot sits on a big colorful object
const SCENES = {
  kitchen: { label: 'Kitchen Counter', src: `${SP}/spot_kitchen.png`, spots: [
    [480, 540, 105], [150, 485, 95], [695, 685, 75], [682, 415, 75], [825, 430, 80],
    [270, 745, 105], [950, 480, 85], [1035, 315, 90], [1120, 735, 70], [945, 625, 65],
    [215, 295, 80], [505, 300, 70],
  ]},
  garage: { label: 'The Workbench', src: `${SP}/spot_garage.png`, spots: [
    [280, 315, 105], [490, 290, 80], [975, 320, 100], [205, 610, 120], [330, 650, 90],
    [500, 660, 80], [700, 565, 95], [700, 690, 80], [1010, 630, 105], [930, 775, 85],
    [490, 395, 75],
  ]},
  picnic: { label: 'Picnic Table', src: `${SP}/spot_picnic.png`, spots: [
    [235, 590, 110], [410, 410, 130], [690, 520, 90], [855, 390, 75], [920, 530, 65],
    [1040, 330, 110], [1035, 640, 85], [825, 690, 75], [555, 670, 95], [600, 820, 100],
  ]},
  camp: { label: 'The Campsite', src: `${SP}/spot_camp.png`, spots: [
    [255, 470, 160], [425, 185, 70], [575, 415, 85], [855, 430, 95], [685, 555, 95],
    [240, 730, 95], [300, 830, 110], [900, 700, 95], [1090, 390, 75], [1040, 470, 70],
  ]},
}

function hueMatrix(deg) {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a)
  return [
    0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928,
    0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.140, 0.072 - c * 0.072 - s * 0.283,
    0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072,
  ]
}
const clamp255 = v => Math.max(0, Math.min(255, v))

// apply one chroma-masked hue shift in place; returns QA stats
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
      // the anti-halo core: dull pixels are untouchable
      const cf = Math.max(0, Math.min(1, (chroma - 28) / 34))
      if (cf === 0) continue
      const ff = Math.min(1, (pr - dist) / (pr * 0.25)) // edge feather
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

fs.mkdirSync('public/spotit2', { recursive: true })
const catalog = []

for (const [id, scene] of Object.entries(SCENES)) {
  const { data: baseData, info } = await sharp(scene.src).raw().toBuffer({ resolveWithObject: true })
  const { width: W, height: H, channels: C } = info
  await sharp(scene.src).resize(OUT_W).jpeg({ quality: 86 }).toFile(`public/spotit2/${id}.jpg`)

  const variants = []
  let v = 0, attempts = 0
  while (v < VARIANTS && attempts < VARIANTS * 6) {
    attempts++
    const picks = shuffle([...scene.spots]).slice(0, DIFFS)
      .map(([x, y, r]) => ({ x, y, r, deg: (100 + Math.random() * 160) * (Math.random() < 0.5 ? 1 : -1) }))
    const data = Buffer.from(baseData)
    let ok = true
    for (const d of picks) {
      const qa = applyDiff(data, W, H, C, d)
      if (qa.meanDelta < MIN_CHANGED_DELTA / 3 || qa.changedFrac < MIN_CHANGED_FRAC) { ok = false; break }
    }
    if (!ok) continue // re-roll: some spot+hue combo was too subtle
    v++
    const name = `${id}_v${String(v).padStart(2, '0')}.jpg`
    await sharp(data, { raw: { width: W, height: H, channels: C } })
      .resize(OUT_W).jpeg({ quality: 86 }).toFile(`public/spotit2/${name}`)
    variants.push({
      img: name,
      diffs: picks.map(d => ({ x: +(d.x / W).toFixed(4), y: +(d.y / H).toFixed(4), r: +(d.r / W).toFixed(4) })),
    })
  }
  if (v < VARIANTS) throw new Error(`${id}: only ${v}/${VARIANTS} variants passed QA — loosen spots`)
  catalog.push({ id, label: scene.label, w: OUT_W, h: Math.round(H * (OUT_W / W)), variants })
  console.log(`${id}: ${v} variants baked (${attempts} attempts)`)
}

fs.writeFileSync('config/spotit-scenes.json', JSON.stringify(catalog))
console.log(`DONE → public/spotit2 (${catalog.reduce((s, c) => s + c.variants.length + 1, 0)} images) + config/spotit-scenes.json`)
