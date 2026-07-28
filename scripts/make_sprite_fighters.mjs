// SPRITE FIGHTERS (Michael 2026-07-27): promote roster characters into
// playable PvP fighters. Reads party + art straight from the enemies config,
// then runs the standard Meshy pipeline with the six-clip FIGHTER action set
// (the same clips PvpArena3D loads).
//
//   node scripts/make_sprite_fighters.mjs oil_baron cowboy purple_hair
//
// Output: public/models/<id>_<rep|dem>_{punch,jabL,kickhi,kicklo,block,hit}.glb
// Costs ~55 Meshy credits per character — check the balance before big runs.
import { spawnSync } from 'child_process'
import fs from 'fs'

const ACTIONS = '210:punch,191:jabL,218:kickhi,103:kicklo,138:block,178:hit'

// tiny parse of the enemies config (avoids a TS import in a plain .mjs)
const src = fs.readFileSync(new URL('../config/enemies.ts', import.meta.url), 'utf8')
function lookup(id) {
  const block = src.split(`id: '${id}'`)[1]
  if (!block) return null
  const image = block.match(/image:\s*'([^']+)'/)?.[1]
  const party = block.match(/party:\s*'(republican|democrat)'/)?.[1]
  return image && party ? { image: image.replace(/^\//, 'public/'), party } : null
}

const ids = process.argv.slice(2)
if (!ids.length) { console.error('usage: node scripts/make_sprite_fighters.mjs <enemyId...>'); process.exit(1) }

const done = [], skipped = [], failed = []
for (const id of ids) {
  const meta = lookup(id)
  if (!meta) { console.error(`✗ ${id}: not found in enemies config`); failed.push(id); continue }
  const suffix = meta.party === 'democrat' ? 'dem' : 'rep'
  const prefix = `${id}_${suffix}`
  if (fs.existsSync(`public/models/${prefix}_punch.glb`)) {
    console.log(`SKIP ${prefix} (already built)`); skipped.push(prefix); continue
  }
  console.log(`\n═══ ${id} → ${prefix} (${meta.party}) ═══`)
  const r = spawnSync('node', ['scripts/meshy_pipeline.mjs', meta.image, prefix, ACTIONS], { stdio: 'inherit' })
  if (r.status === 0) done.push(prefix); else failed.push(prefix)
}

console.log(`\n──────────\nbuilt: ${done.join(', ') || 'none'}`)
if (skipped.length) console.log(`skipped: ${skipped.join(', ')}`)
if (failed.length) console.log(`FAILED: ${failed.join(', ')}`)
console.log('\nNow add each to FIGHTERS in config/fighters.ts.')
