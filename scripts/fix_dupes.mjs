import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
const envText = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const env = Object.fromEntries(envText.split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const pairs = [
  { keepName: 'Saint Peter', dropName: 'St. Peter', state: 'MN', newName: 'St. Peter' },
  { keepName: 'Saint Paul',  dropName: 'St. Paul',  state: 'MN', newName: 'St. Paul' },
]

for (const p of pairs) {
  const { data: keepRow } = await sb.from('gyms').select('id, city_name').eq('city_name', p.keepName).eq('state', p.state).single()
  const { data: dropRow } = await sb.from('gyms').select('id, city_name').eq('city_name', p.dropName).eq('state', p.state).single()
  if (!keepRow || !dropRow) { console.log('pair not found', p.keepName); continue }

  const { data: moved } = await sb.from('cliques').update({ gym_id: keepRow.id }).eq('gym_id', dropRow.id).select('id')
  if (moved?.length) console.log(`moved ${moved.length} clique(s) off the ${p.dropName} dupe`)

  const { error: delErr } = await sb.from('gyms').delete().eq('id', dropRow.id)
  if (delErr) { console.log('delete failed:', delErr.message); continue }

  const { error: renErr } = await sb.from('gyms').update({ city_name: p.newName }).eq('id', keepRow.id)
  console.log(`kept '${p.keepName}' -> renamed '${p.newName}', deleted dupe`, renErr ? `RENAME ERR: ${renErr.message}` : 'OK')
}

const { count } = await sb.from('gyms').select('id', { count: 'exact', head: true })
console.log('total halls now:', count)
