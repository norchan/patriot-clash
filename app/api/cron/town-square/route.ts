import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

// Town Square content bot: pulls political news RSS feeds (right-leaning
// outlets for Republican bots, left-leaning for Democrat bots) and has a
// random party-matched bot share fresh headlines into each town hall's
// thread as link posts (headline + link + thumbnail + source domain).
// Runs on a Vercel cron; callable manually with the same bearer secret.

export const maxDuration = 60

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
  const repPosts = repFeeds.flat()
  const demPosts = demFeeds.flat()
  if (repPosts.length === 0 && demPosts.length === 0) {
    return NextResponse.json({ error: 'All feeds returned nothing' }, { status: 502 })
  }

  const [{ data: bots }, { data: gyms }] = await Promise.all([
    admin.from('profiles').select('id, party').like('clerk_user_id', 'bot%'),
    admin.from('gyms').select('id'),
  ])
  const demBots = (bots ?? []).filter(b => b.party === 'democrat')
  const repBots = (bots ?? []).filter(b => b.party === 'republican')
  if (!gyms?.length || (!demBots.length && !repBots.length)) {
    return NextResponse.json({ error: 'No gyms or bots found' }, { status: 500 })
  }

  let inserted = 0
  for (const gym of gyms) {
    // What has already been shared here — never repost the same link
    const { data: existing } = await admin
      .from('hall_posts')
      .select('link_url')
      .eq('gym_id', gym.id)
      .not('link_url', 'is', null)
      .order('created_at', { ascending: false })
      .limit(300)
    const seen = new Set((existing ?? []).map(e => e.link_url))

    // One fresh headline per party per run, per hall
    const picks: { post: NewsItem; party: 'democrat' | 'republican' }[] = []
    const freshRep = shuffle(repPosts).find(p => !seen.has(p.link))
    const freshDem = shuffle(demPosts).find(p => !seen.has(p.link))
    if (freshRep && repBots.length) picks.push({ post: freshRep, party: 'republican' })
    if (freshDem && demBots.length) picks.push({ post: freshDem, party: 'democrat' })

    for (const { post, party } of picks) {
      const pool = party === 'democrat' ? demBots : repBots
      const bot = pool[Math.floor(Math.random() * pool.length)]
      // stagger timestamps over the past 8 hours so feeds look alive
      const createdAt = new Date(Date.now() - Math.random() * 8 * 3600 * 1000).toISOString()
      const { error } = await admin.from('hall_posts').insert({
        gym_id: gym.id,
        profile_id: bot.id,
        content: post.title,
        link_url: post.link,
        link_title: post.title,
        link_image: post.image,
        link_domain: post.domain,
        score: Math.floor(Math.random() * 12),
        created_at: createdAt,
      })
      if (!error) inserted++
    }
  }

  return NextResponse.json({
    ok: true,
    inserted,
    gyms: gyms.length,
    fetched: { republican: repPosts.length, democrat: demPosts.length },
  })
}
