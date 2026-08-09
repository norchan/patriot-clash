// Solar Array (3 levels, edit-chained bigger-and-better) + the red Doberman
// (yard sprite + run/bite flipbook) — Michael 2026-08-09.
//   node scripts/gen_defense_art.mjs
import fs from 'fs'

const env = Object.fromEntries(
  fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))

const BUILDING_STYLE = `Painterly isometric mobile-game building sprite in the style of a cozy Clash-of-Clans-like base builder: `
  + `three-quarter view from the front-left at roughly 30 degrees, warm soft studio lighting from the upper left, `
  + `hand-painted texture with clean dark outlines, slightly toy-like proportions, gentle grounded contact shadow. `
  + `SINGLE object group only, centered, entirely inside frame. `
  + `Plain flat light gray background (#cfcfcf), no text, no watermark.`

const CHAR_STYLE = `Painterly mobile-game creature sprite, hand-painted texture with clean dark outlines, `
  + `slightly toy-like proportions, warm light from the upper left, plain flat light gray background (#cfcfcf), no text.`

fs.mkdirSync('.legaudit/gen', { recursive: true })

async function gen(name, prompt) {
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-image-1', prompt, size: '1024x1024', quality: 'high' }),
  })
  const j = await res.json()
  if (!res.ok) { console.error(`  FAILED ${name}:`, JSON.stringify(j).slice(0, 200)); return false }
  fs.writeFileSync(`.legaudit/gen/${name}.png`, Buffer.from(j.data[0].b64_json, 'base64'))
  console.log(`  ✔ ${name}`); return true
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
  if (!res.ok) { console.error(`  FAILED ${name}:`, JSON.stringify(j).slice(0, 200)); return false }
  fs.writeFileSync(`.legaudit/gen/${name}.png`, Buffer.from(j.data[0].b64_json, 'base64'))
  console.log(`  ✔ ${name}`); return true
}

console.log('▶ solar array (3 levels)')
if (await gen('solar1', `${BUILDING_STYLE} A small backyard SOLAR PANEL ARRAY: two blue photovoltaic panels on a simple `
  + `angled steel ground mount over a patch of grass, a small junction box with a cable, glinting sunlight on the glass.`)) {
  await edit('solar2', `Expand this exact solar installation into its LEVEL 2 version, same camera, palette and painterly `
    + `style: four panels in a row on a sturdier mount, a battery cabinet beside them, a bit more polish.`, 'solar1')
  await edit('solar3', `Expand this exact solar installation into its LEVEL 3 version, same camera, palette and painterly `
    + `style: two full rows of gleaming panels, a large battery bank with a glowing charge indicator, neat cabling — `
    + `the most impressive version of this array.`, 'solar2')
}

console.log('▶ doberman (yard sprite + flipbook)')
// the classic "red" doberman: rust/mahogany coat with tan points
if (await gen('doberman', `${CHAR_STYLE} A RED DOBERMAN PINSCHER guard dog standing alert in three-quarter view: `
  + `glossy rust-red mahogany coat with tan markings on the chest, muzzle and legs, cropped pointed ears up, `
  + `docked tail, athletic build, wearing a simple black collar, focused intelligent stare. Whole dog in frame.`)) {
  await edit('doberman_run1', `Same EXACT dog, same style and size, now in FULL SIDE PROFILE facing RIGHT sprinting at a `
    + `gallop — front legs reaching forward, rear legs driving, ears pinned back. Change nothing else about the dog.`, 'doberman')
  await edit('doberman_run2', `Same EXACT dog, same style and size, still galloping to the right but on the OPPOSITE beat: `
    + `front legs tucked under, rear legs extended back, airborne mid-stride. Change nothing else.`, 'doberman_run1')
  await edit('doberman_run3', `Same EXACT dog, same style and size, galloping to the right in a gathered stance: all four `
    + `legs coming together under the body. Change nothing else.`, 'doberman_run1')
  await edit('doberman_atk1', `Same EXACT dog, same style and size, PLANTED facing right in a crouched snarl — hackles up, `
    + `teeth bared, ready to lunge. Change nothing else.`, 'doberman_run1')
  await edit('doberman_atk2', `Same EXACT dog, same style and size, mid-LUNGE biting forward to the right — jaws open, `
    + `front paws off the ground, motion streaks. Change nothing else.`, 'doberman_atk1')
}
console.log('DONE')
