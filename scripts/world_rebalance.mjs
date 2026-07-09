// World rebalance:
//  1. All HUMAN players reset to level 1 (win/loss counters zeroed)
//  2. Bots get modest believable records (0-6 wins => levels 1-4, a few
//     losses) — they now level up only by actually winning fights
//  3. Bots' total_gyms_captured synced to the halls they actually hold
//  4. Bots form local cliques at bot-held town halls (creator = the holder),
//     2-4 same-party members each — most bots end up in one
//  5. Same-party held halls get +500 defense per local clique (affiliation)
//
// Usage: node scripts/world_rebalance.mjs
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const envText = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const env = Object.fromEntries(envText.split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const rnd = s => { let h = 0; for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0; return Math.abs(h) / 2147483647 }

// ── 1. Reset humans to level 1 ──────────────────────────────────────────────
const { data: humans } = await sb.from('profiles')
  .select('id, username')
  .not('clerk_user_id', 'like', 'bot\\_%')
for (const h of humans ?? []) {
  await sb.from('profiles').update({ total_battles_won: 0, total_battles_lost: 0 }).eq('id', h.id)
}
console.log(`humans reset to level 1: ${humans?.length ?? 0}`)

// ── 2+3. Bot records ────────────────────────────────────────────────────────
const { data: bots } = await sb.from('profiles')
  .select('id, username, party, clique_id')
  .like('clerk_user_id', 'bot\\_%')

// live hall counts per holder
const holds = {}
for (let from = 0; ; from += 1000) {
  const { data } = await sb.from('gyms').select('id, holder_id, holder_party, defense_points, city_name').not('holder_id', 'is', null).range(from, from + 999)
  if (!data?.length) break
  for (const g of data) holds[g.holder_id] = (holds[g.holder_id] ?? 0) + 1
  if (data.length < 1000) break
}

for (const b of bots) {
  const wins = Math.floor(rnd(b.id + 'w') * 7)          // 0-6 => levels 1-4
  const losses = 1 + Math.floor(rnd(b.id + 'l') * 8)    // 1-8
  await sb.from('profiles').update({
    total_battles_won: wins,
    total_battles_lost: losses,
    total_gyms_captured: holds[b.id] ?? 0,
  }).eq('id', b.id)
}
console.log(`bots given records: ${bots.length}`)

// ── 4. Bot cliques at bot-held halls ────────────────────────────────────────
const R_NAMES = ['Main Street Patriots', 'Eagle Squad', 'Red Wave Club', 'Freedom Crew', 'Heartland Heroes', 'Liberty League', 'Back the Red', 'Boots & Ballots']
const D_NAMES = ['Blue Wave Collective', 'Union Hall Crew', 'Progress Posse', 'Grassroots Gang', 'The Canvassers', 'Civic Squad', 'Neighbors for Change', 'Forward Together']

// all bot-held halls
const botIds = new Set(bots.map(b => b.id))
const heldHalls = []
for (let from = 0; ; from += 1000) {
  const { data } = await sb.from('gyms').select('id, city_name, holder_id, holder_party, defense_points').not('holder_id', 'is', null).range(from, from + 999)
  if (!data?.length) break
  for (const g of data) if (botIds.has(g.holder_id)) heldHalls.push(g)
  if (data.length < 1000) break
}

// existing cliques (skip halls that already have one)
const { data: existingCliques } = await sb.from('cliques').select('gym_id')
const hasClique = new Set((existingCliques ?? []).map(c => c.gym_id))

// unassigned bots per party as the membership pool
const pool = { republican: bots.filter(b => b.party === 'republican' && !b.clique_id), democrat: bots.filter(b => b.party === 'democrat' && !b.clique_id) }
for (const p of Object.values(pool)) p.sort((a, b) => rnd(a.id) - rnd(b.id))

// deterministic hall order, ~66 cliques or until bots run out
heldHalls.sort((a, b) => rnd(a.id) - rnd(b.id))
let created = 0, memberships = 0, defBumps = 0
for (const hall of heldHalls) {
  if (hasClique.has(hall.id)) continue
  const party = hall.holder_party
  if (!party || pool[party].length < 2) continue
  if (created >= 66) break

  // holder is the creator if still unassigned; otherwise first pool bot
  let members = []
  const holderIdx = pool[party].findIndex(b => b.id === hall.holder_id)
  if (holderIdx >= 0) members.push(pool[party].splice(holderIdx, 1)[0])
  const extra = Math.min(pool[party].length, 1 + Math.floor(rnd(hall.id + 'm') * 3)) // 1-3 more
  members.push(...pool[party].splice(0, extra))
  if (members.length < 2) { pool[party].push(...members); continue }

  const names = party === 'republican' ? R_NAMES : D_NAMES
  const name = `${names[Math.floor(rnd(hall.id + 'n') * names.length)]} — ${hall.city_name}`

  const { data: clique, error } = await sb.from('cliques')
    .insert({ name, gym_id: hall.id, party, creator_id: members[0].id })
    .select().single()
  if (error) { console.log(`clique at ${hall.city_name}: ${error.message}`); pool[party].push(...members); continue }

  for (const m of members) {
    const { error: mErr } = await sb.from('profiles').update({ clique_id: clique.id }).eq('id', m.id)
    if (!mErr) memberships++
  }
  created++

  // 5. affiliation bonus: hall is held by the same party as its new clique
  const { error: dErr } = await sb.from('gyms')
    .update({ defense_points: Math.min(10000, (hall.defense_points ?? 0) + 500) })
    .eq('id', hall.id)
  if (!dErr) defBumps++
}

console.log(`cliques created: ${created}, bot memberships: ${memberships}, +500 defense applied to: ${defBumps} halls`)
