// Give town halls a home for bots: for each hall (MN/WI + biggest metros
// first), create an OPEN clique per party named after the town and move a
// couple of bots into it, so players see a joinable, populated local clique.
// Uses only bots that aren't already in a clique (leaves player cliques be).
//
// Usage: node scripts/bot_cliques.mjs
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const envText = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const env = Object.fromEntries(envText.split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const BOTS_PER_CLIQUE = 2

// Load gyms (page past 1000)
const gyms = []
for (let p = 0; p < 10; p++) {
  const { data } = await sb.from('gyms').select('id, city_name, state, population').order('id').range(p * 1000, p * 1000 + 999)
  if (!data?.length) break
  gyms.push(...data)
  if (data.length < 1000) break
}
// priority: MN, then WI, then by population
const rank = g => (g.state === 'MN' ? 0 : g.state === 'WI' ? 1 : 2)
gyms.sort((a, b) => rank(a) - rank(b) || (b.population ?? 0) - (a.population ?? 0))

// Free bots (not already in a clique), split by party
const { data: allBots } = await sb.from('profiles')
  .select('id, party, username, clique_id').like('clerk_user_id', 'bot%')
const free = { democrat: [], republican: [] }
for (const b of allBots ?? []) if (!b.clique_id && free[b.party]) free[b.party].push(b)
// shuffle each pool
for (const k of ['democrat', 'republican']) free[k].sort(() => Math.random() - 0.5)
console.log(`free bots: ${free.democrat.length} dem, ${free.republican.length} rep`)

// Existing hall cliques so we don't duplicate
const { data: existing } = await sb.from('cliques').select('id, gym_id, party')
const have = new Set((existing ?? []).map(c => `${c.gym_id}|${c.party}`))

const NAME = { democrat: 'Blue', republican: 'Red' }
let created = 0, placed = 0

for (const g of gyms) {
  if (free.democrat.length === 0 && free.republican.length === 0) break
  for (const party of ['democrat', 'republican']) {
    const pool = free[party]
    if (pool.length < BOTS_PER_CLIQUE) continue
    if (have.has(`${g.id}|${party}`)) continue
    const crew = pool.splice(0, BOTS_PER_CLIQUE)
    const { data: clique, error } = await sb.from('cliques').insert({
      name: `${NAME[party]} — ${g.city_name}`,
      gym_id: g.id,
      party,
      creator_id: crew[0].id,
      join_policy: 'open',
    }).select('id').single()
    if (error) { console.error(`${g.city_name} ${party}:`, error.message); continue }
    created++
    for (const b of crew) {
      await sb.from('profiles').update({ clique_id: clique.id }).eq('id', b.id)
      placed++
    }
  }
}
console.log(`created ${created} open hall cliques, placed ${placed} bots`)
