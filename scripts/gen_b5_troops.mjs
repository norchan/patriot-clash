// Base Crown Jewel B5 (Grok 2026-08-16): densify EVERY raid troop + the
// defender doberman to the siege bar — run 3→6, attack 2→4. Each new frame
// is an edit-chain from that unit's cached original (identity first, per
// unit style preserved), generated with native transparent background.
// Resumable: finished frames are skipped on re-run.
//   node scripts/gen_b5_troops.mjs
import fs from 'fs'

const env = Object.fromEntries(
  fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))

const UNITS = [
  'dem_picket_captain', 'dem_longshoreman', 'dem_drum_circle', 'dem_street_medic', 'dem_latte_slinger',
  'rep_minuteman', 'rep_big_rig', 'rep_pyro_patriot', 'rep_buck_hunter', 'rep_revival_preacher',
]

const KEEP = `Keep the EXACT same character — same face, same outfit, same weapon/prop, same art style, same ` +
  `colors and lighting, same proportions and size — FULL SIDE PROFILE facing right. TRANSPARENT background, ` +
  `no ground shadow, no text. `

const RUN_POSES = [
  ['run4', 'PASSING position mid-stride: torso upright over the hips, both knees bent crossing under the body, one foot planted flat bearing weight, the other heel lifting behind.'],
  ['run5', 'AIRBORNE full flight: leaning forward, BOTH feet clearly off the ground, front leg reaching far forward, back leg trailing bent behind.'],
  ['run6', 'PUSH-OFF drive: back leg fully extended pushing off the toes behind, front knee driving up high, torso leaning into the sprint.'],
]

// source for each edit: cached original if present, else the live PNG
const srcFor = (name) => {
  const cached = `.legaudit/gen/${name}.png`
  if (fs.existsSync(cached)) return cached
  return `public/troops/anim/${name}.png`
}

async function edit(outName, prompt, fromName) {
  const out = `.legaudit/gen/b5/${outName}.png`
  if (fs.existsSync(out)) { console.log(`  · ${outName} (done)`); return true }
  const src = srcFor(fromName)
  if (!fs.existsSync(src)) { console.error(`  MISSING SOURCE for ${outName}: ${src}`); return false }
  const form = new FormData()
  form.append('model', 'gpt-image-1')
  form.append('prompt', prompt)
  form.append('size', '1024x1024')
  form.append('quality', 'high')
  form.append('background', 'transparent')
  form.append('input_fidelity', 'high')
  form.append('image', new Blob([fs.readFileSync(src)], { type: 'image/png' }), 'in.png')
  const res = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST', headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` }, body: form,
  })
  const j = await res.json()
  if (!res.ok) { console.error(`  FAILED ${outName}:`, JSON.stringify(j).slice(0, 180)); return false }
  fs.mkdirSync('.legaudit/gen/b5', { recursive: true })
  fs.writeFileSync(out, Buffer.from(j.data[0].b64_json, 'base64'))
  console.log(`  ✔ ${outName}`)
  return true
}

console.log('▶ B5 troop densify — 10 troops + doberman, 5 new frames each')
for (const u of UNITS) {
  for (const [f, pose] of RUN_POSES) await edit(`${u}_${f}`, `${KEEP} Same sprint, new frame: ${pose}`, `${u}_run1`)
  await edit(`${u}_atk3`, `${KEEP} Attack frame: the strike swung fully THROUGH — arms/weapon extended forward ` +
    `past the contact point, torso twisted into the follow-through, front knee deep.`, `${u}_atk2`)
  await edit(`${u}_atk4`, `${KEEP} Attack frame: RECOVERING after the strike — pulling arms/weapon back toward a ` +
    `ready stance, weight shifting back.`, `${u}_atk1`)
}
// the defender dog gallops + bites at the same bar (mirrors the K-9 pass)
const DOGKEEP = `Keep the EXACT same dog — a RED DOBERMAN PINSCHER, glossy rust-red mahogany coat with tan ` +
  `markings, cropped ears, docked tail, black collar — same painterly style, colors, size, FULL SIDE PROFILE ` +
  `facing right. TRANSPARENT background, no ground shadow, no text. `
for (const [f, pose] of [
  ['run4', 'CONTACT — both front paws touching down under the chest, rear legs trailing behind, body stretched low.'],
  ['run5', 'FULL FLIGHT extension — ALL FOUR paws clearly off the ground, body stretched long.'],
  ['run6', 'PUSH-OFF — rear paws planted driving off the ground, front legs lifting and folding, back arched.'],
]) await edit(`doberman_${f}`, `${DOGKEEP} Same gallop, new frame: ${pose}`, 'doberman_run1')
await edit('doberman_atk3', `${DOGKEEP} Attack frame: SNAPPING BITE — jaws wide open mid-snap lunging forward and low, teeth bared, NOTHING in his mouth, front paws planted wide.`, 'doberman_atk2')
await edit('doberman_atk4', `${DOGKEEP} Attack frame: RECOILING after the bite — head pulling back up, jaws open mid-snarl, weight shifting to the rear legs.`, 'doberman_atk1')
console.log('DONE')
