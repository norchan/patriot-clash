// CoC-style ISO WALL pieces (Grok's P0 brief 2026-08-04): the sheared
// front-facing fence panel reads as a tilted plank — a real iso wall needs its
// BASE LINE on the 2:1 grid diagonal and visible THICKNESS with a lit top
// face. Two straight pieces (SE = toward lower-right, SW = toward lower-left)
// + a chunky junction post. Edits from the existing panel keep the material
// language (steel chain-link) consistent.
//
//   node scripts/gen_wall_art.mjs
import fs from 'fs'

const env = Object.fromEntries(
  fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))

const COMMON = `Painterly isometric mobile-game WALL sprite for a Clash-of-Clans-style base builder. `
  + `Hand-painted texture, clean dark outlines, warm light from the upper left. `
  + `Plain flat light gray background (#cfcfcf), no text, no ground shadow blob, no dirt patch.`

const PIECES = {
  wall_se: `Redraw this fence as ONE straight isometric wall segment running diagonally from the UPPER-LEFT of the frame `
    + `DOWN to the LOWER-RIGHT at exactly a 2:1 isometric slope (about 27 degrees below horizontal), like a wall piece on `
    + `an isometric grid viewed in three-quarter view. The BASE of the wall follows that diagonal line precisely. `
    + `Steel frame with chain-link mesh, a round steel post at EACH end, visible wall thickness with a narrow lit top rail `
    + `face along the whole length. The segment fills the frame corner to corner along the diagonal. ${COMMON}`,
  wall_sw: `Redraw this fence as ONE straight isometric wall segment running diagonally from the UPPER-RIGHT of the frame `
    + `DOWN to the LOWER-LEFT at exactly a 2:1 isometric slope (about 27 degrees below horizontal), like a wall piece on `
    + `an isometric grid viewed in three-quarter view. The BASE of the wall follows that diagonal line precisely. `
    + `Steel frame with chain-link mesh, a round steel post at EACH end, visible wall thickness with a narrow lit top rail `
    + `face along the whole length. The segment fills the frame corner to corner along the diagonal. ${COMMON}`,
  wall_post: `Redraw this as ONLY a single short steel wall post: one round steel post with a domed cap on a small square `
    + `concrete footing, isometric three-quarter view, nothing else in frame — no fence mesh, no rails. ${COMMON}`,
}

fs.mkdirSync('.legaudit/gen', { recursive: true })
for (const [name, prompt] of Object.entries(PIECES)) {
  console.log(`▶ ${name}...`)
  const form = new FormData()
  form.append('model', 'gpt-image-1')
  form.append('prompt', prompt)
  form.append('size', '1024x1024')
  form.append('quality', 'high')
  form.append('image', new Blob([fs.readFileSync('public/house/fence.png')], { type: 'image/png' }), 'fence.png')
  const res = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: form,
  })
  const j = await res.json()
  if (!res.ok) { console.error(`  FAILED ${res.status}:`, JSON.stringify(j).slice(0, 250)); continue }
  fs.writeFileSync(`.legaudit/gen/${name}.png`, Buffer.from(j.data[0].b64_json, 'base64'))
  console.log(`  ✔ ${name}`)
}
console.log('DONE')
