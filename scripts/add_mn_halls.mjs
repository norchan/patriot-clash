// One-off: add 11 Minnesota town halls (metro south + I-90 corridor +
// greater MN), matching the seeded halls exactly, each garrisoned by a
// random bot like seed_all.mjs does. Skips any that already exist.
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const envText = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const env = Object.fromEntries(envText.split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const HALLS = [
  { city_name: 'Lakeville',     county: 'Dakota',    population: 69490, latitude: 44.6497, longitude: -93.2428 },
  { city_name: 'Jordan',        county: 'Scott',     population: 6656,  latitude: 44.6669, longitude: -93.6272 },
  { city_name: 'Spring Park',   county: 'Hennepin',  population: 1734,  latitude: 44.9355, longitude: -93.6322 },
  { city_name: 'New Prague',    county: 'Scott',     population: 8162,  latitude: 44.5433, longitude: -93.5761 },
  // I-90 corridor
  { city_name: 'Blue Earth',    county: 'Faribault', population: 3984,  latitude: 43.6375, longitude: -94.1022 },
  { city_name: 'Fairmont',      county: 'Martin',    population: 10505, latitude: 43.6522, longitude: -94.4614 },
  { city_name: 'Worthington',   county: 'Nobles',    population: 13947, latitude: 43.6199, longitude: -95.5964 },
  // greater MN
  { city_name: 'Detroit Lakes', county: 'Becker',    population: 9869,  latitude: 46.8172, longitude: -95.8453 },
  { city_name: 'Bemidji',       county: 'Beltrami',  population: 14574, latitude: 47.4716, longitude: -94.8827 },
  { city_name: 'Brainerd',      county: 'Crow Wing', population: 14395, latitude: 46.3580, longitude: -94.2008 },
  { city_name: 'Marshall',      county: 'Lyon',      population: 13628, latitude: 44.4469, longitude: -95.7884 },
]

const { data: bots } = await sb.from('profiles').select('id, party, username').like('clerk_user_id', 'bot\\_%')

for (const h of HALLS) {
  const { data: existing } = await sb.from('gyms').select('id').eq('city_name', h.city_name).eq('state', 'MN')
  if (existing?.length) { console.log(`skip ${h.city_name} (exists)`); continue }

  const hall = {
    ...h,
    state: 'MN',
    defense_points: 0,
    radius_miles: 5,
    location: `SRID=4326;POINT(${h.longitude} ${h.latitude})`,
  }
  const { data: gym, error } = await sb.from('gyms').insert(hall).select().single()
  if (error) { console.error(`${h.city_name} insert failed:`, error.message); continue }

  const bot = bots[Math.floor(Math.random() * bots.length)]
  const defense = 500 + Math.floor(Math.random() * 2000)
  const { error: garErr } = await sb.from('gyms')
    .update({ holder_id: bot.id, holder_party: bot.party, defense_points: defense, held_since: new Date().toISOString() })
    .eq('id', gym.id)
  if (garErr) { console.error(`${h.city_name} garrison failed:`, garErr.message); continue }
  console.log(`${h.city_name}, MN — ${bot.username} (${bot.party}), ${defense} defense`)
}
console.log('done')
