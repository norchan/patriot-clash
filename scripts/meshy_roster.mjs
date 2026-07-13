// Batch-generate rigged+animated 3D models for the whole humanoid roster via
// scripts/meshy_pipeline.mjs. Resumable (skips any character whose _throw.glb
// already exists) and continues past per-character failures.
// Run in background: node scripts/meshy_roster.mjs
import { spawnSync } from 'child_process'
import fs from 'fs'

// [prefix (== enemy.id), source image]. eagle is skipped (non-humanoid → rig fails)
const ROSTER = [
  ['oil_baron', 'public/enemies/republican/oil_baron.png'],
  ['cowboy', 'public/enemies/republican/cowboy.png'],
  ['politician', 'public/enemies/republican/politician.png'],
  ['hick', 'public/enemies/republican/hick.png'],
  ['ice_agent', 'public/enemies/republican/ice_agent.png'],
  ['soldier_boy', 'public/enemies/republican/soldier_boy.png'],
  ['preppy', 'public/enemies/republican/preppy.png'],
  ['influencer', 'public/enemies/republican/influencer.png'],
  ['billionaire', 'public/enemies/republican/billionaire.png'],
  ['crazy_liberal', 'public/enemies/democrat/crazy_liberal.png'],
  ['crying_liberal', 'public/enemies/democrat/crying_liberal.png'],
  ['dem_politician', 'public/enemies/democrat/politician_dems.png'],
  ['purple_hair', 'public/enemies/democrat/purple_hair.png'],
  ['protestor', 'public/enemies/democrat/protestor.png'],
  ['anchor', 'public/enemies/democrat/anchor.png'],
  ['palestine', 'public/enemies/democrat/palestine.png'],
  ['drag', 'public/enemies/democrat/drag.png'],
  ['senator', 'public/enemies/democrat/senator.png'],
]

const results = { done: [], failed: [], skipped: [] }
for (const [prefix, image] of ROSTER) {
  if (fs.existsSync(`public/models/${prefix}_throw.glb`)) { console.log(`SKIP (exists): ${prefix}`); results.skipped.push(prefix); continue }
  if (!fs.existsSync(image)) { console.log(`SKIP (no art): ${prefix}`); results.failed.push(prefix); continue }
  console.log(`\n========== ${prefix} ==========`)
  const r = spawnSync('node', ['scripts/meshy_pipeline.mjs', image, prefix, '0:idle,421:throw'], { stdio: 'inherit' })
  if (r.status === 0) results.done.push(prefix)
  else { results.failed.push(prefix); console.log(`!! ${prefix} FAILED (continuing)`) }
  console.log(`progress: done=${results.done.length} failed=${results.failed.length} skipped=${results.skipped.length}`)
}
console.log('\n================ ROSTER COMPLETE ================')
console.log(JSON.stringify(results, null, 2))
