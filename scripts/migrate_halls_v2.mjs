// Migrates town halls to the metro-clustered v2 list:
//  - deletes halls not in v2 (except protected ones)
//  - inserts v2 halls that don't exist yet (Saint/St.-normalized matching)
//  - protected: NYC boroughs, DC, St. Peter MN, halls held by real players,
//    halls referenced by cliques
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const envText = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const env = Object.fromEntries(envText.split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const norm = (name, state) => `${name.replace(/^Saint /, 'St. ').toLowerCase()}|${state}`

const desired = JSON.parse(fs.readFileSync(new URL('./townhalls_v2.json', import.meta.url), 'utf8'))
const desiredKeys = new Set(desired.map(c => norm(c.name, c.state)))

// All current halls (paginated)
const halls = []
for (let from = 0; ; from += 1000) {
  const { data } = await sb.from('gyms').select('id, city_name, state, holder_id').range(from, from + 999)
  halls.push(...data)
  if (data.length < 1000) break
}
console.log('current halls:', halls.length)

// Protected sets
const PROTECT_KEYS = new Set([
  'manhattan|NY', 'brooklyn|NY', 'queens|NY', 'the bronx|NY', 'staten island|NY',
  'washington|DC', 'st. peter|MN',
])
const { data: cliqueRefs } = await sb.from('cliques').select('gym_id')
const cliqueGyms = new Set((cliqueRefs ?? []).map(c => c.gym_id).filter(Boolean))

// Real-player holders (non-bot, non-null)
const holderIds = [...new Set(halls.map(h => h.holder_id).filter(Boolean))]
const realHolderIds = new Set()
for (let i = 0; i < holderIds.length; i += 100) {
  const { data } = await sb.from('profiles').select('id, clerk_user_id').in('id', holderIds.slice(i, i + 100))
  for (const p of data ?? []) if (!p.clerk_user_id?.startsWith('bot_')) realHolderIds.add(p.id)
}

const existingKeys = new Set(halls.map(h => norm(h.city_name, h.state)))

const toDelete = halls.filter(h =>
  !desiredKeys.has(norm(h.city_name, h.state)) &&
  !PROTECT_KEYS.has(norm(h.city_name, h.state)) &&
  !cliqueGyms.has(h.id) &&
  !(h.holder_id && realHolderIds.has(h.holder_id))
)
const toInsert = desired.filter(c => !existingKeys.has(norm(c.name, c.state)))

console.log(`deleting: ${toDelete.length}, inserting: ${toInsert.length}`)

// Delete children first, then the halls, in chunks
for (let i = 0; i < toDelete.length; i += 100) {
  const ids = toDelete.slice(i, i + 100).map(h => h.id)
  await sb.from('defense_items').delete().in('gym_id', ids)
  await sb.from('gym_challenges').delete().in('gym_id', ids)
  const { error } = await sb.from('gyms').delete().in('id', ids)
  if (error) { console.error('delete chunk failed:', error.message); process.exit(1) }
  process.stdout.write(`\rdeleted ${Math.min(i + 100, toDelete.length)}/${toDelete.length}`)
}
console.log('')

// Insert new halls
let inserted = 0
const failures = []
for (let i = 0; i < toInsert.length; i += 100) {
  const batch = toInsert.slice(i, i + 100).map(c => ({
    city_name: c.name, county: c.county, state: c.state, population: c.pop,
    latitude: c.lat, longitude: c.lng, defense_points: 0, radius_miles: 5,
    location: `SRID=4326;POINT(${c.lng} ${c.lat})`,
  }))
  const { error } = await sb.from('gyms').insert(batch)
  if (error) {
    for (const row of batch) {
      const { error: rowErr } = await sb.from('gyms').insert(row)
      if (rowErr) failures.push(`${row.city_name}, ${row.state}: ${rowErr.message}`)
      else inserted++
    }
  } else inserted += batch.length
  process.stdout.write(`\rinserted ${inserted}/${toInsert.length}`)
}
console.log(`\nfailures: ${failures.length}`)
failures.slice(0, 10).forEach(f => console.log('  FAIL:', f))

const { count } = await sb.from('gyms').select('id', { count: 'exact', head: true })
console.log('total halls now:', count)
