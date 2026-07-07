import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
const envText = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const env = Object.fromEntries(envText.split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const { data: human } = await sb.from('profiles').select('id, username, party').not('clerk_user_id', 'like', 'bot\_%').limit(1).single()
const { data: bot } = await sb.from('profiles').select('id, username, party').like('clerk_user_id', 'bot\_%').neq('party', human.party).limit(1).single()
console.log('human:', human.username, '| bot:', bot.username)

// 1. Can we insert a challenge with status 'resolving'?
const { data: ch, error: insErr } = await sb.from('pvp_challenges').insert({
  challenger_id: human.id, defender_id: bot.id,
  challenger_username: human.username, defender_username: bot.username,
  challenger_party: human.party, defender_party: bot.party,
  fp_stake: 50, status: 'resolving',
  expires_at: new Date(Date.now() + 60000).toISOString(),
}).select().single()

if (insErr) { console.log('INSERT with resolving FAILED:', insErr.message); process.exit(0) }
console.log('insert resolving: OK')

// 2. Can we update battle_log with the new FightLog object + status completed?
const { error: updErr } = await sb.from('pvp_challenges').update({
  status: 'completed', winner_id: human.id,
  challenger_hp_remaining: 50, defender_hp_remaining: 0, turns_played: 5,
  battle_log: { version: 2, duration: 30, events: [], winner: 'c', endedBy: 'ko', endT: 10, cLevel: 1, dLevel: 3, cFighter: {}, dFighter: {} },
}).eq('id', ch.id)
console.log('update completed + FightLog:', updErr ? `FAILED: ${updErr.message}` : 'OK')

// cleanup
await sb.from('pvp_challenges').delete().eq('id', ch.id)
console.log('test row cleaned up')
