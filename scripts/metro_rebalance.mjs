// Metro rebalance: thin over-stacked halls in the Chicago / Kansas City /
// Denver metros (keep the biggest city of any cluster closer than
// MIN_SPACING; never touch human-held halls or halls with cliques), then add
// curated gap-filler towns that sit clear of every surviving circle.
//
// Usage: node scripts/metro_rebalance.mjs [--dry]
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const envText = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const env = Object.fromEntries(envText.split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const dry = process.argv.includes('--dry')

const MIN_SPACING = 6.0 // miles between kept hall centers inside a metro

const BOXES = [
  { name: 'Chicago', lat: [41.4, 42.3], lng: [-88.4, -87.4] },
  { name: 'Kansas City', lat: [38.7, 39.4], lng: [-95.0, -94.2] },
  { name: 'Denver', lat: [39.4, 40.1], lng: [-105.3, -104.6] },
]

// Gap fillers (added only if ≥ MIN_SPACING from every surviving hall)
const CANDIDATES = [
  { city_name: 'Waukegan',      county: 'Lake',      state: 'IL', population: 89321, latitude: 42.3636, longitude: -87.8448 },
  { city_name: 'Woodstock',     county: 'McHenry',   state: 'IL', population: 25630, latitude: 42.3147, longitude: -88.4487 },
  { city_name: 'DeKalb',        county: 'DeKalb',    state: 'IL', population: 40290, latitude: 41.9295, longitude: -88.7504 },
  { city_name: 'Morris',        county: 'Grundy',    state: 'IL', population: 15068, latitude: 41.3573, longitude: -88.4212 },
  { city_name: 'Kankakee',      county: 'Kankakee',  state: 'IL', population: 24052, latitude: 41.1200, longitude: -87.8612 },
  { city_name: 'Gary',          county: 'Lake',      state: 'IN', population: 69093, latitude: 41.5934, longitude: -87.3464 },
  { city_name: 'Valparaiso',    county: 'Porter',    state: 'IN', population: 34154, latitude: 41.4731, longitude: -87.0611 },
  { city_name: 'Crown Point',   county: 'Lake',      state: 'IN', population: 33899, latitude: 41.4170, longitude: -87.3653 },
  { city_name: 'Bonner Springs',county: 'Wyandotte', state: 'KS', population: 7837,  latitude: 39.0617, longitude: -94.8836 },
  { city_name: 'Kearney',       county: 'Clay',      state: 'MO', population: 10404, latitude: 39.3678, longitude: -94.3622 },
  { city_name: 'Platte City',   county: 'Platte',    state: 'MO', population: 4922,  latitude: 39.3703, longitude: -94.7824 },
  { city_name: 'Oak Grove',     county: 'Jackson',   state: 'MO', population: 8760,  latitude: 39.0053, longitude: -94.1291 },
  { city_name: 'Harrisonville', county: 'Cass',      state: 'MO', population: 10077, latitude: 38.6531, longitude: -94.3488 },
  { city_name: 'Golden',        county: 'Jefferson', state: 'CO', population: 20399, latitude: 39.7555, longitude: -105.2211 },
  { city_name: 'Brighton',      county: 'Adams',     state: 'CO', population: 40083, latitude: 39.9853, longitude: -104.8206 },
  { city_name: 'Castle Rock',   county: 'Douglas',   state: 'CO', population: 73158, latitude: 39.3722, longitude: -104.8561 },
  { city_name: 'Longmont',      county: 'Boulder',   state: 'CO', population: 98630, latitude: 40.1672, longitude: -105.1019 },
]

const miles = (a, b) => {
  const dLat = (a.latitude - b.latitude) * 69
  const dLng = (a.longitude - b.longitude) * 69 * Math.cos(((a.latitude + b.latitude) / 2) * Math.PI / 180)
  return Math.hypot(dLat, dLng)
}
const inBox = (g, box) =>
  g.latitude >= box.lat[0] && g.latitude <= box.lat[1] && g.longitude >= box.lng[0] && g.longitude <= box.lng[1]

// ── Load world ───────────────────────────────────────────────────────────────
const gyms = []
for (let page = 0; page < 10; page++) {
  const { data } = await sb.from('gyms').select('id, city_name, state, latitude, longitude, population, holder_id').order('id').range(page * 1000, page * 1000 + 999)
  if (!data?.length) break
  gyms.push(...data.map(g => ({ ...g, latitude: Number(g.latitude), longitude: Number(g.longitude) })))
  if (data.length < 1000) break
}

// Protected: halls with cliques, or held by a human
const { data: cliqueGyms } = await sb.from('cliques').select('gym_id')
const cliqueSet = new Set((cliqueGyms ?? []).map(c => c.gym_id))
const holderIds = [...new Set(gyms.map(g => g.holder_id).filter(Boolean))]
const humans = new Set()
for (let i = 0; i < holderIds.length; i += 150) {
  const { data } = await sb.from('profiles').select('id, clerk_user_id').in('id', holderIds.slice(i, i + 150))
  ;(data ?? []).forEach(p => { if (!(p.clerk_user_id ?? '').startsWith('bot')) humans.add(p.id) })
}
const isProtected = g => cliqueSet.has(g.id) || (g.holder_id && humans.has(g.holder_id))

// ── Thin each metro ──────────────────────────────────────────────────────────
const removals = []
for (const box of BOXES) {
  const inMetro = gyms.filter(g => inBox(g, box))
  const kept = []
  // protected halls are pre-kept no matter what
  inMetro.filter(isProtected).forEach(g => kept.push(g))
  for (const g of inMetro.filter(g => !isProtected(g)).sort((a, b) => b.population - a.population)) {
    if (kept.some(k => miles(g, k) < MIN_SPACING)) removals.push({ ...g, metro: box.name })
    else kept.push(g)
  }
  console.log(`${box.name}: ${inMetro.length} halls -> keep ${inMetro.length - removals.filter(r => r.metro === box.name).length}, remove ${removals.filter(r => r.metro === box.name).length}`)
}

console.log('\nRemoving:', removals.map(r => `${r.city_name} ${r.state}`).join(', '))

if (!dry) {
  for (const g of removals) {
    // manual cascade: comments -> posts -> gym (bulk cascade times out)
    const { data: posts } = await sb.from('hall_posts').select('id').eq('gym_id', g.id).limit(1000)
    const ids = (posts ?? []).map(p => p.id)
    for (let i = 0; i < ids.length; i += 100) {
      await sb.from('hall_comments').delete().in('post_id', ids.slice(i, i + 100))
    }
    await sb.from('hall_posts').delete().eq('gym_id', g.id)
    const { error } = await sb.from('gyms').delete().eq('id', g.id)
    if (error) console.error(`  delete ${g.city_name} failed:`, error.message)
    else console.log(`  ✕ ${g.city_name}, ${g.state}`)
  }
}

// ── Gap fills ────────────────────────────────────────────────────────────────
const removedIds = new Set(removals.map(r => r.id))
const survivors = gyms.filter(g => !removedIds.has(g.id))
const { data: bots } = await sb.from('profiles').select('id, party, username').like('clerk_user_id', 'bot\\_%')

for (const c of CANDIDATES) {
  if (survivors.some(g => g.city_name === c.city_name && g.state === c.state)) { console.log(`skip ${c.city_name} (exists)`); continue }
  const nearest = Math.min(...survivors.map(g => miles(c, g)))
  if (nearest < MIN_SPACING) { console.log(`skip ${c.city_name}, ${c.state} (${nearest.toFixed(1)}mi from a hall)`); continue }
  console.log(`  + ${c.city_name}, ${c.state} (nearest hall ${nearest.toFixed(1)}mi)`)
  if (dry) continue
  const { data: gym, error } = await sb.from('gyms').insert({
    ...c, defense_points: 0, radius_miles: 5,
    location: `SRID=4326;POINT(${c.longitude} ${c.latitude})`,
  }).select().single()
  if (error) { console.error(`  insert ${c.city_name} failed:`, error.message); continue }
  const bot = bots[Math.floor(Math.random() * bots.length)]
  const defense = 500 + Math.floor(Math.random() * 2000)
  await sb.from('gyms').update({ holder_id: bot.id, holder_party: bot.party, defense_points: defense, held_since: new Date().toISOString() }).eq('id', gym.id)
  survivors.push({ ...c, id: gym.id })
}
console.log('done')
