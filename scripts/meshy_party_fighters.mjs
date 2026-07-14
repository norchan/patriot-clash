// Rebuild the 6 fighters in BOTH party colors (blue=dem, red=rep) as rigged +
// animated 3D models. Each variant gets: stance (Combat_Stance idle, action 89),
// punch (straight, 210), jabL (191), hit (178).
// Resumable — skips a variant whose final _hit.glb already exists.
// Run in background: node scripts/meshy_party_fighters.mjs
import { spawnSync } from 'child_process'
import fs from 'fs'

const IDS = ['fighter1', 'fighter2', 'fighter3', 'fighter4', 'fighter5', 'fighter6']
const PARTIES = ['dem', 'rep']
const ACTIONS = '89:stance,210:punch,191:jabL,178:hit'
const results = { done: [], failed: [] }

for (const id of IDS) {
  for (const party of PARTIES) {
    const tag = `${id}_${party}`
    if (fs.existsSync(`public/models/${tag}_hit.glb`)) { console.log(`SKIP (exists): ${tag}`); continue }
    const image = `public/fighters/${tag}.png`
    if (!fs.existsSync(image)) { console.log(`SKIP (no art): ${tag}`); results.failed.push(tag); continue }
    console.log(`\n========== ${tag} ==========`)
    const r = spawnSync('node', ['scripts/meshy_pipeline.mjs', image, tag, ACTIONS], { stdio: 'inherit' })
    if (r.status === 0) results.done.push(tag)
    else { results.failed.push(tag); console.log(`!! ${tag} FAILED (continuing)`) }
    console.log(`party-fighters progress: done=${results.done.length} failed=${results.failed.length}`)
  }
}
console.log('\n===== PARTY FIGHTERS COMPLETE =====\n' + JSON.stringify(results, null, 2))
