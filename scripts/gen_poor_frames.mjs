// Siege checklist #4 (Grok 2026-08-15): densify the Poor mob.
// Run 2→6, attack 1→4. The Poor is the PHOTOREAL character family (July-11
// era) — chain from the live cutouts to keep the same weathered man.
//   node scripts/gen_poor_frames.mjs
import fs from 'fs'

const env = Object.fromEntries(
  fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))

async function edit(name, prompt, fromPath) {
  const form = new FormData()
  form.append('model', 'gpt-image-1')
  form.append('prompt', prompt)
  form.append('size', '1024x1024')
  form.append('quality', 'high')
  form.append('image', new Blob([fs.readFileSync(fromPath)], { type: 'image/png' }), 'in.png')
  const res = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST', headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` }, body: form,
  })
  const j = await res.json()
  if (!res.ok) { console.error(`  FAILED ${name}:`, JSON.stringify(j).slice(0, 200)); return false }
  fs.writeFileSync(`.legaudit/gen/${name}.png`, Buffer.from(j.data[0].b64_json, 'base64'))
  console.log(`  ✔ ${name}`); return true
}

const KEEP = `Keep the EXACT same character: a weathered older man with wild gray hair, gray stubble, a ragged ` +
  `tan canvas work jacket over a torn shirt, dark worn trousers and heavy scuffed boots. Same gritty ` +
  `photorealistic style, same size and proportions, FULL SIDE PROFILE facing right, plain flat light gray ` +
  `background, no ground shadow, no text. `

const RUN = 'public/siege/poor_run1.png'
const ATK = 'public/siege/poor_atk.png'

console.log('▶ the Poor — 4 run in-betweens + 3 swing frames')
await edit('poor_run3', KEEP + 'Same sprint, new frame: PASSING position mid-stride — torso upright over the hips, ' +
  'both knees bent crossing under the body, one foot planted flat below the hips, the other heel lifting behind.', RUN)
await edit('poor_run4', KEEP + 'Same sprint, new frame: PUSH-OFF drive — back leg fully extended pushing off the toes ' +
  'behind, front knee driving up high, torso leaning hard into the sprint, fists pumping.', RUN)
await edit('poor_run5', KEEP + 'Same sprint, new frame: AIRBORNE full flight — leaning forward, BOTH feet clearly off ' +
  'the ground, front leg reaching far forward, back leg trailing bent behind.', RUN)
await edit('poor_run6', KEEP + 'Same sprint, new frame: GATHERED stance — all four limbs coming in under the body ' +
  'between strides, knees bent, compact.', RUN)
await edit('poor_atk2', KEEP + 'He swings the SAME long wooden plank: MID-SWING — the plank sweeping forward at ' +
  'shoulder height, arms extended, torso rotating into the blow, teeth bared.', ATK)
await edit('poor_atk3', KEEP + 'He swings the SAME long wooden plank: FOLLOW-THROUGH — the plank fully swung through, ' +
  'pointing forward and down, torso twisted, front knee deep after the hit.', ATK)
await edit('poor_atk4', KEEP + 'He holds the SAME long wooden plank: RECOVERING — pulling the plank back up toward his ' +
  'shoulder into a ready stance, weight shifting back, elbows bending.', ATK)
console.log('DONE')
