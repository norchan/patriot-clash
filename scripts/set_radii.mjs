// Sets each hall's battle radius based on local density (nearest-neighbor
// distance), so metro clusters automatically get small circles:
//   neighbor <  8 mi  -> 2.5 mi radius (5-mi diameter)  — dense metro
//   neighbor < 15 mi  -> 5   mi radius (10-mi diameter) — suburban ring
//   otherwise         -> 10  mi radius (20-mi diameter) — standalone city
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const envText = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const env = Object.fromEntries(
  envText.split('\n')
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] })
)
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

// Fetch ALL halls (paginated past the 1,000-row cap)
const halls = []
for (let from = 0; ; from += 1000) {
  const { data, error } = await sb.from('gyms')
    .select('id, city_name, state, latitude, longitude')
    .range(from, from + 999)
  if (error) { console.error(error); process.exit(1) }
  halls.push(...data)
  if (data.length < 1000) break
}
console.log(`halls loaded: ${halls.length}`)

function miles(a, b) {
  const R = 3958.8
  const dLat = (b.latitude - a.latitude) * Math.PI / 180
  const dLng = (b.longitude - a.longitude) * Math.PI / 180
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * Math.PI / 180) * Math.cos(b.latitude * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

const buckets = { 2.5: [], 5: [], 10: [] }
for (const h of halls) {
  let nn = Infinity
  for (const o of halls) {
    if (o.id === h.id) continue
    const d = miles(h, o)
    if (d < nn) nn = d
  }
  const radius = nn < 8 ? 2.5 : nn < 15 ? 5 : 10
  buckets[radius].push(h.id)
}
console.log(`radius 2.5mi: ${buckets[2.5].length}, 5mi: ${buckets[5].length}, 10mi: ${buckets[10].length}`)

for (const [radius, ids] of Object.entries(buckets)) {
  for (let i = 0; i < ids.length; i += 100) {
    const { error } = await sb.from('gyms')
      .update({ radius_miles: Number(radius) })
      .in('id', ids.slice(i, i + 100))
    if (error) { console.error(`radius ${radius} update failed:`, error.message); process.exit(1) }
  }
  console.log(`updated ${ids.length} halls to ${radius} mi radius`)
}
console.log('done')
