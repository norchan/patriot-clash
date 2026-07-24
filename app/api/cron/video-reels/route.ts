import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { openaiChat } from '@/lib/openai'
import { videoAvailable } from '@/lib/video-embed'
import { tooSimilar } from '@/lib/content-unique'

// P/VIDEOS REELS FIREHOSE (A1 brief Phase 1, Michael via Grok 2026-07-24).
// Was: 10 sports-heavy channels, 2 posts/run. Now: politics-FIRST allowlist
// (news orgs + satire, both parties + neutral), funny/viral, a small sports
// subset and science "wow" — up to 8 posts/run with per-category caps
// (4 runs/day ≈ 32/day ceiling; quality gates keep it honest).
// Hard rules unchanged: SHORTS only (vertical), videoAvailable (playable in
// embed), never repost a video id, unique bot captions, embed only — never
// re-host bytes. Optional: YOUTUBE_API_KEY unlocks Data API search discovery
// (trending politics/funny Shorts beyond the allowlist); without the key the
// RSS allowlist carries the feed.

export const maxDuration = 300

const MAX_POSTS = 8
type Cat = 'politics' | 'funny' | 'sports' | 'science'
// per-run category caps — the mix Grok's brief calls for (politics-first,
// sports present but never dominant)
const CAT_CAPS: Record<Cat, number> = { politics: 4, funny: 2, sports: 1, science: 1 }

// [display name, channel id, category]. RSS failures are logged per-channel
// and harmless — tune this list freely.
const CHANNELS: [string, string, Cat][] = [
  // politics / news — right, left, neutral
  ['Fox News', 'UCXIJgqnII2ZOINSWNOGFThA', 'politics'],
  ['CNN', 'UCupvZG-5ko_eiXAupbDfxWw', 'politics'],
  ['MSNBC', 'UCaXkIU1QidjPwiAYu6GcHjg', 'politics'],
  ['NBC News', 'UCeY0bbntWzzVIaj2z3QigXg', 'politics'],
  ['ABC News', 'UCBi2mrWuNuyYy4gbM6fU18Q', 'politics'],
  ['CBS News', 'UC8p1vwvWtl6T73JiExfWs1g', 'politics'],
  ['C-SPAN', 'UCb--64Gl51jIEVE-GLDAVTg', 'politics'],
  ['Sky News', 'UCoMdktPbSTixAyNGwb-UYkQ', 'politics'],
  ['Ben Shapiro', 'UCnQC_G5Xsjhp9fEJKuIcrSw', 'politics'],
  // satire — counts as politics for the mix
  ['The Daily Show', 'UCwWhs_6x42TyRM4Wstoq8HA', 'politics'],
  ['Saturday Night Live', 'UCqFzWxSCi39LnW1JKFR3efg', 'politics'],
  ['The Late Show', 'UCMtFAi84ehTSYSE9XoHefig', 'politics'],
  ['Jimmy Kimmel Live', 'UCa6vGFO9ty8v5KZJXQxdhaw', 'politics'],
  // funny / viral (safe channels)
  ['MrBeast', 'UCX6OQ3DkcsbYNE6H8uQQuVA', 'funny'],
  ['Zach King', 'UCq8DICunczvLuJJq414110A', 'funny'],
  ['Dude Perfect', 'UCRijo3ddMTht_IHyNSNXpNQ', 'funny'],
  // sports — kept small on purpose
  ['NFL', 'UCDVYQ4Zhbm3S2dlz7P1GBDg', 'sports'],
  ['NBA', 'UCWJ2lWNubArHWmf3FIHbfcQ', 'sports'],
  ['ESPN', 'UCiWLfSweyRNmLpgEHekhoAg', 'sports'],
  ['House of Highlights', 'UCqQo7ewe87aYAe7ub5UqXMw', 'sports'],
  // science / wow
  ['NASA', 'UCLA_DiR1FfKNvjuUpBHmylQ', 'science'],
  ['National Geographic', 'UCpVm7bg6pXKo1Pr6k5kxG9A', 'science'],
]

