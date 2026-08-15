// Siege checklist #5 (Grok 2026-08-15): densify the K-9 Unit.
// Gallop 3→6, bite 2→4. Chained from the CACHED shepherd originals
// (.legaudit/gen/k9_*.png) so the same black-and-tan GSD carries through.
//   node scripts/gen_k9_frames.mjs
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

const KEEP = `Keep the EXACT same dog: a black-and-tan GERMAN SHEPHERD with the classic saddle coat, black muzzle ` +
  `mask, tall upright ears (pinned back while running), wearing the SAME dark tactical K-9 vest harness with the ` +
  `small gold star badge. Same painterly mobile-game style, same colors and warm lighting, same size and ` +
  `proportions, FULL SIDE PROFILE facing right, plain flat light gray background, no ground shadow, no motion ` +
  `streaks, no text. `

console.log('▶ K-9 — 3 gallop in-betweens + 2 bite frames')
await edit('k9_run4', KEEP + 'Same gallop, new frame: CONTACT — both front paws touching down under the chest, ' +
  'rear legs still trailing behind, body stretched low.', 'k9_run1')
await edit('k9_run5', KEEP + 'Same gallop, new frame: FULL FLIGHT extension — ALL FOUR paws clearly off the ground, ' +
  'body stretched out long, front legs reaching far forward, rear legs extended far back.', 'k9_run1')
await edit('k9_run6', KEEP + 'Same gallop, new frame: PUSH-OFF — rear paws planted driving off the ground, ' +
  'front legs lifting and folding, back arched, launching forward.', 'k9_run1')
await edit('k9_atk3', KEEP + 'Attack frame: BITE CONNECTED — jaws CLAMPED SHUT on the target ahead, head driven ' +
  'forward and low, front paws planted wide, shoulders bunched, tail high.', 'k9_atk2')
await edit('k9_atk4', KEEP + 'Attack frame: RECOILING after the bite — head pulling back up, jaws open mid-snarl, ' +
  'weight shifting to the rear legs, ready to lunge again.', 'k9_atk1')
console.log('DONE')
