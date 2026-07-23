// Wire Grok's REAL spot-the-difference set into Pic Hunt (Michael 2026-07-22:
// "add grok's images... keep yours [sale] as level one only"). Grok made a
// bar scene: source.jpg (the base) + diff-01..10.jpg, each a clean edit that
// removes/adds/swaps whole objects. NO image generation here — we just diff
// source vs each variant to recover the exact answer key (the changed
// objects), render a numbered preview for visual QA, and emit the catalog.
// Uses ZERO Higgsfield credits. Usage: node scripts/gen_pichunt_grok.mjs
import sharp from 'sharp'
import fs from 'fs'

const SRC = 'C:/Users/Micha/Desktop/pic-hunt'
const OUT = 'public/spotit2'
const PREV = process.argv[2] // optional preview dir
const ID = 'barroom'
const LABEL = 'The Sports Bar'
const OUT_W = 1100
const DW = 660              // analysis width
const CELL = 6              // px per analysis cell
const TH = 24               // cell-mean delta to count as "changed"
const MIN_CELLS = 6         // blob must span at least this many cells
const MIN_SUM = 200         // drop weak blobs (area×delta)
const PEAK_MIN = 52         // a real object change has a SHARP delta peak, not a diffuse haze
const MAX_SPOTS = 8         // over-detect; curated down to Grok's verified 6 via KEEP

// Curation: after visual QA against Grok's ANSWER_KEY.md, the spot numbers
// (as shown in the *_prev.jpg previews) to KEEP per variant — only bold,
// clearly-identifiable object changes; blank-wall haze dropped. An empty
// array drops the whole variant (v05's changes barely rendered).
const KEEP = {
  v01: [1, 2, 3],          // cowboy hat→stool, mop→push broom, dancing couple gone
  v02: [1, 2, 3, 5, 6],    // couple standing, hat on man, tip jar/condiments, pool cue, floor napkin gone
  v03: [1, 2, 3],          // pretzels→popcorn, fan/calendar, fire extinguisher moved
  v04: [1, 2, 3, 5],       // TV→basketball, peanut bucket spilled, jersey→hockey stick, string lights gone
  v05: [],                 // DROP — intended edits didn't render cleanly
  v06: [1, 2, 4, 5],       // Schlitz neon, tray→pizza, US flag added, 2nd tip jar
  v07: [3, 4, 5],          // floor receipt, OPEN sign, cowboy hat→hard hat
  v08: [1, 3, 4],          // specials chalkboard, couple gone, dog bandana
  v09: [1, 2, 3, 4, 7],    // TV off, beer tray on table, limes bowl, tipped stool, guitar
  v10: [1, 2, 3, 4],       // extra person in doorway, dartboard→square target, cactus, burger→pizza
}

const meta = await sharp(`${SRC}/source.jpg`).metadata()
const DH = Math.round(meta.height * DW / meta.width)
const srcGray = await sharp(`${SRC}/source.jpg`).resize(DW, DH, { fit: 'fill' }).grayscale().raw().toBuffer()

const GX = Math.floor(DW / CELL), GY = Math.floor(DH / CELL)

function cellDeltas(gray) {
  const cells = new Float32Array(GX * GY)
  for (let cy = 0; cy < GY; cy++) {
    for (let cx = 0; cx < GX; cx++) {
      let s = 0, n = 0
      for (let y = cy * CELL; y < (cy + 1) * CELL; y++) {
        for (let x = cx * CELL; x < (cx + 1) * CELL; x++) {
          s += Math.abs(srcGray[y * DW + x] - gray[y * DW + x]); n++
        }
      }
      cells[cy * GX + cx] = s / n
    }
  }
  return cells
}

// flood-fill connected cells above TH into blobs
function blobs(cells) {
  const seen = new Uint8Array(GX * GY)
  const out = []
  for (let i = 0; i < cells.length; i++) {
    if (seen[i] || cells[i] < TH) continue
    // BFS
    const stack = [i]; seen[i] = 1
    let minx = GX, maxx = 0, miny = GY, maxy = 0, area = 0, sum = 0, sx = 0, sy = 0, peak = 0
    while (stack.length) {
      const j = stack.pop()
      const cx = j % GX, cy = (j / GX) | 0
      area++; sum += cells[j]; sx += cx; sy += cy
      if (cells[j] > peak) peak = cells[j]
      if (cx < minx) minx = cx; if (cx > maxx) maxx = cx
      if (cy < miny) miny = cy; if (cy > maxy) maxy = cy
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy
        if (nx < 0 || ny < 0 || nx >= GX || ny >= GY) continue
        const k = ny * GX + nx
        if (!seen[k] && cells[k] >= TH) { seen[k] = 1; stack.push(k) }
      }
    }
    const bw = (maxx - minx + 1) * CELL, bh = (maxy - miny + 1) * CELL
    // reject: too small, too weak, no SHARP peak (diffuse lighting shift), or
    // sprawling across a huge region (global/vague, not a discrete object)
    if (area < MIN_CELLS || sum < MIN_SUM) continue
    if (peak < PEAK_MIN) continue
    if (bw > DW * 0.30 || bh > DH * 0.34) continue
    out.push({
      cx: (sx / area + 0.5) * CELL, cy: (sy / area + 0.5) * CELL,
      w: bw, h: bh, area, sum,
    })
  }
  return out
}

