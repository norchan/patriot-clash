// Siege ground-troop flipbooks (Grok's siege brief, 2026-08-06): free-deploy
// troops must stop looking like ninjas/soldiers. Democrats field ANTIFA KIDS,
// Republicans field MARSHALS — archetypes only, no real-person likenesses.
// Each side gets 3 run frames + 2 attack frames. Frames are EDIT CHAINS from
// one base image so the character stays identical across the flipbook.
//
//   node scripts/gen_siege_troops.mjs
import fs from 'fs'

const env = Object.fromEntries(
  fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))

const STYLE = `Painterly mobile-game character sprite, hand-painted texture with clean dark outlines, `
  + `slightly toy-like proportions, warm light from the upper left. FULL BODY in SIDE PROFILE facing RIGHT, `
  + `whole body including feet inside the frame, plain flat light gray background (#cfcfcf), no text, no watermark.`

const BASES = {
  antifa: `A black-clad protest kid archetype sprinting to the right at full speed, mid-stride with the right leg `
    + `forward and arms pumping: black hoodie with the hood up, black bandana covering the lower face, black beanie, `
    + `skinny black jeans, worn skate sneakers, fingerless gloves, gripping a wooden protest-sign stick. `
    + `Lean scrappy teenage build.`,
  marshal: `A private-security marshal archetype sprinting to the right at full speed, mid-stride with the right leg `
    + `forward and arms pumping: navy windbreaker with a gold star badge, khaki tactical pants, black boots, `
    + `navy ball cap, aviator sunglasses, gripping a black baton. Stocky capable build.`,
}

const CHAIN = [
  ['run2', `Same EXACT character, same style and size, still sprinting to the right but on the OPPOSITE stride: `
    + `left leg forward, right leg trailing, arms swapped. Change nothing else about the character.`, 'run1'],
  ['run3', `Same EXACT character, same style and size, sprinting to the right in a passing stance: both legs `
    + `close under the body mid-stride, one heel lifting. Change nothing else about the character.`, 'run1'],
  ['atk1', `Same EXACT character, same style and size, now PLANTED facing right and winding up a big two-handed `
    + `swing — weapon raised back over the shoulder, knees bent, ready to strike. Change nothing else.`, 'run1'],
  ['atk2', `Same EXACT character, same style and size, mid-SWING — the weapon whipping forward and down toward the `
    + `right with motion streaks, weight on the front foot. Change nothing else.`, 'atk1'],
]

fs.mkdirSync('.legaudit/gen', { recursive: true })

async function gen(name, prompt) {
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-image-1', prompt, size: '1024x1024', quality: 'high' }),
  })
  const j = await res.json()
  if (!res.ok) { console.error(`  FAILED ${name}:`, JSON.stringify(j).slice(0, 220)); return false }
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
  if (!res.ok) { console.error(`  FAILED ${name}:`, JSON.stringify(j).slice(0, 220)); return false }
  fs.writeFileSync(`.legaudit/gen/${name}.png`, Buffer.from(j.data[0].b64_json, 'base64'))
  console.log(`  ✔ ${name}`); return true
}

for (const [who, base] of Object.entries(BASES)) {
  console.log(`▶ ${who}`)
  const ok = await gen(`${who}_run1`, `${STYLE} ${base}`)
  if (!ok) continue
  for (const [suffix, prompt, from] of CHAIN) {
    await edit(`${who}_${suffix}`, `${prompt} Keep the painterly style, side profile facing right, `
      + `plain flat light gray background (#cfcfcf).`, `${who}_${from}`)
  }
}
console.log('DONE')
