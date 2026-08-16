// Base Crown Jewel B2 (Grok 2026-08-16): restyle the FULL building set to one
// art bible (docs/BASE_ART_BIBLE.md). Every asset is an EDIT of the live art
// — same structure/footprint/progression, elevated unified rendering — with
// gpt-image-1's native transparent background (no cutout pipeline needed).
// Fences/walls are NOT touched: their pixel calibration anchors the link
// geometry (see WALL in components/IsoYard.tsx).
//   node scripts/gen_b2_buildings.mjs
import fs from 'fs'

const env = Object.fromEntries(
  fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))

// The bible, condensed to a prompt (keep in sync with docs/BASE_ART_BIBLE.md)
const STYLE = `premium mobile strategy game sprite (Clash-of-Clans production quality): fixed 2:1 isometric ` +
  `three-quarter view, ONE warm key light from the TOP-LEFT with soft cool ambient fill, hand-painted texture ` +
  `with crisp confident edges and a clean cutout silhouette, saturated but grounded palette (warm timber, ` +
  `weathered stone, fresh grass-green accents, gold trim where present), slightly chunky toy-like proportions, ` +
  `readable at small size. TRANSPARENT background. Absolutely NO ground shadow, NO grass mat, NO dirt patch, ` +
  `NO base plate under the structure — the sprite must end at the building's own footprint.`

async function restyle(name) {
  const form = new FormData()
  form.append('model', 'gpt-image-1')
  form.append('prompt', `Repaint this EXACT structure as a ${STYLE} Keep the same building — same footprint, ` +
    `massing, viewing angle, materials, and distinguishing details — only unify and elevate the rendering to ` +
    `that style. This is one sprite in a set that must all match.`)
  form.append('size', '1024x1024')
  form.append('quality', 'high')
  form.append('background', 'transparent')
  form.append('input_fidelity', 'high')
  form.append('image', new Blob([fs.readFileSync(`public/house/${name}.png`)], { type: 'image/png' }), 'in.png')
  const res = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST', headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` }, body: form,
  })
  const j = await res.json()
  if (!res.ok) { console.error(`  FAILED ${name}:`, JSON.stringify(j).slice(0, 200)); return false }
  fs.mkdirSync('.legaudit/gen/b2', { recursive: true })
  fs.writeFileSync(`.legaudit/gen/b2/${name}.png`, Buffer.from(j.data[0].b64_json, 'base64'))
  console.log(`  ✔ ${name}`); return true
}

const ASSETS = [
  'hq1', 'hq2', 'hq3', 'hq4', 'hq5',
  'barracks1', 'barracks2', 'barracks3', 'barracks4', 'barracks5',
  'safe1', 'safe2', 'safe3', 'safe4', 'safe5',
  'turret1', 'turret2', 'turret3',
  'solar1', 'solar2', 'solar3',
  'media_tower', 'print_shop', 'decor_flag', 'doberman',
]

console.log(`▶ B2 building restyle — ${ASSETS.length} assets`)
for (const a of ASSETS) {
  // resumable: a killed run continues where it left off
  if (fs.existsSync(`.legaudit/gen/b2/${a}.png`)) { console.log(`  · ${a} (done)`); continue }
  await restyle(a)
}
console.log('DONE')
