// Re-angle Michael's safe sprites to the SAME isometric camera as the house
// (Michael 2026-07-31: "The safe needs to be angled more so that it lines up
// with the house"). Uses gpt-image-1 EDITS with each existing cutout as the
// input so the design/materials stay HIS — only the camera moves.
//   node scripts/reangle_safes.mjs [1 2 ...]     (default: all five)
import fs from 'fs'

const env = Object.fromEntries(
  fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))

const PROMPT = `Redraw this exact safe as a painterly isometric mobile-game sprite: `
  + `three-quarter view from the front-left at roughly 30 degrees, matching a Clash-of-Clans-style base-builder camera `
  + `(we should see the front face angled to the right and one side face angled to the left, with a visible top). `
  + `KEEP the design identical: same lock style, same handle, same proportions, same dark metal, same brass details. `
  + `Warm soft lighting from the upper left, hand-painted texture, clean dark outlines, small grounded contact shadow. `
  + `Plain flat light gray background (#cfcfcf), no text, no watermark.`

const want = process.argv.slice(2).map(Number).filter(Boolean)
const todo = want.length ? want : [1, 2, 3, 4, 5]
fs.mkdirSync('.legaudit/gen', { recursive: true })

for (const n of todo) {
  const src = `public/house/safe${n}.png`
  if (!fs.existsSync(src)) { console.error(`missing ${src}`); continue }
  console.log(`▶ safe${n}...`)
  const form = new FormData()
  form.append('model', 'gpt-image-1')
  form.append('prompt', PROMPT)
  form.append('size', '1024x1024')
  form.append('quality', 'high')
  form.append('image', new Blob([fs.readFileSync(src)], { type: 'image/png' }), `safe${n}.png`)
  const res = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: form,
  })
  const j = await res.json()
  if (!res.ok) { console.error(`  FAILED ${res.status}:`, JSON.stringify(j).slice(0, 300)); continue }
  const b64 = j.data?.[0]?.b64_json
  if (!b64) { console.error('  no image'); continue }
  const dest = `.legaudit/gen/safe${n}_iso.png`
  fs.writeFileSync(dest, Buffer.from(b64, 'base64'))
  console.log(`  ✔ ${dest}`)
}
console.log('\nNext: node scripts/slice_hq_houses.mjs .legaudit/gen/safeN_iso.png safeN --single (after eyeballing)')
