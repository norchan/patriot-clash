import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
const envText = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const env = Object.fromEntries(envText.split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const { error: cErr } = await sb.from('cliques').select('id').limit(1)
console.log('cliques table:', cErr ? `MISSING/ERROR: ${cErr.message}` : 'OK')
const { error: pErr } = await sb.from('profile_posts').select('id').limit(1)
console.log('profile_posts table:', pErr ? `MISSING/ERROR: ${pErr.message}` : 'OK')
const { error: aErr } = await sb.from('profiles').select('avatar_url, clique_id').limit(1)
console.log('profiles columns:', aErr ? `MISSING/ERROR: ${aErr.message}` : 'OK')
