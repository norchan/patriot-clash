// ONE-TIME (Michael 2026-07-25): slice the Higgs 4x4 portrait grids into
// 16 unique faces each and hand one to every male/female bot as their
// secondary picture (profile_photos row + avatars bucket
// bot-secondary/<profileId>.jpg). Bots are matched to their band's grids
// in deterministic clerk_user_id order; bots that already have an album
// photo are skipped, so the script is safely re-runnable.
// Inputs (scratchpad): portrait_jobs.json {band: [jobId]}, portrait_urls.json {jobId: url}.
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import sharp from 'sharp'

const SCRATCH = 'C:/Users/Micha/AppData/Local/Temp/claude/c--Users-Micha-patriot-clash/acd84d08-0df9-435a-8904-192f5d4e95a8/scratchpad/'
const env = Object.fromEntries(readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
  .split('\n').filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]))
const supa = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const jobs = JSON.parse(readFileSync(SCRATCH + 'portrait_jobs.json', 'utf8'))
const urls = JSON.parse(readFileSync(SCRATCH + 'portrait_urls.json', 'utf8'))

const BANDS = {
  '20s': [21, 29], '30s': [30, 39], '40s': [40, 49], '50s': [50, 59], '60s': [60, 74],
}

// bots that already have an album photo — skip (resume safety)
const havePhoto = new Set()
{
  let from = 0
  for (;;) {
    const { data } = await supa.from('profile_photos').select('profile_id').range(from, from + 999)
    if (!data?.length) break
    data.forEach(r => havePhoto.add(r.profile_id))
    if (data.length < 1000) break
    from += 1000
  }
}
console.log(`profiles already with photos: ${havePhoto.size}`)

let assigned = 0, missingGrids = 0
for (const [bandKey, jobIds] of Object.entries(jobs)) {
  const [gender, band] = bandKey.split('-')
  const [lo, hi] = BANDS[band]
  const { data: bots } = await supa.from('profiles')
    .select('id, clerk_user_id')
    .like('clerk_user_id', 'bot%').not('clerk_user_id', 'like', 'bot_tracker%')
    .eq('gender', gender).gte('age', lo).lte('age', hi)
    .not('avatar_url', 'like', '%bot-faces-env%')
    .order('clerk_user_id')
    .limit(400)
  const queue = bots.filter(b => !havePhoto.has(b.id))
  console.log(`${bandKey}: ${bots.length} bots (${queue.length} pending) across ${jobIds.length} grids`)
  let qi = 0
  for (const jobId of jobIds) {
    if (qi >= queue.length) break
    const url = urls[jobId]
    if (!url) { missingGrids++; continue }
    let grid
    try {
      const r = await fetch(url)
      if (!r.ok) { missingGrids++; continue }
      grid = Buffer.from(await r.arrayBuffer())
    } catch { missingGrids++; continue }
    const meta = await sharp(grid).metadata()
    const cellW = Math.floor(meta.width / 4), cellH = Math.floor(meta.height / 4)
    const insetX = Math.round(cellW * 0.05), insetY = Math.round(cellH * 0.05)
    for (let r = 0; r < 4 && qi < queue.length; r++) {
      for (let c = 0; c < 4 && qi < queue.length; c++) {
        const bot = queue[qi]
        const jpg = await sharp(grid)
          .extract({ left: c * cellW + insetX, top: r * cellH + insetY, width: cellW - 2 * insetX, height: cellH - 2 * insetY })
          .jpeg({ quality: 85 }).toBuffer()
        const path = `bot-secondary/${bot.id}.jpg`
        const { error: upErr } = await supa.storage.from('avatars').upload(path, jpg, { contentType: 'image/jpeg', upsert: true })
        if (upErr) { console.error('upload fail', bot.clerk_user_id, upErr.message); continue }
        const publicUrl = supa.storage.from('avatars').getPublicUrl(path).data.publicUrl
        const { error: insErr } = await supa.from('profile_photos').insert({ profile_id: bot.id, url: publicUrl, sort_order: 0 })
        if (insErr) { console.error('insert fail', bot.clerk_user_id, insErr.message); continue }
        qi++; assigned++
        if (assigned % 100 === 0) console.log(`  assigned ${assigned} so far...`)
      }
    }
  }
  if (qi < queue.length) console.log(`  WARNING ${bandKey}: ${queue.length - qi} bots left without portraits (not enough grids)`)
}
console.log(`DONE. portraits assigned=${assigned} missingGrids=${missingGrids}`)
