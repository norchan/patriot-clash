import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { resolveArticle } from '@/lib/og-image'
import { sameStory } from '@/lib/content-unique'

// Town Square content bot: pulls political news RSS feeds (right-leaning
// outlets for Republican bots, left-leaning for Democrat bots) and has a
// random party-matched bot share fresh headlines into each town hall's
// thread as link posts (headline + link + thumbnail + source domain).
// Runs on a Vercel cron; callable manually with the same bearer secret.
// HARD RULE (Michael, boards polish): every link post needs a real photo —
// feed items without one get an og:image resolve; still bare → dropped.

export const maxDuration = 120

const FEEDS: Record<'republican' | 'democrat', string[]> = {
  republican: [
    'https://moxie.foxnews.com/google-publisher/politics.xml',
    'https://nypost.com/politics/feed/',
    'https://www.washingtontimes.com/rss/headlines/news/politics/',
  ],
  democrat: [
    'https://www.theguardian.com/us-news/us-politics/rss',
    'https://chaski.huffpost.com/us/auto/vertical/politics',
    'https://feeds.nbcnews.com/nbcnews/public/politics',
  ],
}

interface NewsItem {
  title: string
  link: string
  image: string | null
  domain: string
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .trim()
}

function parseRss(xml: string): NewsItem[] {
  const out: NewsItem[] = []
  for (const chunk of xml.split(/<item[\s>]/).slice(1)) {
    const body = chunk.split('</item>')[0]
    const title = /<title[^>]*>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/title>/.exec(body)?.[1]
    const link = /<link[^>]*>\s*(?:<!\[CDATA\[)?\s*(https?:[^<\]\s]+)/.exec(body)?.[1]
    if (!title || !link) continue
    // biggest media:content wins (some feeds list several sizes)
    let image: string | null = null
    const medias = [...body.matchAll(/<media:(?:content|thumbnail)[^>]+url="([^"]+)"/g)]
    if (medias.length) image = decodeEntities(medias[medias.length - 1][1])
    if (!image) {
      const enc = /<enclosure[^>]+url="([^"]+)"[^>]*>/.exec(body)
      if (enc && /image|jpe?g|png|webp/i.test(enc[0])) image = decodeEntities(enc[1])
    }
    let domain = ''
    try { domain = new URL(link).hostname.replace(/^www\./, '') } catch { continue }
    out.push({ title: decodeEntities(title).slice(0, 300), link: decodeEntities(link), image, domain })
  }
  return out
}

async function fetchFeed(url: string): Promise<NewsItem[]> {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 8000)
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PoliticsGoBot/1.0; +https://politicsgo.app)' },
      cache: 'no-store',
      signal: ctrl.signal,
    })
    clearTimeout(timer)
    if (!res.ok) return []
    return parseRss(await res.text()).slice(0, 15)
  } catch {
    return []
  }
}

const shuffle = <T,>(arr: T[]) => arr.map(v => [Math.random(), v] as const).sort((a, b) => a[0] - b[0]).map(([, v]) => v)

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let idx = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++
      results[i] = await fn(items[i])
    }
  }))
  return results
}

