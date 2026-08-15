// Siege checklist #3 (Grok 2026-08-14): densify free-troop animation.
// Antifa Kids + Marshals: run 3→6 frames, attack 2→4 frames. Edit-chained
// from the CACHED originals in .legaudit/gen so the character stays the
// same person across every new frame.
//   node scripts/gen_troop_frames.mjs
import fs from 'fs'

const env = Object.fromEntries(
  fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))

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

const KEEP = `Keep the EXACT same character, art style, proportions and size, full side profile facing right, ` +
  `plain flat light gray background (#cfcfcf), no text, no ground shadow.`

// Three run in-betweens per unit — the classic cycle beats the 3-frame set skips
const RUN_POSES = [
  ['run4', `PASSING position mid-stride: torso upright over the hips, both knees bent crossing under the body, ` +
    `one foot planted flat directly below the hips bearing weight, the other heel lifting up behind. Arms half-pumped.`],
  ['run5', `AIRBORNE full flight: leaning forward, BOTH feet clearly off the ground, front leg reaching far forward, ` +
    `back leg trailing bent behind, arms pumping hard.`],
  ['run6', `PUSH-OFF drive: back leg fully extended pushing off the toes behind, front knee driving up high in front, ` +
    `torso leaning into the sprint.`],
]

console.log('▶ antifa kid — 3 run in-betweens + 2 attack frames')
for (const [f, pose] of RUN_POSES) await edit(`antifa_${f}`, `${KEEP} Same sprint, new frame: ${pose}`, 'antifa_run1')
await edit('antifa_atk3', `${KEEP} Attack frame: the wooden stick swung fully THROUGH the strike — arms extended forward ` +
  `and low, stick pointing forward-down having just connected, torso twisted into the follow-through, front knee deep.`, 'antifa_atk2')
await edit('antifa_atk4', `${KEEP} Attack frame: RECOVERING after a swing — pulling the wooden stick back up toward the ` +
  `shoulder into a ready guard, weight shifting back, elbows bending.`, 'antifa_atk1')

console.log('▶ marshal — 3 run in-betweens + 2 attack frames')
for (const [f, pose] of RUN_POSES) await edit(`marshal_${f}`, `${KEEP} Same sprint, new frame: ${pose}`, 'marshal_run1')
await edit('marshal_atk3', `${KEEP} Attack frame: the black baton swung fully THROUGH the strike — arm extended forward ` +
  `and low, baton pointing forward-down having just connected, torso twisted into the follow-through, front knee deep.`, 'marshal_atk2')
await edit('marshal_atk4', `${KEEP} Attack frame: RECOVERING after a swing — pulling the black baton back up beside the ` +
  `shoulder into a ready guard, weight shifting back, elbow bending.`, 'marshal_atk1')

console.log('DONE')
