// R1 (Michael 2026-08-17): fence re-art. The LAST holdouts from the pre-bible
// era — fence.png / fence_post.png / wall_se.png (~1.9MB of PNG) — restyled
// into the BASE_ART_BIBLE language. Every edit KEEPS THE SILHOUETTE so the
// WALL calibration can be carried old→new by mapping the documented post-base
// points through the trim-box transform (scripts/measure happens in the
// processing step, not here). Resumable. node scripts/gen_r1_fence.mjs
import fs from 'fs'

const env = Object.fromEntries(
  fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))

async function edit(outName, srcPath, prompt) {
  const out = `.legaudit/gen/r1/${outName}.png`
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
  fs.mkdirSync('.legaudit/gen/r1', { recursive: true })
  fs.writeFileSync(out, Buffer.from(j.data[0].b64_json, 'base64'))
  console.log(`  ✔ ${outName}`)
}

const KEEP = `CRITICAL: keep the EXACT silhouette, proportions, post positions, rail angles and overall ` +
  `geometry of the source image — repaint ONLY the materials, colors and lighting. TRANSPARENT background, ` +
  `no ground shadow blob.`

const STYLE = `Painterly mobile-strategy game style (Clash-of-Clans grade): warm sunlit wood planks with ` +
  `painted red-white-and-blue accents worn at the edges, galvanized steel hardware, one warm key light from ` +
  `the TOP-LEFT, soft saturated colors, crisp clean cutout edges.`

console.log('▶ R1 fence re-art')
await edit('wall_se', 'public/house/wall_se.png',
  `Restyle this diagonal isometric security-fence segment. ${STYLE} The lattice becomes sturdy crossed ` +
  `wooden boards; the two posts become thick timber posts with steel caps. ${KEEP}`)
await edit('fence', 'public/house/fence.png',
  `Restyle this front-facing security-fence panel. ${STYLE} The chain-link becomes sturdy crossed wooden ` +
  `boards between timber posts with steel caps; keep the concrete feet. ${KEEP}`)
await edit('fence_post', 'public/house/fence_post.png',
  `Restyle this single fence post. ${STYLE} It becomes a thick timber post with a steel cap. ${KEEP}`)
console.log('DONE')
