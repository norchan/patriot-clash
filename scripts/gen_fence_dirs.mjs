// Directional fence panels for CONNECTED fences (Michael 2026-07-31: "fences
// should connect if they are next to each other"). Two variants from the
// existing panel via gpt-image-1 edits: one running toward the lower-RIGHT
// screen diagonal (the col+ iso axis), one toward the lower-LEFT (row+ axis).
// A corner cell simply draws both — they meet at the shared anchor.
import fs from 'fs'

const env = Object.fromEntries(
  fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))

const DIRS = {
  fence_se: `Redraw this metal chain-link fence panel as a painterly isometric game sprite running diagonally from the `
    + `UPPER-LEFT to the LOWER-RIGHT of the frame, foreshortened along that diagonal exactly like a wall segment on an `
    + `isometric base-builder grid. The panel spans the full diagonal so adjacent copies visually connect end-to-end. `
    + `Same clean steel chain-link and posts, one post at each end. Warm light from upper left, plain flat light gray background (#cfcfcf).`,
  fence_sw: `Redraw this metal chain-link fence panel as a painterly isometric game sprite running diagonally from the `
    + `UPPER-RIGHT to the LOWER-LEFT of the frame, foreshortened along that diagonal exactly like a wall segment on an `
    + `isometric base-builder grid. The panel spans the full diagonal so adjacent copies visually connect end-to-end. `
    + `Same clean steel chain-link and posts, one post at each end. Warm light from upper left, plain flat light gray background (#cfcfcf).`,
}

fs.mkdirSync('.legaudit/gen', { recursive: true })
for (const [name, prompt] of Object.entries(DIRS)) {
  console.log(`▶ ${name}...`)
  const form = new FormData()
  form.append('model', 'gpt-image-1')
  form.append('prompt', prompt)
  form.append('size', '1024x1024')
  form.append('quality', 'high')
  form.append('image', new Blob([fs.readFileSync('public/house/fence.png')], { type: 'image/png' }), 'fence.png')
  const res = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: form,
  })
  const j = await res.json()
  if (!res.ok) { console.error(`  FAILED ${res.status}:`, JSON.stringify(j).slice(0, 250)); continue }
  fs.writeFileSync(`.legaudit/gen/${name}.png`, Buffer.from(j.data[0].b64_json, 'base64'))
  console.log(`  ✔ .legaudit/gen/${name}.png`)
}
