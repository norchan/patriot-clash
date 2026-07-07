import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
const envText = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const env = Object.fromEntries(envText.split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

function seededRand(seed) { let h = 0; for (let i = 0; i < seed.length; i++) h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0; return Math.abs(h) / 2147483647 }

const { data: bots } = await sb.from('profiles').select('id, username, party, fighter').like('clerk_user_id', 'bot\_%')
console.log(`bots: ${bots.length}`)

let done = 0, fail = 0
for (const bot of bots) {
  const g = bot.fighter?.gender
  // male->men, female->women, trans->seeded either; keeps face gender ~matching the fighter
  const pool = g === 'male' ? 'men' : g === 'female' ? 'women' : (seededRand(bot.id + 'x') < 0.5 ? 'men' : 'women')
  const idx = Math.floor(seededRand(bot.id + pool) * 100) // 0-99
  const url = `https://randomuser.me/api/portraits/${pool}/${idx}.jpg`

  try {
    const resp = await fetch(url)
    if (!resp.ok) { fail++; continue }
    const buf = Buffer.from(await resp.arrayBuffer())
    const path = `${bot.id}.jpg`
    const { error: upErr } = await sb.storage.from('avatars').upload(path, buf, { contentType: 'image/jpeg', upsert: true })
    if (upErr) { console.log(`${bot.username}: ${upErr.message}`); fail++; continue }
    const { data: pub } = sb.storage.from('avatars').getPublicUrl(path)
    await sb.from('profiles').update({ avatar_url: `${pub.publicUrl}?v=3` }).eq('id', bot.id)
    done++
    if (done % 25 === 0) process.stdout.write(`\r${done}/${bots.length}`)
  } catch (e) { console.log(`${bot.username}: ${e.message}`); fail++ }
}
console.log(`\nfaces assigned: ${done}, failed: ${fail}`)
