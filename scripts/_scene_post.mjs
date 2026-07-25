// ONE-TIME BLAST (Michael 2026-07-25): turn each bot's completed 2x3 Higgs
// scene grid into their profile content — cell 1 = secondary portrait photo
// (album), cells 2-5 = FOUR profile posts (concerts/vacation/sports/family
// for men; beach/concert/dinner/vacation for women), cell 6 = bonus album
// photo. Posts get casual captions and random timestamps over the past 60
// days. Resumable: bots that already have bot-scenes posts are skipped.
// Inputs (scratchpad): scene_roster.json, scene_jobs.json {botId: jobId},
// scene_urls.json {jobId: rawUrl}.
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import sharp from 'sharp'

const SCRATCH = 'C:/Users/Micha/AppData/Local/Temp/claude/c--Users-Micha-patriot-clash/acd84d08-0df9-435a-8904-192f5d4e95a8/scratchpad/'
const env = Object.fromEntries(readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
  .split('\n').filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]))
const supa = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const roster = JSON.parse(readFileSync(SCRATCH + 'scene_roster.json', 'utf8'))
const jobs = JSON.parse(readFileSync(SCRATCH + 'scene_jobs.json', 'utf8'))
const urls = JSON.parse(readFileSync(SCRATCH + 'scene_urls.json', 'utf8'))

const CAPS = {
  male: [
    ['what a night 🎶', 'this show went OFF', "still can't hear lol 🤘", 'bucket list band ✅'],
    ['needed this trip', 'views for days', 'vacation mode ✈️', 'not a bad view huh'],
    ['GAMEDAY 🏈', 'squad made it to the game', 'best seats we could find lol', 'W baby'],
    ['family cookout 🍔', 'good food better people', 'Sunday done right', 'grill duty again'],
  ],
  female: [
    ['beach day 🏖️', 'salt air fixes everything', 'girls trip ☀️', 'toes in the sand'],
    ['night to remember 🎶', 'concert therapy 💃', 'sang every word', 'ears still ringing lol'],
    ['dinner with my favorites 🥂', 'girls night 💕', 'we closed the place down lol', 'much needed catch up'],
    ['family adventures ✈️', 'making memories', 'trip of the year', 'already want to go back'],
  ],
}
const pick = a => a[Math.floor(Math.random() * a.length)]
const randPastDate = () => new Date(Date.now() - Math.random() * 60 * 86400 * 1000).toISOString()

// resume: bots that already have scene posts
const done = new Set()
{
  let from = 0
  for (;;) {
    const { data } = await supa.from('profile_posts').select('profile_id').like('media_url', '%bot-scenes%').range(from, from + 999)
    if (!data?.length) break
    data.forEach(r => done.add(r.profile_id))
    if (data.length < 1000) break
    from += 1000
  }
}
console.log(`already posted: ${done.size} bots`)

let posted = 0, skippedPending = 0
for (const bot of roster) {
  if (done.has(bot.id)) continue
  const jobId = jobs[bot.id]
  const url = jobId && urls[jobId]
  if (!url) { skippedPending++; continue }
  let grid
  try {
    const r = await fetch(url)
    if (!r.ok) { skippedPending++; continue }
    grid = Buffer.from(await r.arrayBuffer())
  } catch { skippedPending++; continue }
  const meta = await sharp(grid).metadata()
  const cellW = Math.floor(meta.width / 2), cellH = Math.floor(meta.height / 3)
  const ix = Math.round(cellW * 0.04), iy = Math.round(cellH * 0.04)
  const cells = []
  for (let r = 0; r < 3; r++) for (let c = 0; c < 2; c++) {
    cells.push(await sharp(grid)
      .extract({ left: c * cellW + ix, top: r * cellH + iy, width: cellW - 2 * ix, height: cellH - 2 * iy })
      .jpeg({ quality: 85 }).toBuffer())
  }
  // cells: 0 portrait, 1-4 scenes, 5 bonus
  const up = async (n, buf) => {
    const path = `bot-scenes/${bot.id}/${n}.jpg`
    const { error } = await supa.storage.from('avatars').upload(path, buf, { contentType: 'image/jpeg', upsert: true })
    if (error) throw new Error(error.message)
    return supa.storage.from('avatars').getPublicUrl(path).data.publicUrl
  }
  try {
    // album: portrait cell (showcase bots have no album yet → sort 0; grid-pool
    // bots already own a bot-secondary portrait → this goes behind it)
    const portraitUrl = await up(0, cells[0])
    const bonusUrl = await up(5, cells[5])
    await supa.from('profile_photos').insert([
      { profile_id: bot.id, url: portraitUrl, sort_order: bot.pool === 'showcase' ? 0 : 1 },
      { profile_id: bot.id, url: bonusUrl, sort_order: 5 },
    ])
    const caps = CAPS[bot.gender] ?? CAPS.male
    const rows = []
    for (let i = 1; i <= 4; i++) {
      const sceneUrl = await up(i, cells[i])
      rows.push({
        profile_id: bot.id,
        content: pick(caps[i - 1]),
        media_type: 'image',
        media_url: sceneUrl,
        score: Math.floor(Math.random() * 16),
        created_at: randPastDate(),
      })
    }
    const { error } = await supa.from('profile_posts').insert(rows)
    if (error) throw new Error(error.message)
    posted++
    if (posted % 20 === 0) console.log(`posted ${posted} bots...`)
  } catch (e) {
    console.error('fail', bot.id.slice(0, 8), e.message)
  }
}
console.log(`DONE. bots posted=${posted} still pending=${skippedPending}`)
