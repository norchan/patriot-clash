import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const envText = fs.readFileSync('c:/Users/Micha/patriot-clash/.env.local', 'utf8')
const env = Object.fromEntries(
  envText.split('\n')
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] })
)

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

// What state values do existing gyms use? (reveals the enum's label format)
const { data: gyms, error } = await sb.from('gyms').select('id, city_name, state, holder_party, defense_points, latitude, longitude')
if (error) { console.error('gyms query error:', error); process.exit(1) }

console.log('total existing gyms:', gyms.length)
console.log('distinct states:', JSON.stringify([...new Set(gyms.map(g => g.state))]))
console.log('sample rows:', JSON.stringify(gyms.slice(0, 5), null, 1))

// Does a location column exist / is it populated? Try selecting it.
const { data: locTest, error: locErr } = await sb.from('gyms').select('id, location').limit(2)
console.log('location column:', locErr ? `ERROR: ${locErr.message}` : JSON.stringify(locTest))

// Profiles party format
const { data: profs } = await sb.from('profiles').select('party').limit(5)
console.log('party samples:', JSON.stringify([...new Set((profs ?? []).map(p => p.party))]))
