// Replaces most bot face avatars with political-themed profile pictures.
// Reads scripts/political_avatars.json ({ democrat: [urls], republican: [urls] }),
// resizes each to a 256px webp, uploads to the public avatars bucket, then
// reassigns: every 10th bot per party keeps its current face portrait, the
// rest get a pool image (round-robin so usage stays even).
//
// Usage: node scripts/political_avatars.mjs
import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'
import fs from 'fs'

const envText = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const env = Object.fromEntries(envText.split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const sources = JSON.parse(fs.readFileSync(new URL('./political_avatars.json', import.meta.url), 'utf8'))

// ── 1. Download, shrink, upload the pool ────────────────────────────────────
async function buildPool(party, urls) {
  const pool = []
  for (let i = 0; i < urls.length; i++) {
    const path = `political/${party}_${String(i).padStart(2, '0')}.webp`
    const res = await fetch(urls[i])
    if (!res.ok) { console.log(`  skip ${party} #${i}: HTTP ${res.status}`); continue }
    const buf = Buffer.from(await res.arrayBuffer())
    const webp = await sharp(buf).resize(256, 256).webp({ quality: 80 }).toBuffer()
    const { error } = await sb.storage.from('avatars').upload(path, webp, { contentType: 'image/webp', upsert: true })
    if (error) { console.log(`  upload failed ${path}: ${error.message}`); continue }
    const { data: pub } = sb.storage.from('avatars').getPublicUrl(path)
    pool.push(`${pub.publicUrl}?v=2`)
    process.stdout.write(`\r${party} pool: ${pool.length}/${urls.length}`)
  }
  console.log()
  return pool
}

const pools = {
  democrat: await buildPool('democrat', sources.democrat),
  republican: await buildPool('republican', sources.republican),
}
if (!pools.democrat.length || !pools.republican.length) {
  console.error('empty pool — aborting before touching any bots')
  process.exit(1)
}

// ── 2. Reassign bot avatars ─────────────────────────────────────────────────
const { data: bots, error } = await sb.from('profiles')
  .select('id, clerk_user_id, username, party, avatar_url')
  .like('clerk_user_id', 'bot\\_%')
  .order('clerk_user_id')
if (error) { console.error(error); process.exit(1) }

const counters = { democrat: 0, republican: 0 }
const seen = { democrat: 0, republican: 0 }
let faces = 0, political = 0, failed = 0

for (const bot of bots) {
  const idx = seen[bot.party]++
  if (idx % 10 === 0) { faces++; continue } // every 10th bot keeps its face
  const pool = pools[bot.party]
  const url = pool[counters[bot.party]++ % pool.length]
  const { error: upErr } = await sb.from('profiles').update({ avatar_url: url }).eq('id', bot.id)
  if (upErr) { failed++; console.log(`  ${bot.username}: ${upErr.message}`) }
  else political++
}

console.log(`bots: ${bots.length} — kept faces: ${faces}, political pics: ${political}, failed: ${failed}`)
