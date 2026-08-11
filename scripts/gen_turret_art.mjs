// Guard Tower (defense turret, 3 levels) — Michael 2026-08-10: "a defensive
// tower and guns that shoot the invaders during raids."
import fs from 'fs'
const env = Object.fromEntries(
  fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))

const STYLE = `Painterly isometric mobile-game building sprite in the style of a cozy Clash-of-Clans-like base builder: `
  + `three-quarter view from the front-left at roughly 30 degrees, warm soft studio lighting from the upper left, `
  + `hand-painted texture with clean dark outlines, slightly toy-like proportions, gentle grounded contact shadow. `
  + `SINGLE structure only, centered, entirely inside frame. Plain flat light gray background (#cfcfcf), no text.`

async function gen(name, prompt) {
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-image-1', prompt, size: '1024x1024', quality: 'high' }),
  })
  const j = await res.json()
  if (!res.ok) { console.error(`FAILED ${name}:`, JSON.stringify(j).slice(0, 200)); return false }
  fs.writeFileSync(`.legaudit/gen/${name}.png`, Buffer.from(j.data[0].b64_json, 'base64'))
  console.log(`✔ ${name}`); return true
}
async function edit(name, prompt, from) {
  const form = new FormData()
  form.append('model', 'gpt-image-1')
  form.append('prompt', prompt)
  form.append('size', '1024x1024')
  form.append('quality', 'high')
  form.append('image', new Blob([fs.readFileSync(`.legaudit/gen/${from}.png`)], { type: 'image/png' }), 'in.png')
  const res = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST', headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` }, body: form,
  })
  const j = await res.json()
  if (!res.ok) { console.error(`FAILED ${name}:`, JSON.stringify(j).slice(0, 200)); return false }
  fs.writeFileSync(`.legaudit/gen/${name}.png`, Buffer.from(j.data[0].b64_json, 'base64'))
  console.log(`✔ ${name}`); return true
}

fs.mkdirSync('.legaudit/gen', { recursive: true })
if (await gen('turret1', `${STYLE} A small backyard GUARD TOWER, level 1: a sandbag ring gun nest on a low wooden `
  + `platform with a single mounted machine gun on a swivel, an ammo crate beside it, dirt patch base.`)) {
  await edit('turret2', `Upgrade this exact gun nest into its LEVEL 2 version, same camera, palette and painterly style: `
    + `a taller timber watchtower with a roofed platform, the mounted gun now twin-barreled, sandbags around the base, `
    + `a ladder up the side.`, 'turret1')
  await edit('turret3', `Upgrade this exact tower into its LEVEL 3 version, same camera, palette and painterly style: `
    + `an armored steel turret tower with a rotating twin-cannon mount, riveted plating, warning stripes, `
    + `a small searchlight — the most imposing version of this tower.`, 'turret2')
}
console.log('DONE')
