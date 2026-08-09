// Raid troop FLIPBOOKS (Michael 2026-08-09: "I want troops to be animated...
// just like the clash of clans soldiers"). For each of the 10 troop types:
// 3 run frames + 2 attack frames, edit-chained from the troop's existing art
// so the character stays identical. Same chain recipe that held for the siege
// antifa/marshal flipbooks.
//
//   node scripts/gen_troop_frames.mjs             (all)
//   node scripts/gen_troop_frames.mjs rep_minuteman dem_street_medic
import fs from 'fs'

const env = Object.fromEntries(
  fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))

const STYLE = `Painterly mobile-game character sprite, hand-painted texture with clean dark outlines, `
  + `slightly toy-like proportions, warm light from the upper left. FULL BODY in SIDE PROFILE facing RIGHT, `
  + `whole body including feet inside the frame, plain flat light gray background (#cfcfcf), no text, no watermark.`

const TROOPS = [
  'rep_minuteman', 'rep_buck_hunter', 'rep_big_rig', 'rep_pyro_patriot', 'rep_revival_preacher',
  'dem_picket_captain', 'dem_latte_slinger', 'dem_longshoreman', 'dem_drum_circle', 'dem_street_medic',
]

// step 1 converts the 3/4 standing pose to a side-profile sprint; the rest
// chain off that so the character can't drift
const CHAIN = [
  ['run1', `Redraw this EXACT character as a ${'' /* keep prompt one piece */}full-body SIDE PROFILE facing RIGHT, `
    + `sprinting at full speed mid-stride — right leg forward, arms pumping, gear and weapon kept. `
    + `Same face, same outfit, same colors, same painterly style.`, null],
  ['run2', `Same EXACT character, same style and size, still sprinting to the right but on the OPPOSITE stride: `
    + `left leg forward, right leg trailing, arms swapped. Change nothing else.`, 'run1'],
  ['run3', `Same EXACT character, same style and size, sprinting to the right in a passing stance: both legs `
    + `close under the body mid-stride, one heel lifting. Change nothing else.`, 'run1'],
  ['atk1', `Same EXACT character, same style and size, now PLANTED facing right winding up a big attack with `
    + `their signature weapon or gear — arms drawn back, knees bent, ready to strike. Change nothing else.`, 'run1'],
  ['atk2', `Same EXACT character, same style and size, mid-STRIKE — the attack whipping forward toward the right `
    + `with motion streaks, weight on the front foot. Change nothing else.`, 'atk1'],
]

fs.mkdirSync('.legaudit/gen', { recursive: true })

async function edit(outName, prompt, inputPath) {
  const form = new FormData()
  form.append('model', 'gpt-image-1')
  form.append('prompt', `${prompt} ${STYLE}`)
  form.append('size', '1024x1024')
  form.append('quality', 'high')
  form.append('image', new Blob([fs.readFileSync(inputPath)], { type: 'image/png' }), 'in.png')
  const res = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST', headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` }, body: form,
  })
  const j = await res.json()
  if (!res.ok) { console.error(`  FAILED ${outName}:`, JSON.stringify(j).slice(0, 200)); return false }
  fs.writeFileSync(`.legaudit/gen/${outName}.png`, Buffer.from(j.data[0].b64_json, 'base64'))
  console.log(`  ✔ ${outName}`)
  return true
}

const only = process.argv.slice(2)
for (const id of TROOPS) {
  if (only.length && !only.includes(id)) continue
  console.log(`▶ ${id}`)
  for (const [suffix, prompt, from] of CHAIN) {
    const out = `${id}_${suffix}`
    if (fs.existsSync(`.legaudit/gen/${out}.png`)) { console.log(`  skip ${out} (exists)`); continue }
    const input = from ? `.legaudit/gen/${id}_${from}.png` : `public/troops/${id}.png`
    if (!fs.existsSync(input)) { console.error(`  missing input ${input}`); break }
    const ok = await edit(out, prompt, input)
    if (!ok && !from) break // base failed — no point chaining
  }
}
console.log('DONE')
