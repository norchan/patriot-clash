import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
const envText = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const env = Object.fromEntries(envText.split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const halls = []
for (let from = 0; ; from += 1000) {
  const { data } = await sb.from('gyms').select('id, city_name, state, latitude, longitude').range(from, from + 999)
  halls.push(...data)
  if (data.length < 1000) break
}
console.log('total:', halls.length)

// Normalize "Saint X" and "St. X" to the same key, then find collisions
const norm = n => n.replace(/^Saint /, 'St. ').replace(/^Ste\.? /, 'Ste. ').toLowerCase()
const byKey = {}
for (const h of halls) {
  const k = `${norm(h.city_name)}|${h.state}`
  ;(byKey[k] ||= []).push(h)
}
for (const [k, v] of Object.entries(byKey)) {
  if (v.length > 1) console.log('DUPE:', k, '→', v.map(h => `${h.city_name} (${h.id.slice(0,8)})`).join(' | '))
}
