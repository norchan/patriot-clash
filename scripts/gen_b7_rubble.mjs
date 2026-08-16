// Base Crown Jewel B7 (Grok 2026-08-16): destruction states.
// 7 per-type RUBBLE piles (edit-chained from a mid-level sprite so the pile
// is made of that building's own materials), one shared SCORCH decal for the
// home damaged state, one DUST CLOUD for the collapse moment.
// Resumable. node scripts/gen_b7_rubble.mjs
import fs from 'fs'

const env = Object.fromEntries(
  fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))

async function call(outName, prompt, srcPath) {
  const out = `.legaudit/gen/b7/${outName}.png`
  if (fs.existsSync(out)) { console.log(`  · ${outName} (done)`); return }
  const form = new FormData()
  form.append('model', 'gpt-image-1')
  form.append('prompt', prompt)
  form.append('size', '1024x1024')
  form.append('quality', 'high')
  form.append('background', 'transparent')
  if (srcPath) {
    form.append('input_fidelity', 'high')
    form.append('image', new Blob([fs.readFileSync(srcPath)], { type: 'image/png' }), 'in.png')
  }
  const res = await fetch(`https://api.openai.com/v1/images/${srcPath ? 'edits' : 'generations'}`, {
    method: 'POST', headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` }, body: form,
  })
  const j = await res.json()
  if (!res.ok) { console.error(`  FAILED ${outName}:`, JSON.stringify(j).slice(0, 180)); return }
  fs.mkdirSync('.legaudit/gen/b7', { recursive: true })
  fs.writeFileSync(out, Buffer.from(j.data[0].b64_json, 'base64'))
  console.log(`  ✔ ${outName}`)
}

const STYLE = `Same painterly mobile-strategy style as the source (docs/BASE_ART_BIBLE.md): fixed 2:1 isometric, ` +
  `one warm key light from the top-left, clean cutout silhouette. TRANSPARENT background, no ground shadow.`

const RUBBLE = `Reduce this EXACT building to a COLLAPSED RUBBLE PILE made of its own materials — broken beams, ` +
  `toppled wall chunks, scattered debris — staying within the same footprint, LOW (no taller than half the ` +
  `original), with two faint gray smoke wisps rising. ` + STYLE

// mid-level sources — the pile reads as "that building, down"
const SOURCES = {
  hq: 'hq3', barracks: 'barracks3', safe: 'safe3', solar: 'solar2',
  media_tower: 'media_tower', print_shop: 'print_shop', turret: 'turret2',
}

console.log('▶ B7 destruction states')
for (const [type, src] of Object.entries(SOURCES)) {
  await call(`rubble_${type}`, RUBBLE, `.legaudit/gen/b2/${src}.png`)
}
await call('fx_scorch', `A game VFX decal sprite: black scorch marks, soot smudges and thin dark cracks radiating ` +
  `from a burned center, semi-transparent edges, roughly elliptical spread wider than tall. Hand-painted game ` +
  `style. TRANSPARENT background, nothing else in frame.`, null)
await call('fx_dustcloud', `A single puffy DUST CLOUD burst sprite for a building-collapse moment in a painterly ` +
  `mobile strategy game: beige-gray billowing dust, several overlapping round puffs, denser at the bottom, ` +
  `wispy at the top. TRANSPARENT background, nothing else in frame.`, null)
console.log('DONE')
