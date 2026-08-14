// German Shepherd K-9 squad — siege special art (Michael 2026-08-13: replace
// the Statue of Liberty drop with "a german shepherd attack with animations").
// Same edit-chain pipeline as the doberman (gen_defense_art.mjs).
//   node scripts/gen_shepherd_art.mjs
import fs from 'fs'

const env = Object.fromEntries(
  fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))

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

console.log('▶ german shepherd K-9 (siege special flipbook)')
if (await gen('k9', `${CHAR_STYLE} A GERMAN SHEPHERD police K-9 dog standing alert in three-quarter view: `
  + `classic black-and-tan saddle coat, black muzzle mask, tall upright ears, bushy tail, athletic build, `
  + `wearing a dark tactical K-9 vest harness with a small gold star badge, focused intelligent stare. Whole dog in frame.`)) {
  await edit('k9_run1', `Same EXACT dog, same style and size, now in FULL SIDE PROFILE facing RIGHT sprinting at a `
    + `gallop — front legs reaching forward, rear legs driving, ears pinned back. Change nothing else about the dog.`, 'k9')
  await edit('k9_run2', `Same EXACT dog, same style and size, still galloping to the right but on the OPPOSITE beat: `
    + `front legs tucked under, rear legs extended back, airborne mid-stride. Change nothing else.`, 'k9_run1')
  await edit('k9_run3', `Same EXACT dog, same style and size, galloping to the right in a gathered stance: all four `
    + `legs coming together under the body. Change nothing else.`, 'k9_run1')
  await edit('k9_atk1', `Same EXACT dog, same style and size, PLANTED facing right in a crouched snarl — hackles up, `
    + `teeth bared, ready to lunge. Change nothing else.`, 'k9_run1')
  await edit('k9_atk2', `Same EXACT dog, same style and size, mid-LUNGE biting forward to the right — jaws open, `
    + `front paws off the ground, motion streaks. Change nothing else.`, 'k9_atk1')
}
console.log('DONE')
