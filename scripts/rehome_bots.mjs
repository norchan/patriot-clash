// Give every bot a single HOME town hall and a clique AT that hall, so a bot
// shown in a hall's circle is always in a local clique. Prioritizes St. Peter
// + Mankato + the rest of MN, then WI, then by population.
//
//   1. sign all bots out of cliques, delete old bot-created cliques
//   2. assign ~6 dem + ~6 rep bots as residents of each priority hall
//   3. per hall/party, a few bots create local cliques, the rest join them
//
// Usage: node scripts/rehome_bots.mjs
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const env = Object.fromEntries(
  fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const PER_PARTY = 6           // resident bots per party per hall
const PER_CLIQUE = 3          // members per clique (so ~2 cliques/party/hall)
const ST_PETER = '71f74104-8867-49f4-acb7-598aa3617e00'
const MANKATO = 'aa5a51fb-829e-4390-b4c7-c3dc6fab16d6'
const shuffle = a => a.sort(() => Math.random() - 0.5)
const NAME = { democrat: 'Blue', republican: 'Red' }

// ── load gyms + bots ─────────────────────────────────────────────────────
const gyms = []
for (let p = 0; p < 10; p++) {
  const { data } = await sb.from('gyms').select('id, city_name, state, population').order('id').range(p * 1000, p * 1000 + 999)
  if (!data?.length) break
  gyms.push(...data)
  if (data.length < 1000) break
}
const rank = g => (g.id === ST_PETER ? -2 : g.id === MANKATO ? -1 : g.state === 'MN' ? 0 : g.state === 'WI' ? 1 : 2)
gyms.sort((a, b) => rank(a) - rank(b) || (b.population ?? 0) - (a.population ?? 0))

const { data: bots } = await sb.from('profiles').select('id, party').like('clerk_user_id', 'bot%')
const pool = { democrat: shuffle((bots ?? []).filter(b => b.party === 'democrat').map(b => b.id)),
               republican: shuffle((bots ?? []).filter(b => b.party === 'republican').map(b => b.id)) }
console.log(`bots: ${pool.democrat.length} dem, ${pool.republican.length} rep`)

// ── 1. reset: sign all bots out, delete old bot cliques ──────────────────
const botIds = (bots ?? []).map(b => b.id)
const { data: oldCliques } = await sb.from('cliques').select('id').in('creator_id', botIds)
const oldIds = (oldCliques ?? []).map(c => c.id)
await sb.from('profiles').update({ clique_id: null, clique_pending_id: null }).like('clerk_user_id', 'bot%')
for (let i = 0; i < oldIds.length; i += 100) {
  const chunk = oldIds.slice(i, i + 100)
  await sb.from('profiles').update({ clique_id: null }).in('clique_id', chunk)
  await sb.from('profiles').update({ clique_pending_id: null }).in('clique_pending_id', chunk)
  await sb.from('clique_posts').delete().in('clique_id', chunk)
  await sb.from('cliques').delete().in('id', chunk)
}
console.log(`deleted ${oldIds.length} old bot cliques`)

// ── 2. assign homes ──────────────────────────────────────────────────────
const homes = [] // { hall, dem:[ids], rep:[ids] }
for (const g of gyms) {
  if (pool.democrat.length === 0 && pool.republican.length === 0) break
  const dem = pool.democrat.splice(0, PER_PARTY)
  const rep = pool.republican.splice(0, PER_PARTY)
  if (dem.length + rep.length === 0) continue
  homes.push({ hall: g, dem, rep })
}
for (const { hall, dem, rep } of homes) {
  const ids = [...dem, ...rep]
  for (let i = 0; i < ids.length; i += 200)
    await sb.from('profiles').update({ home_gym_id: hall.id }).in('id', ids.slice(i, i + 200))
}
console.log(`homed bots across ${homes.length} halls`)

// ── 3. create local cliques per hall/party + assign members ──────────────
let created = 0, placed = 0
for (const { hall, dem, rep } of homes) {
  for (const [party, members] of [['democrat', dem], ['republican', rep]]) {
    for (let i = 0; i < members.length; i += PER_CLIQUE) {
      const group = members.slice(i, i + PER_CLIQUE)
      if (!group.length) continue
      const suffix = members.length > PER_CLIQUE ? ` ${Math.floor(i / PER_CLIQUE) + 1}` : ''
      const { data: clique, error } = await sb.from('cliques').insert({
        name: `${NAME[party]}${suffix} — ${hall.city_name}`,
        gym_id: hall.id, party, creator_id: group[0], join_policy: 'open',
      }).select('id').single()
      if (error) { console.error(hall.city_name, party, error.message); continue }
      created++
      await sb.from('profiles').update({ clique_id: clique.id }).in('id', group)
      placed += group.length
    }
  }
}
console.log(`created ${created} local cliques, placed ${placed} bots`)
