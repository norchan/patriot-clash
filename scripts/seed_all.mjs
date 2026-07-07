// Seeds town halls (from townhalls.json) and bot holders directly through
// the Supabase API — no SQL editor needed. Requires add_states.sql to have
// been run once first (enum values can't be added via the API).
//
// Usage: node scripts/seed_all.mjs
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const envText = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const env = Object.fromEntries(
  envText.split('\n')
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] })
)
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

// ── 1. Town halls ───────────────────────────────────────────────────────────
const cities = JSON.parse(fs.readFileSync(new URL('./townhalls.json', import.meta.url), 'utf8'))

const { data: existing, error: exErr } = await sb.from('gyms').select('city_name, state')
if (exErr) { console.error('cannot read gyms:', exErr); process.exit(1) }
const have = new Set(existing.map(g => `${g.city_name}|${g.state}`))

const toInsert = cities
  .filter(c => !have.has(`${c.name}|${c.state}`))
  .map(c => ({
    city_name: c.name,
    county: c.county,
    state: c.state,
    population: c.pop,
    latitude: c.lat,
    longitude: c.lng,
    defense_points: 0,
    location: `SRID=4326;POINT(${c.lng} ${c.lat})`,
  }))

console.log(`existing halls: ${existing.length}, new to insert: ${toInsert.length}`)

let inserted = 0
const failures = []
for (let i = 0; i < toInsert.length; i += 100) {
  const batch = toInsert.slice(i, i + 100)
  const { error } = await sb.from('gyms').insert(batch)
  if (error) {
    // Retry row-by-row so one bad row doesn't sink the batch
    for (const row of batch) {
      const { error: rowErr } = await sb.from('gyms').insert(row)
      if (rowErr) failures.push(`${row.city_name}, ${row.state}: ${rowErr.message}`)
      else inserted++
    }
  } else {
    inserted += batch.length
  }
  process.stdout.write(`\rinserted ${inserted}/${toInsert.length}`)
}
console.log(`\nhalls inserted: ${inserted}, failures: ${failures.length}`)
failures.slice(0, 10).forEach(f => console.log('  FAIL:', f))

// ── 2. Bot profiles ─────────────────────────────────────────────────────────
const BOTS = [
  ['bot_r01', 'EagleEyeEd', 'republican'], ['bot_r02', 'LibertyLou', 'republican'],
  ['bot_r03', 'RedStateRex', 'republican'], ['bot_r04', 'FreedomFrank', 'republican'],
  ['bot_r05', 'CowboyCal', 'republican'], ['bot_r06', 'PatriotPete', 'republican'],
  ['bot_r07', 'TexasTina', 'republican'], ['bot_r08', 'GritGrace', 'republican'],
  ['bot_r09', 'OilBaronOtis', 'republican'], ['bot_r10', 'MidwestMack', 'republican'],
  ['bot_d01', 'BlueWaveBetty', 'democrat'], ['bot_d02', 'ProgressivePam', 'democrat'],
  ['bot_d03', 'UnionJoe', 'democrat'], ['bot_d04', 'CoastalCarl', 'democrat'],
  ['bot_d05', 'GreenGwen', 'democrat'], ['bot_d06', 'MetroMia', 'democrat'],
  ['bot_d07', 'CanvassCindy', 'democrat'], ['bot_d08', 'PolicyPaul', 'democrat'],
  ['bot_d09', 'TurnoutTara', 'democrat'], ['bot_d10', 'DonkeyDrew', 'democrat'],
]

const { data: existingBots } = await sb.from('profiles').select('id, clerk_user_id, party').like('clerk_user_id', 'bot_%')
const haveBots = new Set((existingBots ?? []).map(b => b.clerk_user_id))

for (const [cid, username, party] of BOTS) {
  if (haveBots.has(cid)) continue
  const { error } = await sb.from('profiles').insert({ clerk_user_id: cid, username, party, fp_balance: 5000 })
  if (error) console.log(`bot ${username} insert failed: ${error.message}`)
}
const { data: bots } = await sb.from('profiles').select('id, party, username').like('clerk_user_id', 'bot_%')
console.log(`bots ready: ${bots.length}`)

// ── 3. Garrison every unclaimed hall with a random bot ─────────────────────
const { data: unclaimed } = await sb.from('gyms').select('id').is('holder_id', null)
console.log(`unclaimed halls to garrison: ${unclaimed.length}`)

// Shuffle, then assign in chunks — each chunk gets one random bot and one
// random defense value (500-2,500)
for (let i = unclaimed.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1))
  ;[unclaimed[i], unclaimed[j]] = [unclaimed[j], unclaimed[i]]
}

const CHUNK = 20
let garrisoned = 0
for (let i = 0; i < unclaimed.length; i += CHUNK) {
  const ids = unclaimed.slice(i, i + CHUNK).map(g => g.id)
  const bot = bots[Math.floor(Math.random() * bots.length)]
  const defense = 500 + Math.floor(Math.random() * 2000)
  const { error } = await sb.from('gyms')
    .update({ holder_id: bot.id, holder_party: bot.party, defense_points: defense, held_since: new Date().toISOString() })
    .in('id', ids)
  if (error) console.log(`garrison chunk failed: ${error.message}`)
  else garrisoned += ids.length
  process.stdout.write(`\rgarrisoned ${garrisoned}/${unclaimed.length}`)
}

// ── Summary ─────────────────────────────────────────────────────────────────
const { data: final } = await sb.from('gyms').select('holder_party')
const counts = {}
for (const g of final) counts[g.holder_party ?? 'unclaimed'] = (counts[g.holder_party ?? 'unclaimed'] || 0) + 1
console.log('\nfinal map split:', JSON.stringify(counts), `(${final.length} total halls)`)
