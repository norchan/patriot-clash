// Convert the diverse player-fighter images into rigged 3D models (idle +
// punch) via the Meshy pipeline. Resumable + continues past failures.
// Run in background: node scripts/meshy_fighters.mjs
import { spawnSync } from 'child_process'
import fs from 'fs'

const FIGHTERS = ['fighter1', 'fighter2', 'fighter3', 'fighter4', 'fighter5', 'fighter6']
const results = { done: [], failed: [] }
for (const id of FIGHTERS) {
  if (fs.existsSync(`public/models/${id}_punch.glb`)) { console.log(`SKIP (exists): ${id}`); continue }
  const image = `public/fighters/${id}.png`
  if (!fs.existsSync(image)) { console.log(`SKIP (no art): ${id}`); results.failed.push(id); continue }
  console.log(`\n========== ${id} ==========`)
  const r = spawnSync('node', ['scripts/meshy_pipeline.mjs', image, id, '0:idle,96:punch'], { stdio: 'inherit' })
  if (r.status === 0) results.done.push(id); else { results.failed.push(id); console.log(`!! ${id} FAILED (continuing)`) }
  console.log(`fighters progress: done=${results.done.length} failed=${results.failed.length}`)
}
console.log('\n===== FIGHTERS COMPLETE =====\n' + JSON.stringify(results, null, 2))
