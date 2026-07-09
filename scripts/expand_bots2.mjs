// Adds ~200 more bots (100 per party) so town hall crews of 24 stay
// distinct even in dense metro areas. Each bot gets: political avatar from
// the storage pool, believable fight record, fighter design, and 2 posts.
//
// Usage: node scripts/expand_bots2.mjs
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const envText = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const env = Object.fromEntries(envText.split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const rnd = s => { let h = 0; for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0; return Math.abs(h) / 2147483647 }
const pick = (arr, seed) => arr[Math.floor(rnd(seed) * arr.length) % arr.length]

const R_PRE = ['Anvil', 'Buckshot', 'Crossroads', 'Dixie', 'Elkhorn', 'Flatbed', 'Gospel', 'Homestretch', 'Ironside', 'Jerky']
const R_SUF = ['Earl', 'Faye', 'Gus', 'Hattie', 'Ike', 'Jolene', 'Knox', 'Lula', 'Merle', 'Nadine']
const D_PRE = ['Ballot', 'Compost', 'Downtown', 'Equity', 'Farmers', 'Gallery', 'Headline', 'Indie', 'Justice', 'Kale']
const D_SUF = ['Aria', 'Bram', 'Cleo', 'Dev', 'Esme', 'Finn', 'Gia', 'Hugo', 'Iris', 'Jude']

const ARCH = ['brawler', 'master', 'champ', 'striker', 'guardian', 'rebel']
const GENDERS = ['male', 'female', 'trans']
const BODIES = ['skinny', 'average', 'athletic', 'fat']

const R_POSTS = [
  'Lower taxes, higher uppercuts. Come take my hall if you can. 🇺🇸',
  'Small government. BIG right hook.',
  'God, family, and a 4-hit combo.',
  'Come to the heartland and catch these hands. Respectfully.',
  'Read the Constitution between rounds. Builds stamina.',
  "Don't tread on me. Seriously, I'm right here on the map.",
  'This hall runs on faith, coffee, and elbow grease.',
  'My donation to this town hall: 1,000 FP and zero apologies.',
]
const D_POSTS = [
  'Healthcare is a right. So is this left hook. 💙',
  'This town hall believes in science AND street fighting.',
  'The blue wall stands. Try me.',
  'Climate action now — the only thing burning should be your stamina bar.',
  'Tax the rich, jab the red. Simple platform.',
  'Union-made fists. Look for the label.',
  'Hope wins. Also I win. Frequently.',
  'Went door-knocking. Stayed for the knockout.',
]

// Political avatar pool (uploaded by political_avatars.mjs)
const { data: pub } = sb.storage.from('avatars').getPublicUrl('political/x')
const base = pub.publicUrl.replace(/\/x$/, '')
const pool = party => Array.from({ length: 16 }, (_, i) => `${base}/${party}_${String(i).padStart(2, '0')}.webp?v=2`)
const POOLS = { republican: pool('republican'), democrat: pool('democrat') }

const { data: existing } = await sb.from('profiles').select('clerk_user_id, username').like('clerk_user_id', 'bot\\_%')
const haveIds = new Set((existing ?? []).map(b => b.clerk_user_id))
const haveNames = new Set((existing ?? []).map(b => b.username))

let created = 0, posts = 0
for (const party of ['republican', 'democrat']) {
  const [pres, sufs] = party === 'republican' ? [R_PRE, R_SUF] : [D_PRE, D_SUF]
  let n = 0
  for (const pre of pres) {
    for (const suf of sufs) {
      n++
      const cid = `bot_${party === 'republican' ? 'r' : 'd'}${String(n + 300).padStart(3, '0')}`
      const username = `${pre}${suf}`
      if (haveIds.has(cid) || haveNames.has(username)) continue

      const seed = cid
      const fighter = {
        archetype: pick(ARCH, seed + 'a'),
        toneShift: pick([-1, 0, 0, 0, 1], seed + 't'),
        gender: pick(GENDERS, seed + 'g'),
        body: pick(BODIES, seed + 'b'),
      }
      const { data: bot, error } = await sb.from('profiles').insert({
        clerk_user_id: cid,
        username,
        party,
        fp_balance: 5000,
        fighter,
        avatar_url: pick(POOLS[party], seed + 'av'),
        total_battles_won: Math.floor(rnd(seed + 'w') * 7),
        total_battles_lost: 1 + Math.floor(rnd(seed + 'l') * 8),
      }).select('id').single()
      if (error) { console.log(`${username}: ${error.message}`); continue }
      created++

      const poolP = party === 'republican' ? R_POSTS : D_POSTS
      const i1 = Math.floor(rnd(seed + 'p1') * poolP.length)
      let i2 = Math.floor(rnd(seed + 'p2') * poolP.length)
      if (i2 === i1) i2 = (i2 + 1) % poolP.length
      const now = Date.now()
      const { error: pErr } = await sb.from('profile_posts').insert([
        { profile_id: bot.id, content: poolP[i1], created_at: new Date(now - rnd(seed + 't1') * 6 * 86400e3).toISOString() },
        { profile_id: bot.id, content: poolP[i2], created_at: new Date(now - rnd(seed + 't2') * 2 * 86400e3).toISOString() },
      ])
      if (!pErr) posts += 2
      if (created % 25 === 0) console.log(`created ${created}...`)
    }
  }
}

const { count } = await sb.from('profiles').select('id', { count: 'exact', head: true }).like('clerk_user_id', 'bot\\_%')
console.log(`new bots: ${created}, posts: ${posts}, total bots now: ${count}`)
