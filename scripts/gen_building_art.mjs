// Isometric building sprites + yard background for the Campaign HQ stage
// (Grok's presentation brief, 2026-07-31: everything must match the camera
// angle and painterly language of Michael's hq1–5 house sheet — no emoji).
//
//   node scripts/gen_building_art.mjs            (all)
//   node scripts/gen_building_art.mjs media_tower fence
//
// Output: raw sheets in .legaudit/gen/, ready for cutout via
//   node scripts/slice_hq_houses.mjs <raw> <name> --single
import fs from 'fs'
import path from 'path'

const env = Object.fromEntries(
  fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))

// One shared style block so every sprite sits in the same world as the house.
const STYLE = `Painterly isometric mobile-game building sprite in the style of a cozy Clash-of-Clans-like base builder: `
  + `three-quarter view from the front-left at roughly 30 degrees, warm soft studio lighting from the upper left, `
  + `hand-painted texture with clean dark outlines, slightly toy-like proportions, gentle grounded contact shadow. `
  + `SINGLE building only, centered, entire object inside frame. `
  + `Plain flat light gray background (#cfcfcf), no checkerboard, no text, no watermark, no ground tile beyond a small dirt/grass base.`

const PIECES = {
  print_shop: {
    size: '1024x1024',
    prompt: `A small campaign print shop: a modest brick-and-wood workshop with a wide window showing an old printing press, `
      + `stacks of freshly printed leaflets and newspaper bundles tied with string by the door, an ink-stained awning, `
      + `and a small chimney. Modern-rustic, matching a political campaign yard.`,
  },
  media_tower: {
    size: '1024x1024',
    prompt: `A campaign media broadcast tower: a compact studio shed with a tall red-and-white lattice antenna mast rising from it, `
      + `a satellite dish on the roof, a glowing red beacon at the tip, and a coiled cable running down the side.`,
  },
  fence: {
    size: '1024x1024',
    prompt: `A short free-standing section of campaign-yard security fencing: sturdy chain-link panel in a steel frame between two `
      + `concrete-anchored posts, a small stack of sandbags at its base and a yellow CAUTION sign zip-tied to the mesh.`,
  },
  decor_flag: {
    size: '1024x1024',
    prompt: `ONLY a flag on a pole — absolutely NO building, NO house, NO structure of any kind. `
      + `A single wooden flagpole planted in a small round mound of grass and dirt, flying one `
      + `red-white-and-blue striped campaign banner with white stars, gently waving. `
      + `The pole and its grass mound are the ENTIRE object.`,
  },
  yard_bg: {
    size: '1536x1024',
    // full-stage backdrop, NOT a cutout — skips the slicer entirely
    prompt: `Painterly isometric mobile-game ground background for a base-builder yard: a wide open lawn of warm green grass `
      + `seen from the same three-quarter isometric angle, subtle diagonal mowing stripes aligned to an isometric grid, `
      + `patches of lighter clover and small dirt scuffs, a soft darker vignette at the edges, and a hint of hedge at the far top edge. `
      + `NO buildings, NO objects, NO text, NO sky — pure ground filling the entire frame, hand-painted texture, cozy warm palette.`,
  },
}

const want = process.argv.slice(2).filter(a => !a.startsWith('-'))
const todo = want.length ? want : Object.keys(PIECES)
fs.mkdirSync('.legaudit/gen', { recursive: true })

for (const id of todo) {
  const p = PIECES[id]
  if (!p) { console.error(`unknown piece: ${id}`); continue }
  console.log(`▶ ${id} (${p.size})...`)
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-image-1',
      prompt: id === 'yard_bg' ? p.prompt : `${STYLE}\n\n${p.prompt}`,
      size: p.size,
      quality: 'high',
      n: 1,
    }),
  })
  const j = await res.json()
  if (!res.ok) { console.error(`  FAILED ${res.status}:`, JSON.stringify(j).slice(0, 300)); continue }
  const b64 = j.data?.[0]?.b64_json
  if (!b64) { console.error('  no image'); continue }
  const dest = path.join('.legaudit/gen', `${id}.png`)
  fs.writeFileSync(dest, Buffer.from(b64, 'base64'))
  console.log(`  ✔ ${dest} (${Math.round(fs.statSync(dest).size / 1024)} KB)`)
}
console.log('\nNext: cutouts via slice_hq_houses.mjs --single (yard_bg goes straight to public/house/).')
