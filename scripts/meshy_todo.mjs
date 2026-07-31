// What Meshy work is actually left? Cross-references the enemy roster against
// the two DIFFERENT asset sets a character can need, which are easy to confuse:
//
//   SPRITE BATTLE (Enemy3D)  → <id>_idle.glb + <id>_throw.glb
//   PVP FIGHTER (PvpArena3D) → <id>_<rep|dem>.glb with six named clips
//
// A character can have one and not the other — the pastor is a playable fighter
// with no enemy rig, and several enemies have rigs but aren't playable.
//
//   node scripts/meshy_todo.mjs
import fs from 'fs'
import path from 'path'

const ROOT = process.cwd()
const M = path.join(ROOT, 'public', 'models')
const has = f => fs.existsSync(path.join(M, f))

const enemySrc = fs.readFileSync(path.join(ROOT, 'config', 'enemies.ts'), 'utf8')
const figSrc = fs.readFileSync(path.join(ROOT, 'config', 'fighters.ts'), 'utf8')

// roster: every enemy id + party + tier
const enemies = []
for (const m of enemySrc.matchAll(/id:\s*'([a-z_0-9]+)',[\s\S]{0,400}?party:\s*'(republican|democrat)',[\s\S]{0,200}?tier:\s*'(\w+)'/g)) {
  if (!enemies.some(e => e.id === m[1])) enemies.push({ id: m[1], party: m[2], tier: m[3] })
}
// Playable fighters, resolved back to their ENEMY id. These do not always
// match: The Don is fighter `don` but enemy `politician`; Tear Drop is fighter
// `teardrop` but enemy `crying_liberal`. Matching on id alone reported both as
// "not yet playable" when they have been playable for days. Map through the
// art path instead, which is the same file for both configs.
const fighters = new Set()
const fighterIdFor = new Map()   // enemy id → fighter id (they differ for don/teardrop)
for (const m of figSrc.matchAll(/id:\s*'([a-z_0-9]+)'[^}]*?img:\s*'([^']+)'[^}]*?party:\s*'(democrat|republican)'/g)) {
  const enemyId = path.basename(m[2], '.png')
  fighters.add(enemyId); fighters.add(m[1])
  fighterIdFor.set(enemyId, m[1]); fighterIdFor.set(m[1], m[1])
}
// Characters that will never be fighters — a bald eagle has no humanoid rig.
const NEVER_FIGHTER = new Set(['eagle'])
// declared 3D enemies
const decl3d = new Set([...(enemySrc.match(/ENEMY_3D_IDS[\s\S]*?\]/)?.[0] ?? '').matchAll(/'([a-z_0-9]+)'/g)].map(m => m[1]))

const CR = { fighter: 55, enemy: 41 }
const rows = []
for (const e of enemies) {
  const sfx = e.party === 'democrat' ? 'dem' : 'rep'
  const isFighter = fighters.has(e.id)
  // check under the FIGHTER id, not the enemy id — don_rep.glb, not politician_rep.glb
  const fighterModel = has(`${fighterIdFor.get(e.id) ?? e.id}_${sfx}.glb`)
  const enemyRig = has(`${e.id}_idle.glb`) && has(`${e.id}_throw.glb`)
  rows.push({ ...e, isFighter, fighterModel, enemyRig, declared3d: decl3d.has(e.id) })
}

const w = (s, n) => String(s).padEnd(n)
console.log(w('id', 22) + w('party', 6) + w('tier', 11) + w('enemy rig', 11) + 'pvp fighter')
console.log('-'.repeat(62))
for (const r of rows.sort((a, b) => a.party.localeCompare(b.party) || a.id.localeCompare(b.id))) {
  console.log(w(r.id, 22) + w(r.party.slice(0, 3), 6) + w(r.tier, 11)
    + w(r.enemyRig ? 'yes' : 'MISSING', 11)
    + (r.isFighter ? (r.fighterModel ? 'yes' : 'CONFIG BUT NO MODEL') : 'no'))
}

const needEnemyRig = rows.filter(r => !r.enemyRig && !NEVER_FIGHTER.has(r.id))
const notFighter = rows.filter(r => !r.isFighter && !NEVER_FIGHTER.has(r.id))
const byParty = p => notFighter.filter(r => r.party === p).length

console.log(`\n── WORK LEFT ─────────────────────────────────────────────`)
console.log(`Enemies with no sprite-battle rig: ${needEnemyRig.length} × ~${CR.enemy}cr = ~${needEnemyRig.length * CR.enemy}cr`)
console.log(`  ${needEnemyRig.map(r => r.id).join(', ') || 'none'}`)
console.log(`\nRoster characters not yet playable fighters: ${notFighter.length} × ~${CR.fighter}cr = ~${notFighter.length * CR.fighter}cr`)
console.log(`  republican (${byParty('republican')}): ${notFighter.filter(r => r.party === 'republican').map(r => r.id).join(', ') || 'none'}`)
console.log(`  democrat   (${byParty('democrat')}): ${notFighter.filter(r => r.party === 'democrat').map(r => r.id).join(', ') || 'none'}`)
console.log(`\nPlayable now: ${rows.filter(r => r.isFighter).length} (${rows.filter(r => r.isFighter && r.party === 'republican').length}R / ${rows.filter(r => r.isFighter && r.party === 'democrat').length}D)`)
console.log(`TOTAL to finish everything: ~${needEnemyRig.length * CR.enemy + notFighter.length * CR.fighter}cr`)
