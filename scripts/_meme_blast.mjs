// ONE-TIME BLAST (Michael 2026-07-25): every NA bot (gender IS NULL) gets 4
// profile posts, each a UNIQUE internet meme image (no AI, no video/gif),
// timestamped randomly over the past 60 days. Memes are harvested from
// Lemmy top listings via the open API (Reddit killed anonymous JSON — 403s
// even residential IPs), content-hash deduped so no two bots ever share a
// meme, and rehosted in the public avatars bucket (bot-meme-posts/<sha1>.jpg).
// Left-lean political memes go only to democrat bots; republican bots get
// all-funny (no reliable right-lean meme source with an open API). Resumable:
// bots that already have 4 bot-meme-posts posts are skipped, and the
// harvested pool is cached in scripts/_meme_pool.json.
import { createClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import sharp from 'sharp'

const env = Object.fromEntries(readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
  .split('\n').filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]))
const supa = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) PoliticsGoSeeder/1.0' }
const sleep = ms => new Promise(r => setTimeout(r, ms))

// ── harvest (Lemmy open API) ────────────────────────────────────────────────
// lean: null = general funny, 'democrat' = left-lean political
const SOURCES = [
  { community: 'memes@lemmy.world', lean: null },
  { community: 'memes@lemmy.ml', lean: null },
  { community: 'memes@sopuli.xyz', lean: null },
  { community: 'microblogmemes@lemmy.world', lean: null },
  { community: 'me_irl@lemmy.world', lean: null },
  { community: 'comicstrips@lemmy.world', lean: null },
  { community: 'politicalmemes@lemmy.world', lean: 'democrat' },
]
const SORTS = ['TopAll', 'TopYear', 'TopThreeMonths']
const PAGES = 22 // ×50 per listing

const POOL_CACHE = new URL('./_meme_pool.json', import.meta.url)

async function harvest() {
  if (existsSync(POOL_CACHE)) {
    const cached = JSON.parse(readFileSync(POOL_CACHE, 'utf8'))
    console.log(`[harvest] using cached pool (${cached.length})`)
    return cached
  }
  const byUrl = new Map()
  for (const { community, lean } of SOURCES) {
    for (const sort of SORTS) {
      for (let p = 1; p <= PAGES; p++) {
        const u = `https://lemmy.world/api/v3/post/list?community_name=${encodeURIComponent(community)}&sort=${sort}&limit=50&page=${p}`
        let json
        try {
          const r = await fetch(u, { headers: UA })
          if (r.status === 429) { await sleep(15000); p--; continue }
          if (!r.ok) break
          json = await r.json()
        } catch { break }
        const posts = json?.posts ?? []
        if (!posts.length) break
        for (const { post: d } of posts) {
          if (!d || d.nsfw || d.removed || d.deleted) continue
          const url = d.url ?? ''
          if (!/^https:\/\/[^?\s]+\.(jpe?g|png|webp)$/i.test(url)) continue
          if (/\b(nsfw|porn|nude|onlyfans)\b/i.test(d.name ?? '')) continue
          if (!byUrl.has(url)) byUrl.set(url, { url, lean })
        }
        await sleep(700)
      }
      console.log(`[harvest] ${community} ${sort}: pool now ${byUrl.size}`)
    }
  }
  const pool = [...byUrl.values()]
  writeFileSync(POOL_CACHE, JSON.stringify(pool))
  return pool
}

// ── process one candidate: download → validate → rehost. null on any failure ─
const usedHashes = new Set()
async function processMeme(cand) {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 15000)
    const r = await fetch(cand.url, { headers: UA, signal: ctrl.signal })
    clearTimeout(t)
    if (!r.ok) return null
    const buf = Buffer.from(await r.arrayBuffer())
    if (buf.length < 15_000 || buf.length > 8_000_000) return null
    const meta = await sharp(buf).metadata()
    if (!meta.width || meta.width < 320 || meta.height < 320) return null
    if (meta.pages && meta.pages > 1) return null // animated sneaking through
    const jpg = await sharp(buf).rotate().resize({ width: 1400, height: 1800, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer()
    const hash = createHash('sha1').update(jpg).digest('hex')
    if (usedHashes.has(hash)) return null
    const path = `bot-meme-posts/${hash}.jpg`
    const { error } = await supa.storage.from('avatars').upload(path, jpg, { contentType: 'image/jpeg', upsert: true })
    if (error) return null
    usedHashes.add(hash)
    return supa.storage.from('avatars').getPublicUrl(path).data.publicUrl
  } catch { return null }
}

