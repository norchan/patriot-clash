// Build the Spot the Difference scene pairs. Takes the base cartoon scenes,
// applies KNOWN local edits (hue-shifts on specific objects, one clone-stamp
// removal), and writes the pair + exact answer key. Because the differences
// are applied programmatically, the tap-detection key is always correct.
// Usage: node scripts/gen_spotit.mjs <scratchpad-dir>
import sharp from 'sharp'
import fs from 'fs'

const SP = process.argv[2]
if (!SP) { console.error('pass scratchpad dir'); process.exit(1) }

const OUT_W = 1000 // output width (jpg, both copies identical size)

// r values in SOURCE pixels; type: hue (rotate degrees) | clone (dx/dy source offset)
const SCENES = [
  {
    id: 'bar', label: 'The Dive Bar', src: `${SP}/spot_bar2.png`, crop: null,
    diffs: [
      { x: 133, y: 57, r: 42, type: 'hue', deg: 140 },   // moose's cap
      { x: 912, y: 320, r: 80, type: 'hue', deg: 100 },  // jukebox
      { x: 872, y: 428, r: 34, type: 'hue', deg: 150 },  // racked pool balls
      { x: 778, y: 550, r: 27, type: 'hue', deg: 160 },  // red baseball cap
      { x: 1095, y: 245, r: 52, type: 'hue', deg: 120 }, // dartboard
      { x: 505, y: 545, r: 40, type: 'hue', deg: 130 },  // pretzel bowl
    ],
  },
  {
    id: 'rally', label: 'Rally Day', src: `${SP}/spot_rally.png`, crop: null,
    diffs: [
      { x: 118, y: 268, r: 60, type: 'hue', deg: 130 },  // cart umbrella
      { x: 280, y: 163, r: 60, type: 'hue', deg: 120 },  // balloon cluster
      { x: 1035, y: 390, r: 22, type: 'clone', dx: 48, dy: 6 }, // a pigeon vanishes
      { x: 1048, y: 466, r: 52, type: 'hue', deg: 150 }, // tuba
      { x: 113, y: 612, r: 62, type: 'hue', deg: 120 },  // popcorn cart stripes
      { x: 255, y: 793, r: 34, type: 'hue', deg: 110 },  // pinwheel
    ],
  },
  {
    id: 'diner', label: 'Rollerskate Diner', src: `${SP}/spot_diner.png`,
    crop: { left: 16, top: 70, width: 578, height: 758 }, // left panel of the split source
    diffs: [
      { x: 460, y: 70, r: 38, type: 'hue', deg: 120 },   // plant pot
      { x: 212, y: 318, r: 40, type: 'hue', deg: 80 },   // cake on the stand
      { x: 69, y: 220, r: 52, type: 'hue', deg: 130 },   // red car outside
      { x: 374, y: 262, r: 30, type: 'hue', deg: 140 },  // milkshake blender
      { x: 529, y: 105, r: 38, type: 'hue', deg: 170 },  // cat on the shelf
      { x: 517, y: 570, r: 40, type: 'hue', deg: 120 },  // stool seat
    ],
  },
]

// soft-edged circular mask so edits blend into the line art
const maskSvg = r =>
  Buffer.from(`<svg width="${r * 2}" height="${r * 2}">
    <defs><radialGradient id="g"><stop offset="78%" stop-color="#fff"/><stop offset="100%" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>
    <circle cx="${r}" cy="${r}" r="${r}" fill="url(#g)"/></svg>`)

async function circlePatch(baseBuf, cx, cy, r, transform) {
  const left = Math.max(0, Math.round(cx - r)), top = Math.max(0, Math.round(cy - r))
  let patch = sharp(baseBuf).extract({ left, top, width: r * 2, height: r * 2 })
  patch = transform(patch)
  const masked = await sharp(await patch.png().toBuffer())
    .composite([{ input: maskSvg(r), blend: 'dest-in' }])
    .png().toBuffer()
  return { input: masked, left, top }
}

const key = []
for (const scene of SCENES) {
  let img = sharp(scene.src)
  if (scene.crop) img = img.extract(scene.crop)
  const baseBuf = await img.png().toBuffer()
  const meta = await sharp(baseBuf).metadata()
  const W = meta.width, H = meta.height

  const comps = []
  for (const d of scene.diffs) {
    if (d.type === 'hue') {
      comps.push(await circlePatch(baseBuf, d.x, d.y, d.r, p => p.modulate({ hue: d.deg })))
    } else {
      // clone-stamp: cover the object with a nearby patch of background
      const srcPatch = await circlePatch(baseBuf, d.x + d.dx, d.y + (d.dy ?? 0), d.r, p => p)
      comps.push({ input: srcPatch.input, left: Math.round(d.x - d.r), top: Math.round(d.y - d.r) })
    }
  }
  const editedBuf = await sharp(baseBuf).composite(comps).png().toBuffer()

  fs.mkdirSync('public/spotit', { recursive: true })
  await sharp(baseBuf).resize(OUT_W).jpeg({ quality: 84 }).toFile(`public/spotit/${scene.id}_a.jpg`)
  await sharp(editedBuf).resize(OUT_W).jpeg({ quality: 84 }).toFile(`public/spotit/${scene.id}_b.jpg`)

  key.push({
    id: scene.id, label: scene.label, w: OUT_W, h: Math.round(H * (OUT_W / W)),
    diffs: scene.diffs.map(d => ({ x: +(d.x / W).toFixed(4), y: +(d.y / H).toFixed(4), r: +(d.r / W).toFixed(4) })),
  })
  console.log(`scene ${scene.id}: ${scene.diffs.length} diffs baked (${W}x${H})`)
}
fs.writeFileSync('config/spotit.json', JSON.stringify(key, null, 1))
console.log('DONE → public/spotit/*.jpg + config/spotit.json')
