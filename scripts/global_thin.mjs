// GLOBAL thinning: enforce "no two circles overlap anywhere" — hall centers
// must be ≥ MIN_SPACING apart (2 × 5mi radius). Population-priority greedy:
// biggest city of any overlapping cluster survives. Protected (never
// removed): halls with cliques, human-held halls, and ALL of Minnesota
// (hand-tuned by the operator).
//
// Usage: node scripts/global_thin.mjs [--dry]
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const envText = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const env = Object.fromEntries(envText.split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const dry = process.argv.includes('--dry')

const MIN_SPACING = 9.9 // miles; 10 = circles exactly touch

const miles = (a, b) => {
  const dLat = (a.latitude - b.latitude) * 69
  const dLng = (a.longitude - b.longitude) * 69 * Math.cos(((a.latitude + b.latitude) / 2) * Math.PI / 180)
  return Math.hypot(dLat, dLng)
}

// ── Load world ───────────────────────────────────────────────────────────────
const gyms = []
for (let page = 0; page < 10; page++) {
  const { data } = await sb.from('gyms').select('id, city_name, state, latitude, longitude, population, holder_id').order('id').range(page * 1000, page * 1000 + 999)
  if (!data?.length) break
  gyms.push(...data.map(g => ({ ...g, latitude: Number(g.latitude), longitude: Number(g.longitude), population: Number(g.population ?? 0) })))
  if (data.length < 1000) break
}
console.log(`${gyms.length} halls loaded`)

const { data: cliqueGyms } = await sb.from('cliques').select('gym_id')
const cliqueSet = new Set((cliqueGyms ?? []).map(c => c.gym_id))
const holderIds = [...new Set(gyms.map(g => g.holder_id).filter(Boolean))]
const humans = new Set()
for (let i = 0; i < holderIds.length; i += 150) {
  const { data } = await sb.from('profiles').select('id, clerk_user_id').in('id', holderIds.slice(i, i + 150))
  ;(data ?? []).forEach(p => { if (!(p.clerk_user_id ?? '').startsWith('bot')) humans.add(p.id) })
}
const isProtected = g => g.state === 'MN' || cliqueSet.has(g.id) || (g.holder_id && humans.has(g.holder_id))

// ── Spatial grid so the greedy pass is O(n·neighbors) ───────────────────────
const CELL = 0.25 // deg ≈ 17mi
const key = g => `${Math.floor(g.latitude / CELL)}:${Math.floor(g.longitude / CELL)}`
const grid = new Map()
const addToGrid = g => {
  const k = key(g)
  if (!grid.has(k)) grid.set(k, [])
  grid.get(k).push(g)
}
const neighbors = g => {
  const clat = Math.floor(g.latitude / CELL), clng = Math.floor(g.longitude / CELL)
  const out = []
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
    const cell = grid.get(`${clat + a}:${clng + b}`)
    if (cell) out.push(...cell)
  }
  return out
}

const removals = []
// protected halls are pre-kept
gyms.filter(isProtected).forEach(addToGrid)
for (const g of gyms.filter(g => !isProtected(g)).sort((a, b) => b.population - a.population)) {
  if (neighbors(g).some(k => miles(g, k) < MIN_SPACING)) removals.push(g)
  else addToGrid(g)
}

console.log(`remove ${removals.length}, keep ${gyms.length - removals.length}`)
const byState = {}
removals.forEach(r => { byState[r.state] = (byState[r.state] ?? 0) + 1 })
console.log('removals by state:', Object.entries(byState).sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s}:${n}`).join(' '))

if (dry) process.exit(0)

let done = 0
for (const g of removals) {
  const { data: posts } = await sb.from('hall_posts').select('id').eq('gym_id', g.id).limit(1000)
  const ids = (posts ?? []).map(p => p.id)
  for (let i = 0; i < ids.length; i += 100) {
    await sb.from('hall_comments').delete().in('post_id', ids.slice(i, i + 100))
  }
  await sb.from('hall_posts').delete().eq('gym_id', g.id)
  const { error } = await sb.from('gyms').delete().eq('id', g.id)
  if (error) console.error(`FAILED ${g.city_name}, ${g.state}: ${error.message}`)
  done++
  if (done % 50 === 0) console.log(`${done}/${removals.length}`)
}
console.log(`finished: ${done} removed`)