// ── captions ─────────────────────────────────────────────────────────────────
const FUNNY = ['😂', '💀', 'lol', 'this one got me', 'accurate', 'who made this 💀', "can't stop laughing", "it's true tho", 'no notes', 'still funny', 'found this gem', 'dead 💀', 'facts', 'me every time', 'I feel seen', '', '', '']
const POLITICAL = ['this 💯', 'so true it hurts', 'they hate to see it', "tell me I'm wrong", '💯', 'it really be like this', '']
const pick = a => a[Math.floor(Math.random() * a.length)]
const randPastDate = () => new Date(Date.now() - Math.random() * 60 * 86400 * 1000).toISOString()

// ── main ─────────────────────────────────────────────────────────────────────
console.log('harvesting listings...')
const pool = await harvest()
const funnyQ = pool.filter(m => !m.lean).sort(() => Math.random() - 0.5)
const demQ = pool.filter(m => m.lean === 'democrat').sort(() => Math.random() - 0.5)
const repQ = pool.filter(m => m.lean === 'republican').sort(() => Math.random() - 0.5)
console.log(`pool: funny=${funnyQ.length} dem=${demQ.length} rep=${repQ.length}`)

// NA bots = game bots with gender NULL; skip any that already got their blast
const { data: bots } = await supa.from('profiles')
  .select('id, clerk_user_id, party')
  .like('clerk_user_id', 'bot%').not('clerk_user_id', 'like', 'bot_tracker%')
  .is('gender', null)
  .order('clerk_user_id')
  .limit(2000)
console.log(`NA bots: ${bots.length}`)

// preload existing hashes so a resume never reuses an image
{
  let from = 0
  for (;;) {
    const { data } = await supa.from('profile_posts').select('media_url').like('media_url', '%bot-meme-posts%').range(from, from + 999)
    if (!data?.length) break
    for (const r of data) { const m = /bot-meme-posts\/([0-9a-f]{40})/.exec(r.media_url ?? ''); if (m) usedHashes.add(m[1]) }
    if (data.length < 1000) break
    from += 1000
  }
  console.log(`resume: ${usedHashes.size} memes already used`)
}

async function nextMeme(queue) {
  while (queue.length) {
    const url = await processMeme(queue.shift())
    if (url) return url
  }
  return null
}

let done = 0, skipped = 0, shortfall = 0
for (const bot of bots) {
  const { count } = await supa.from('profile_posts')
    .select('id', { count: 'exact', head: true })
    .eq('profile_id', bot.id).like('media_url', '%bot-meme-posts%')
  if ((count ?? 0) >= 4) { skipped++; continue }

  const rows = []
  const politicalQ = bot.party === 'republican' ? repQ : demQ
  const wantPolitical = Math.random() < 0.5 ? 1 : 0
  const need = 4 - (count ?? 0)
  for (let i = 0; i < need; i++) {
    const usePolitical = i === 0 && wantPolitical && politicalQ.length > 0
    const url = await nextMeme(usePolitical ? politicalQ : funnyQ) ?? await nextMeme(funnyQ)
    if (!url) { shortfall++; break }
    rows.push({
      profile_id: bot.id,
      content: usePolitical ? pick(POLITICAL) : pick(FUNNY),
      media_type: 'image',
      media_url: url,
      score: Math.floor(Math.random() * 16),
      created_at: randPastDate(),
    })
  }
  if (rows.length) {
    const { error } = await supa.from('profile_posts').insert(rows)
    if (error) { console.error('insert fail', bot.clerk_user_id, error.message); continue }
  }
  done++
  if (done % 25 === 0) console.log(`[${done}/${bots.length}] posted (queues: funny=${funnyQ.length} dem=${demQ.length} rep=${repQ.length})`)
  if (rows.length < need) { console.log(`POOL EXHAUSTED at bot ${done} — stopping`); break }
}
console.log(`DONE. bots posted=${done} skipped(already)=${skipped} shortfall=${shortfall} memes used=${usedHashes.size}`)
