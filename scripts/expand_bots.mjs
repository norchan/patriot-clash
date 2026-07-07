import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
const envText = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const env = Object.fromEntries(envText.split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const R_PRE = ['Liberty','Eagle','Patriot','Freedom','RedRock','Cowboy','Frontier','OldGlory','Musket','Homestead']
const R_NAME = ['Hank','Dale','Rex','June','Tex','Grace','Otis','Wanda','Buck','Mae']
const D_PRE = ['BlueWave','Progress','Union','Metro','Green','Canvass','Turnout','Coastal','Civic','Grassroot']
const D_NAME = ['Betty','Joe','Pam','Carl','Mia','Cindy','Paul','Tara','Drew','Nina']

const bots = []
let r = 0, d = 0
for (const pre of R_PRE) for (const n of R_NAME) bots.push({ clerk_user_id: `bot_r${String(++r + 10).padStart(3, '0')}`, username: `${pre}${n}`, party: 'republican', fp_balance: 5000 })
for (const pre of D_PRE) for (const n of D_NAME) bots.push({ clerk_user_id: `bot_d${String(++d + 10).padStart(3, '0')}`, username: `${pre}${n}`, party: 'democrat', fp_balance: 5000 })

const { data: existing } = await sb.from('profiles').select('clerk_user_id, username').like('clerk_user_id', 'bot\_%')
const haveIds = new Set((existing ?? []).map(b => b.clerk_user_id))
const haveNames = new Set((existing ?? []).map(b => b.username))

let created = 0
for (const b of bots) {
  if (haveIds.has(b.clerk_user_id) || haveNames.has(b.username)) continue
  const { error } = await sb.from('profiles').insert(b)
  if (error) console.log(`${b.username}: ${error.message}`)
  else created++
}
const { count } = await sb.from('profiles').select('id', { count: 'exact', head: true }).like('clerk_user_id', 'bot\_%')
console.log(`new bots created: ${created}, total bots: ${count}`)
