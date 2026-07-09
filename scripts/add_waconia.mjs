// One-off: add a Waconia, MN town hall, matching the seeded halls exactly,
// and garrison it with a random bot like seed_all.mjs does.
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const envText = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const env = Object.fromEntries(envText.split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const hall = {
  city_name: 'Waconia',
  county: 'Carver',
  state: 'MN',
  population: 13033,
  latitude: 44.8508,
  longitude: -93.7866,
  defense_points: 0,
  radius_miles: 5,
  location: 'SRID=4326;POINT(-93.7866 44.8508)',
}

// Skip if it already exists
const { data: existing } = await sb.from('gyms').select('id, holder_party').eq('city_name', 'Waconia').eq('state', 'MN')
if (existing?.length) {
  console.log('Waconia hall already exists:', existing[0])
  process.exit(0)
}

const { data: gym, error } = await sb.from('gyms').insert(hall).select().single()
if (error) { console.error('insert failed:', error.message); process.exit(1) }
console.log('hall created:', gym.id)

// Garrison with a random bot, defense 500-2500 (same as seed_all.mjs)
const { data: bots } = await sb.from('profiles').select('id, party, username').like('clerk_user_id', 'bot\\_%')
const bot = bots[Math.floor(Math.random() * bots.length)]
const defense = 500 + Math.floor(Math.random() * 2000)

const { error: garErr } = await sb.from('gyms')
  .update({ holder_id: bot.id, holder_party: bot.party, defense_points: defense, held_since: new Date().toISOString() })
  .eq('id', gym.id)
if (garErr) { console.error('garrison failed:', garErr.message); process.exit(1) }

console.log(`Waconia, MN garrisoned by ${bot.username} (${bot.party}) with ${defense} defense`)
