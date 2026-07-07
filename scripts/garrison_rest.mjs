// Finishes garrisoning halls the first pass missed (Supabase API caps reads
// at 1,000 rows). Loops until no unclaimed halls remain, then prints a real
// paginated count.
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const envText = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const env = Object.fromEntries(
  envText.split('\n')
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] })
)
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const { data: bots } = await sb.from('profiles').select('id, party').like('clerk_user_id', 'bot_%')

let total = 0
while (true) {
  const { data: unclaimed } = await sb.from('gyms').select('id').is('holder_id', null).limit(500)
  if (!unclaimed || unclaimed.length === 0) break
  for (let i = 0; i < unclaimed.length; i += 20) {
    const ids = unclaimed.slice(i, i + 20).map(g => g.id)
    const bot = bots[Math.floor(Math.random() * bots.length)]
    const defense = 500 + Math.floor(Math.random() * 2000)
    const { error } = await sb.from('gyms')
      .update({ holder_id: bot.id, holder_party: bot.party, defense_points: defense, held_since: new Date().toISOString() })
      .in('id', ids)
    if (error) { console.log('chunk failed:', error.message); process.exit(1) }
    total += ids.length
  }
  console.log(`garrisoned ${total} so far...`)
}
console.log(`additional halls garrisoned: ${total}`)

// Accurate counts via head-count queries (not row-capped)
async function countWhere(build) {
  const { count } = await build(sb.from('gyms').select('id', { count: 'exact', head: true }))
  return count
}
const totalHalls = await countWhere(q => q)
const rep = await countWhere(q => q.eq('holder_party', 'republican'))
const dem = await countWhere(q => q.eq('holder_party', 'democrat'))
const none = await countWhere(q => q.is('holder_id', null))
console.log(`TOTAL: ${totalHalls} halls — republican ${rep}, democrat ${dem}, unclaimed ${none}`)
