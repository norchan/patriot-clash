// Occupy the whole map: create one RESIDENT bot for every town hall that has
// none, so every hall can be held by a local bot (party alternates so the map
// is balanced and flippable). Cliques + holders are assigned afterward in SQL.
//
// Usage: node scripts/occupy_all_halls.mjs
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'
import fs from 'fs'

const env = Object.fromEntries(
  fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const FIRST = ['Mike','Sara','Tom','Jen','Bill','Karen','Dave','Lisa','John','Amy','Rick','Pam','Gary','Deb','Steve','Sue','Mark','Beth','Chad','Kim','Wade','Nancy','Cole','Faith','Hank','Grace','Duke','Joy','Buck','Rose','Cliff','Dawn','Roy','Jill','Gus','Meg','Earl','Fern','Vince','Trish','Dale','Lou','Chip','Marge','Rex','Elle','Boyd','Jodi','Kurt','Tara','Brad','Cyn','Wes','Gail','Neil','Robin','Dean','Holly','Gene','Faye']
const LAST  = ['Miller','Hayes','Boone','Cross','Payne','Reed','Frye','Lott','Vance','Webb','Nash','Dole','Stark','Buck','Cole','Rhodes','Pratt','Tate','Wolfe','Case','Beck','Dunn','Ford','Gray','Hunt','Kane','Lund','Moss','Owen','Pope','Quinn','Roth','Shaw','Todd','Vaughn','West','York','Ash','Byrd','Cobb','Dorn','Estes','Finch','Goode','Hale','Ives','Jett','Knox','Lane','Marsh','Noble','Oakes','Poe','Rees','Sims','Trent','Vine','Ware','Zane','Bly']

const rand = a => a[Math.floor(Math.random() * a.length)]

async function pageAll(build) {
  const out = []
  for (let p = 0; p < 60; p++) {
    const { data } = await build(p * 1000, p * 1000 + 999)
    if (!data?.length) break
    out.push(...data)
    if (data.length < 1000) break
  }
  return out
}

// halls + which already have residents
const halls = await pageAll((f, t) => sb.from('gyms').select('id').order('id').range(f, t))
const bots = await pageAll((f, t) => sb.from('profiles').select('home_gym_id').like('clerk_user_id', 'bot%').not('home_gym_id', 'is', null).order('home_gym_id').range(f, t))
const staffed = new Set(bots.map(b => b.home_gym_id))
const empty = halls.filter(h => !staffed.has(h.id))
console.log(`halls: ${halls.length}, already staffed: ${staffed.size}, to fill: ${empty.length}`)

// unique usernames (against ALL existing profiles)
const existing = await pageAll((f, t) => sb.from('profiles').select('username').order('id').range(f, t))
const used = new Set(existing.map(u => (u.username || '').toLowerCase()))
const mkName = () => {
  for (let i = 0; i < 60; i++) {
    const base = `${rand(FIRST)}${rand(LAST)}`
    const cand = i < 30 ? base : `${base}${Math.floor(Math.random() * 900 + 100)}`
    if (!used.has(cand.toLowerCase())) { used.add(cand.toLowerCase()); return cand }
  }
  return `Patriot${Math.floor(Math.random() * 1e6)}`
}

const rows = empty.map((h, i) => ({
  clerk_user_id: `bot_gen_${randomUUID()}`,
  username: mkName(),
  party: i % 2 === 0 ? 'democrat' : 'republican',
  home_gym_id: h.id,
}))

let inserted = 0
for (let i = 0; i < rows.length; i += 500) {
  const { error } = await sb.from('profiles').insert(rows.slice(i, i + 500))
  if (error) console.error('insert error:', error.message)
  else inserted += Math.min(500, rows.length - i)
}
console.log(`created ${inserted} resident bots`)
