// Siege feel (Grok 2026-08-22): distinct art for the FREE special + a tumble
// frame for the pitchfork. The Free troops were reusing the antifa flipbook
// verbatim — same kids, different glow. Every edit is POSE-LOCKED (input
// fidelity high, silhouette kept) so the 6-run/4-atk cycles keep working;
// only the paint changes: Statue-of-Liberty patina + a torch.
// Resumable. node scripts/gen_siege_free.mjs
import fs from 'fs'

const env = Object.fromEntries(
  fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))

async function edit(outName, srcPath, prompt) {
  const out = `.legaudit/gen/siegefree/${outName}.png`
  if (fs.existsSync(out)) { console.log(`  · ${outName} (done)`); return }
  const form = new FormData()
  form.append('model', 'gpt-image-1')
  form.append('prompt', prompt)
  form.append('size', '1024x1024')
  form.append('quality', 'high')
  form.append('background', 'transparent')
  form.append('input_fidelity', 'high')
  form.append('image', new Blob([fs.readFileSync(srcPath)], { type: 'image/png' }), 'in.png')
  const res = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST', headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` }, body: form,
  })
  const j = await res.json()
  if (!res.ok) { console.error(`  FAILED ${outName}:`, JSON.stringify(j).slice(0, 180)); return }
  fs.mkdirSync('.legaudit/gen/siegefree', { recursive: true })
  fs.writeFileSync(out, Buffer.from(j.data[0].b64_json, 'base64'))
  console.log(`  ✔ ${outName}`)
}

// EXACT palette words repeated per frame so the 10 frames stay one character
const FREE = `Repaint this EXACT character keeping the EXACT pose, proportions and silhouette: ` +
  `the black hoodie, mask and clothes become weathered VERDIGRIS COPPER-GREEN (Statue of Liberty patina, ` +
  `soft teal-green with darker green folds), and the plain wooden stick becomes a golden torch with a small ` +
  `warm YELLOW-ORANGE FLAME at its top end. Same painterly game-sprite style and outline weight as the ` +
  `source. TRANSPARENT background, no ground shadow.`

console.log('▶ siege FREE set (pose-locked patina recolor)')
for (let i = 1; i <= 6; i++) await edit(`free_run${i}`, `public/siege/antifa_run${i}.webp`, FREE)
for (let i = 1; i <= 4; i++) await edit(`free_atk${i}`, `public/siege/antifa_atk${i}.webp`, FREE)
await edit('pitchfork_b', 'public/siege/pitchfork.webp',
  `Same rusty pitchfork, same angle and silhouette, but with subtle MOTION BLUR streaking along its length ` +
  `and slightly desaturated — a fast-tumbling in-flight frame of this exact object. TRANSPARENT background.`)
console.log('DONE')