fs.mkdirSync(OUT, { recursive: true })
if (PREV) fs.mkdirSync(PREV, { recursive: true })

// base image (the source = top picture)
await sharp(`${SRC}/source.jpg`).resize(OUT_W).jpeg({ quality: 88 }).toFile(`${OUT}/${ID}.jpg`)

const variants = []
for (let i = 1; i <= 10; i++) {
  const dfile = `${SRC}/diff-${String(i).padStart(2, '0')}.jpg`
  const gray = await sharp(dfile).resize(DW, DH, { fit: 'fill' }).grayscale().raw().toBuffer()
  const cells = cellDeltas(gray)
  let bl = blobs(cells).sort((a, b) => b.sum - a.sum)

  // greedy non-overlap, cap at MAX_SPOTS
  let picked = []
  for (const b of bl) {
    if (picked.length >= MAX_SPOTS) break
    if (picked.some(p => Math.hypot(p.cx - b.cx, p.cy - b.cy) < (Math.max(p.w, p.h) + Math.max(b.w, b.h)) / 2.0)) continue
    picked.push(b)
  }

  // curate down to the visually-verified spots (1-based numbers from preview)
  const keepNums = KEEP[`v${String(i).padStart(2, '0')}`]
  if (keepNums) picked = keepNums.map(n => picked[n - 1]).filter(Boolean)
  if (keepNums && picked.length === 0) { console.log(`diff-${i}: DROPPED`); continue } // excluded variant

  const name = `${ID}_v${String(i).padStart(2, '0')}.jpg`
  await sharp(dfile).resize(OUT_W).jpeg({ quality: 88 }).toFile(`${OUT}/${name}`)

  const diffs = picked.map(b => ({
    x: +(b.cx / DW).toFixed(4),
    y: +(b.cy / DH).toFixed(4),
    r: +(Math.min(0.11, Math.max(0.045, (Math.max(b.w, b.h) * 0.62) / DW))).toFixed(4),
  }))
  variants.push({ img: name, diffs, _n: picked.length })

  // numbered preview on the diff image for visual QA
  if (PREV) {
    const PW = 1000, sc = PW / DW, PH = Math.round(DH * sc)
    const svg = `<svg width="${PW}" height="${PH}" xmlns="http://www.w3.org/2000/svg">${picked.map((b, k) =>
      `<circle cx="${b.cx * sc}" cy="${b.cy * sc}" r="${Math.max(b.w, b.h) * 0.62 * sc}" fill="none" stroke="red" stroke-width="4"/>
       <text x="${b.cx * sc}" y="${b.cy * sc + 9}" font-size="30" font-weight="bold" fill="yellow" text-anchor="middle" stroke="black" stroke-width="1.2">${k + 1}</text>`).join('')}</svg>`
    const base = await sharp(dfile).resize(PW).toBuffer()
    await sharp(base).composite([{ input: Buffer.from(svg) }]).jpeg({ quality: 82 }).toFile(`${PREV}/${ID}_v${String(i).padStart(2, '0')}_prev.jpg`)
  }
  console.log(`diff-${i}: ${picked.length} spots`)
}

// Level order (Michael): existing garage 'sale' = Level 1 ONLY; Grok's bar
// scene = Level 2. The old 'dive' cartoon bar is dropped (redundant with the
// real bar scene). Its image files stay in git so it's trivially restorable.
const existing = JSON.parse(fs.readFileSync('config/spotit-scenes.json', 'utf8'))
const sale = existing.find(s => s.id === 'sale')
const catalog = []
if (sale) catalog.push(sale)
catalog.push({ id: ID, label: LABEL, w: OUT_W, h: Math.round(meta.height * (OUT_W / meta.width)), variants: variants.map(({ _n, ...v }) => v) })
fs.writeFileSync('config/spotit-scenes.json', JSON.stringify(catalog))
console.log(`\nDONE — catalog now: ${catalog.map((c, i) => 'L' + (i + 1) + ' ' + c.id + '(' + c.variants.length + 'v)').join(', ')}`)
console.log(`barroom spots/variant: ${variants.map(v => v._n + '→' + (v.diffs?.length ?? v._n)).join(', ')}`)
