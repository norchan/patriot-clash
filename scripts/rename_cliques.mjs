// Rename all bot cliques to clever, unique, city-tied partisan faction names,
// e.g. "Anoka Freedom Caucus", "Minneapolis Rainbow Coalition". Names stay on
// the political-faction theme (not ethnic groups) and are globally unique.
//
// Usage: node scripts/rename_cliques.mjs
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const env = Object.fromEntries(
  fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const DEM = [
  'Progressive Caucus', 'Rainbow Coalition', 'Blue Wave', 'Green New Dealers', 'Union Hall',
  'The Resistance', 'Pride Alliance', 'Justice Democrats', 'Grassroots Collective', 'Working Families',
  'Climate Crew', "People's Front", 'Sunrise Movement', 'Latte Liberals', 'Ballot Brigade',
  'Hope & Change', 'Progressive Pack', 'The Blue Front', 'Coffee Shop Caucus', 'Town Green Democrats',
]
const REP = [
  'MAGA Patriots', 'Freedom Caucus', 'Tea Party', 'Silent Majority', 'Red Wave',
  'Liberty Brigade', 'Second Amendment Sons', 'Grand Old Guard', 'Faith & Flag', 'Constitution Club',
  'Minutemen', 'Heartland Coalition', 'Main Street GOP', 'Freedom Riders', 'Patriot Front',
  'Eagle Squad', 'Red State Rebels', 'Liberty Bells', 'The Right Stuff', 'Flag & Family',
]

// bot ids (to identify bot-created cliques)
const { data: bots } = await sb.from('profiles').select('id').like('clerk_user_id', 'bot%')
const botSet = new Set((bots ?? []).map(b => b.id))

// all cliques + their city
const { data: cliques } = await sb.from('cliques').select('id, party, gym_id, creator_id')
const gymIds = [...new Set((cliques ?? []).map(c => c.gym_id).filter(Boolean))]
const cityByGym = {}
for (let i = 0; i < gymIds.length; i += 300) {
  const { data } = await sb.from('gyms').select('id, city_name').in('id', gymIds.slice(i, i + 300))
  for (const g of data ?? []) cityByGym[g.id] = g.city_name
}

const targets = (cliques ?? []).filter(c => botSet.has(c.creator_id) && c.gym_id)
const used = new Set()
const cursor = {} // `${gym}|${party}` -> next faction index
let renamed = 0

for (const c of targets) {
  const city = cityByGym[c.gym_id]
  if (!city) continue
  const pool = c.party === 'democrat' ? DEM : REP
  const key = `${c.gym_id}|${c.party}`
  let idx = cursor[key] ?? 0
  let name = ''
  // find a faction that yields a globally-unique name
  {
    // "Faction — City" keeps the app's town-hall link (it splits on " — ")
    const faction = pool[idx % pool.length]
    let candidate = `${faction} — ${city}`
    let n = 2
    while (used.has(candidate)) candidate = `${faction} ${n++} — ${city}`
    name = candidate
    idx = idx + 1
  }
  cursor[key] = idx
  used.add(name)
  const { error } = await sb.from('cliques').update({ name }).eq('id', c.id)
  if (error) console.error(c.id, error.message)
  else renamed++
}
console.log(`renamed ${renamed} cliques`)