// SOCS is Google's consent cookie — without it, youtube.com requests from
// datacenter IPs (Vercel) get consent-walled pages: feeds parse to zero
// entries with no error (the 2026-07-21 blast ran 10 rounds, inserted 0)
const UA = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cookie': 'SOCS=CAI; CONSENT=YES+cb',
}

// the RSS endpoint intermittently 404s valid channels under load — retry once
async function fetchFeed(channelId: string): Promise<string | null> {
  for (let i = 0; i < 2; i++) {
    try {
      const r = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, { headers: UA })
      if (r.ok) return await r.text()
    } catch { /* retry */ }
    await new Promise(res => setTimeout(res, 800))
  }
  return null
}

async function isShort(id: string): Promise<boolean> {
  // Shorts get a vertical "oar" thumbnail on YouTube's image CDN; regular
  // videos 404 there. CDN answers identically for datacenter IPs — the
  // /shorts/ redirect probe worked locally but never on Vercel.
  try {
    const r = await fetch(`https://i.ytimg.com/vi/${id}/oardefault.jpg`, { method: 'HEAD' })
    return r.status === 200
  } catch {
    return false
  }
}

// Optional discovery beyond the allowlist: YouTube Data API v3 search
// (needs YOUTUBE_API_KEY). ~100 quota units per query on a 10k/day budget —
// two queries per run × 4 runs = 800 units, comfortable.
const API_QUERIES: [string, Cat][] = [
  ['politics', 'politics'],
  ['congress OR president OR election', 'politics'],
  ['political comedy', 'politics'],
  ['funny fail', 'funny'],
]
async function apiSearch(key: string, q: string): Promise<{ id: string; title: string }[]> {
  try {
    const since = new Date(Date.now() - 48 * 3600 * 1000).toISOString()
    const u = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoDuration=short&videoEmbeddable=true&order=date&maxResults=15&relevanceLanguage=en&regionCode=US&safeSearch=moderate&publishedAfter=${encodeURIComponent(since)}&q=${encodeURIComponent(q)}&key=${key}`
    const r = await fetch(u)
    if (!r.ok) return []
    const d: any = await r.json()
    return (d.items ?? [])
      .map((it: any) => ({ id: it?.id?.videoId, title: String(it?.snippet?.title ?? '').slice(0, 200) }))
      .filter((x: any) => x.id && x.title)
  } catch {
    return []
  }
}

const shuffle = <T,>(arr: T[]) => [...arr].sort(() => Math.random() - 0.5)

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const admin = createSupabaseAdminClient()

  const [{ data: board }, { data: bots }] = await Promise.all([
    admin.from('boards').select('id').eq('slug', 'videos').maybeSingle(),
    admin.from('profiles').select('id, party').like('clerk_user_id', 'bot%').limit(200),
  ])
  if (!board || !bots?.length) return NextResponse.json({ ok: false, error: 'no board/bots' })

  // everything already on the board — never repost a video, never echo a caption
  const posted = new Set<string>()
  const recentCaptions: string[] = []
  for (let off = 0; ; off += 1000) {
    const { data: rows } = await admin.from('hall_posts')
      .select('link_url, content')
      .eq('board_id', board.id)
      .range(off, off + 999)
    for (const p of rows ?? []) {
      const id = /(?:shorts\/|v=|youtu\.be\/|tiktok\.com\/.*video\/)([\w-]{6,})/.exec(p.link_url ?? '')?.[1]
      if (id) posted.add(id)
      if (p.content) recentCaptions.push(p.content)
    }
    if (!rows || rows.length < 1000) break
  }

  const stats = {
    inserted: 0,
    by_cat: { politics: 0, funny: 0, sports: 0, science: 0 } as Record<Cat, number>,
    skipped_dupe: 0,
    skipped_not_short: 0,
    skipped_unplayable: 0,
    caption_fallback: 0,
    api: process.env.YOUTUBE_API_KEY ? 'on' : 'no key (set YOUTUBE_API_KEY to enable search discovery)',
  }
  const errors: string[] = []

  async function tryPost(cand: { id: string; title: string; source: string }, cat: Cat): Promise<boolean> {
    if (stats.inserted >= MAX_POSTS || stats.by_cat[cat] >= CAT_CAPS[cat]) return false
    if (posted.has(cand.id)) { stats.skipped_dupe++; return false }
    posted.add(cand.id) // claim before the slow checks — no double-processing
    if (!(await isShort(cand.id))) { stats.skipped_not_short++; return false }
    const url = `https://www.youtube.com/shorts/${cand.id}`
    if (!(await videoAvailable(url))) { stats.skipped_unplayable++; return false }

    // unique bot voice — same gate as everywhere (boards polish Phase D)
    const gen = () => openaiChat([
      { role: 'system', content: 'You write ONE short casual reaction (max 12 words) to share a video on a forum. Sound like a regular person hyped about a clip. No hashtags, no quotes around the reply, never mention being an AI.' },
      { role: 'user', content: `Video: ${cand.title} (from ${cand.source})${recentCaptions.length ? `\nRecent captions on the board (say something DIFFERENT):\n${recentCaptions.slice(-8).map(c => `- ${c}`).join('\n')}` : ''}` },
    ], 40, 1.0)
    let caption = await gen()
    if (caption && recentCaptions.some(c => tooSimilar(c, caption!))) caption = await gen()
    if (!caption || recentCaptions.some(c => tooSimilar(c, caption!))) { caption = null; stats.caption_fallback++ }

    const bot = bots![Math.floor(Math.random() * bots!.length)]
    const { error } = await admin.from('hall_posts').insert({
      board_id: board!.id,
      profile_id: bot.id,
      party: bot.party ?? null,
      content: (caption ?? cand.title).slice(0, 200),
      link_url: url,
      link_title: cand.title,
      link_domain: 'youtube.com',
      link_image: `https://i.ytimg.com/vi/${cand.id}/hqdefault.jpg`,
      score: 2 + Math.floor(Math.random() * 8),
    })
    if (error) { errors.push(`${cand.source}: ${error.message}`); return false }
    stats.inserted++
    stats.by_cat[cat]++
    if (caption) recentCaptions.push(caption)
    return true
  }

  // ── pass 1: the channel allowlist (RSS — reliable from Vercel) ───────────
  for (const [channel, cid, cat] of shuffle(CHANNELS)) {
    if (stats.inserted >= MAX_POSTS) break
    if (stats.by_cat[cat] >= CAT_CAPS[cat]) continue
    const rss = await fetchFeed(cid)
    if (!rss) { errors.push(`${channel}: feed failed`); continue }
    const entries = [...rss.matchAll(/<entry>[\s\S]*?<yt:videoId>([\w-]+)<\/yt:videoId>[\s\S]*?<title>([^<]+)<\/title>/g)]
      .map(m => ({ id: m[1], title: m[2] }))
    for (const e of entries) {
      if (await tryPost({ ...e, source: channel }, cat)) break // one per channel per run
      if (stats.inserted >= MAX_POSTS || stats.by_cat[cat] >= CAT_CAPS[cat]) break
    }
  }

  // ── pass 2 (optional): Data API search — trending beyond the allowlist ───
  const key = process.env.YOUTUBE_API_KEY
  if (key && stats.inserted < MAX_POSTS) {
    // rotate two queries per run to stay tiny on quota
    const runIdx = Math.floor(Date.now() / (6 * 3600 * 1000))
    const picks = [API_QUERIES[runIdx % API_QUERIES.length], API_QUERIES[(runIdx + 1) % API_QUERIES.length]]
    for (const [q, cat] of picks) {
      if (stats.inserted >= MAX_POSTS) break
      for (const cand of await apiSearch(key, q)) {
        if (stats.inserted >= MAX_POSTS || stats.by_cat[cat] >= CAT_CAPS[cat]) break
        await tryPost({ ...cand, source: `yt-search:${q}` }, cat)
      }
    }
  }

  return NextResponse.json({ ok: true, ...stats, errors })
}
