import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
const envText = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const env = Object.fromEntries(envText.split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const { data: bot } = await sb.from('profiles').select('id, username, party, avatar_url, fighter').like('clerk_user_id', 'bot\_%').limit(1).single()
console.log(JSON.stringify({ username: bot.username, party: bot.party, avatar: !!bot.avatar_url, fighter: bot.fighter }, null, 1))
const { data: posts } = await sb.from('profile_posts').select('content, created_at').eq('profile_id', bot.id)
console.log('posts:', posts.map(p => p.content))
const { count } = await sb.from('profile_posts').select('id', { count: 'exact', head: true })
console.log('total posts in feed system:', count)
