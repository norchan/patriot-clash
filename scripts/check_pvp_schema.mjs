import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
const envText = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const env = Object.fromEntries(envText.split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const { error: e1 } = await sb.from('pvp_challenges').select('battle_log').limit(1)
console.log('pvp_challenges.battle_log:', e1 ? `MISSING (${e1.message})` : 'OK')
const { error: e2 } = await sb.from('pvp_messages').select('id').limit(1)
console.log('pvp_messages table:', e2 ? `MISSING (${e2.message})` : 'OK')
const { error: e3 } = await sb.from('profiles').select('allow_pvp_messages').limit(1)
console.log('profiles.allow_pvp_messages:', e3 ? `MISSING (${e3.message})` : 'OK')
const { error: e4 } = await sb.from('profiles').select('allow_messages, show_party').limit(1)
console.log('profiles.allow_messages/show_party:', e4 ? `MISSING (${e4.message})` : 'OK')

// stuck challenges
const { data: stuck } = await sb.from('pvp_challenges').select('id, challenger_username, defender_username, fp_stake, status, created_at').in('status', ['resolving'])
console.log('stuck resolving challenges:', JSON.stringify(stuck, null, 1))
