// One-off: add 25 Wisconsin town halls — the top populated cities, with the
// Milwaukee and Madison metros capped at 5 halls each, chosen to spread
// their 5-mile circles across the metro (center + compass points) rather
// than stack downtown. Bot-garrisoned like seed_all.mjs.
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const envText = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const env = Object.fromEntries(envText.split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const HALLS = [
  // ── standalone cities (15) ────────────────────────────────────────────────
  { city_name: 'Green Bay',       county: 'Brown',       population: 107395, latitude: 44.5133, longitude: -88.0133 },
  { city_name: 'Kenosha',         county: 'Kenosha',     population: 99986,  latitude: 42.5847, longitude: -87.8212 },
  { city_name: 'Racine',          county: 'Racine',      population: 77816,  latitude: 42.7261, longitude: -87.7829 },
  { city_name: 'Appleton',        county: 'Outagamie',   population: 75644,  latitude: 44.2619, longitude: -88.4154 },
  { city_name: 'Eau Claire',      county: 'Eau Claire',  population: 69421,  latitude: 44.8113, longitude: -91.4985 },
  { city_name: 'Oshkosh',         county: 'Winnebago',   population: 66816,  latitude: 44.0247, longitude: -88.5426 },
  { city_name: 'Janesville',      county: 'Rock',        population: 65615,  latitude: 42.6828, longitude: -89.0187 },
  { city_name: 'La Crosse',       county: 'La Crosse',   population: 52680,  latitude: 43.8014, longitude: -91.2396 },
  { city_name: 'Sheboygan',       county: 'Sheboygan',   population: 49929,  latitude: 43.7508, longitude: -87.7145 },
  { city_name: 'Fond du Lac',     county: 'Fond du Lac', population: 44678,  latitude: 43.7730, longitude: -88.4470 },
  { city_name: 'Wausau',          county: 'Marathon',    population: 39994,  latitude: 44.9591, longitude: -89.6301 },
  { city_name: 'Beloit',          county: 'Rock',        population: 36657,  latitude: 42.5083, longitude: -89.0318 },
  { city_name: 'Manitowoc',       county: 'Manitowoc',   population: 34626,  latitude: 44.0886, longitude: -87.6576 },
  { city_name: 'Superior',        county: 'Douglas',     population: 26751,  latitude: 46.7208, longitude: -92.1041 },
  { city_name: 'Stevens Point',   county: 'Portage',     population: 25666,  latitude: 44.5236, longitude: -89.5746 },
  // ── Milwaukee metro (5): center, W, NW, SW, SE ───────────────────────────
  { city_name: 'Milwaukee',       county: 'Milwaukee',   population: 577222, latitude: 43.0389, longitude: -87.9065 },
  { city_name: 'Waukesha',        county: 'Waukesha',    population: 71158,  latitude: 43.0117, longitude: -88.2315 },
  { city_name: 'Menomonee Falls', county: 'Waukesha',    population: 38527,  latitude: 43.1789, longitude: -88.1173 },
  { city_name: 'Franklin',        county: 'Milwaukee',   population: 36816,  latitude: 42.8886, longitude: -88.0384 },
  { city_name: 'Oak Creek',       county: 'Milwaukee',   population: 36497,  latitude: 42.8859, longitude: -87.8630 },
  // ── Madison metro (5): center, NE, W, S, SE ──────────────────────────────
  { city_name: 'Madison',         county: 'Dane',        population: 269840, latitude: 43.0731, longitude: -89.4012 },
  { city_name: 'Sun Prairie',     county: 'Dane',        population: 35967,  latitude: 43.1836, longitude: -89.2137 },
  { city_name: 'Middleton',       county: 'Dane',        population: 21827,  latitude: 43.0972, longitude: -89.5043 },
  { city_name: 'Fitchburg',       county: 'Dane',        population: 29609,  latitude: 42.9861, longitude: -89.4251 },
  { city_name: 'Stoughton',       county: 'Dane',        population: 13173,  latitude: 42.9169, longitude: -89.2179 },
]

const { data: bots } = await sb.from('profiles').select('id, party, username').like('clerk_user_id', 'bot\\_%')

for (const h of HALLS) {
  const { data: existing } = await sb.from('gyms').select('id').eq('city_name', h.city_name).eq('state', 'WI')
  if (existing?.length) { console.log(`skip ${h.city_name} (exists)`); continue }

  const hall = {
    ...h,
    state: 'WI',
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
  console.log(`${h.city_name}, WI — ${bot.username} (${bot.party}), ${defense} defense`)
}
console.log('done')
