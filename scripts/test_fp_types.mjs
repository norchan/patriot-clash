import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
const envText = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const env = Object.fromEntries(envText.split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const { data: bot } = await sb.from('profiles').select('id, username, fp_balance').like('clerk_user_id', 'bot\_%').limit(1).single()
console.log('testing on', bot.username, 'balance', bot.fp_balance)

for (const t of ['pvp_loss', 'pvp_win', 'gym_attack', 'battle_reward', 'daily_bonus']) {
  const fn = t === 'pvp_win' || t === 'battle_reward' || t === 'daily_bonus' ? 'grant_fp' : 'spend_fp'
  const { error } = await sb.rpc(fn, { p_profile_id: bot.id, p_amount: 1, p_type: t, p_reference_type: 'pvp_battle', p_description: `type test: ${t}` })
  console.log(`${fn}(${t}):`, error ? `FAIL — ${error.message}` : 'OK')
}