// image-or-drop: items the feed didn't give a picture get ONE og:image
// resolve; whatever is still bare leaves the pool (no broken cards)
async function requireImages(items: NewsItem[]): Promise<NewsItem[]> {
  await mapLimit(items.filter(i => !i.image || !/^https:\/\//.test(i.image)), 8, async i => {
    const a = await resolveArticle(i.link)
    if (a.image && /^https:\/\//.test(a.image)) i.image = a.image
  })
  return items.filter(i => i.image && /^https:\/\//.test(i.image))
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createSupabaseAdminClient()

  const [repFeeds, demFeeds] = await Promise.all([
    Promise.all(FEEDS.republican.map(fetchFeed)),
    Promise.all(FEEDS.democrat.map(fetchFeed)),
  ])
  const repFetched = repFeeds.flat()
  const demFetched = demFeeds.flat()
  if (repFetched.length === 0 && demFetched.length === 0) {
    return NextResponse.json({ error: 'All feeds returned nothing' }, { status: 502 })
  }
  const [repPosts, demPosts] = await Promise.all([requireImages(repFetched), requireImages(demFetched)])
  const skippedNoImage = repFetched.length - repPosts.length + (demFetched.length - demPosts.length)

  // PostgREST caps every response at 1000 rows — page anything that can
  // be bigger than that (2300+ gyms, and the dedupe rows grow daily)
  async function pageAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
    const all: T[] = []
    for (let page = 0; page < 50; page++) {
      const { data } = await build(page * 1000, page * 1000 + 999)
      if (!data?.length) break
      all.push(...data)
      if (data.length < 1000) break
    }
    return all
  }

  const [{ data: bots }, gyms] = await Promise.all([
    admin.from('profiles').select('id, party').like('clerk_user_id', 'bot%'),
    pageAll<{ id: string }>((from, to) => admin.from('gyms').select('id').order('id').range(from, to)),
  ])
  const demBots = (bots ?? []).filter(b => b.party === 'democrat')
  const repBots = (bots ?? []).filter(b => b.party === 'republican')
  if (!gyms?.length || (!demBots.length && !repBots.length)) {
    return NextResponse.json({ error: 'No gyms or bots found' }, { status: 500 })
  }

  // Thousands of halls — this must be a handful of batched queries, not a
  // per-hall loop (the sequential version blew the 60s function limit).
  // Dedupe is scoped to links in TODAY'S pool: one .in() query answers
  // "which halls already have which of these links".
  const poolLinks = [...new Set([...repPosts, ...demPosts].map(p => p.link))]
  const existing = await pageAll<{ gym_id: string; link_url: string }>((from, to) =>
    admin.from('hall_posts').select('gym_id, link_url').in('link_url', poolLinks).order('id').range(from, to))
  const seen = new Set(existing.map(e => `${e.gym_id}|${e.link_url}`))

  // same-STORY dedupe (boards polish Phase C): a hall must not get the same
  // story from two outlets — compare recent link-post headlines per hall
  const hallTitles = new Map<string, string[]>()
  {
    const since3d = new Date(Date.now() - 3 * 86400 * 1000).toISOString()
    const rows = await pageAll<{ gym_id: string; link_title: string | null; content: string | null }>((from, to) =>
      admin.from('hall_posts').select('gym_id, link_title, content')
        .not('gym_id', 'is', null).not('link_url', 'is', null)
        .gte('created_at', since3d).order('id').range(from, to))
    for (const r of rows) {
      const t = r.link_title ?? r.content
      if (t) (hallTitles.get(r.gym_id) ?? hallTitles.set(r.gym_id, []).get(r.gym_id)!).push(t)
    }
  }

  const rows: any[] = []
  let skippedDupe = 0
  for (const gym of gyms) {
    const picks: { post: NewsItem; party: 'democrat' | 'republican' }[] = []
    const prevTitles = hallTitles.get(gym.id) ?? []
    const freshOf = (pool: NewsItem[]) => shuffle(pool).find(p => {
      if (seen.has(`${gym.id}|${p.link}`)) return false
      if (prevTitles.some(t => sameStory(t, p.title))) { skippedDupe++; return false }
      return true
    })
    const freshRep = freshOf(repPosts)
    const freshDem = freshOf(demPosts)
    if (freshRep && repBots.length) picks.push({ post: freshRep, party: 'republican' })
    // both wings covering the same story from different outlets is still a dupe
    if (freshDem && demBots.length && !(freshRep && sameStory(freshRep.title, freshDem.title))) {
      picks.push({ post: freshDem, party: 'democrat' })
    }

    for (const { post, party } of picks) {
      const pool = party === 'democrat' ? demBots : repBots
      const bot = pool[Math.floor(Math.random() * pool.length)]
      seen.add(`${gym.id}|${post.link}`)
      rows.push({
        gym_id: gym.id,
        profile_id: bot.id,
        party, // author party tag (feeds are already party-matched to bots)
        content: post.title,
        link_url: post.link,
        link_title: post.title,
        link_image: post.image,
        link_domain: post.domain,
        score: Math.floor(Math.random() * 12),
        // stagger timestamps over the past 8 hours so feeds look alive
        created_at: new Date(Date.now() - Math.random() * 8 * 3600 * 1000).toISOString(),
      })
    }
  }

  let inserted = 0
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.from('hall_posts').insert(rows.slice(i, i + 500))
    if (!error) inserted += Math.min(500, rows.length - i)
  }

  return NextResponse.json({
    ok: true,
    inserted,
    skipped_no_image: skippedNoImage,
    skipped_dupe: skippedDupe,
    gyms: gyms.length,
    fetched: { republican: repPosts.length, democrat: demPosts.length },
  })
}
