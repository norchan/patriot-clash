import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { ogImage } from '@/lib/og-image'

// TOPIC-NEWS REPORTER BOTS — fills the featured psubs (p/politics, p/news,
// p/space, p/movies, p/sports) with fresh top-site headlines every 6 hours,
// same two-phase / no-doubles contract as team-news and state-news
// (Michael's approved bot exceptions: news-linking reporters only).
// p/videos and p/funny are left to humans — no good headline source.

export const maxDuration = 120

// board slug → feed + a RELEVANCE gate: the headline must match `must`
// (Michael's rule: content has to actually belong to its sub). Curated
// Google News SECTION feeds are used wherever one exists — they're
// editorially topical, unlike keyword search which matches stray words.
const SEARCH = (q: string) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`
const SECTION = (s: string) =>
  `https://news.google.com/rss/headlines/section/topic/${s}?hl=en-US&gl=US&ceid=US:en`
const TOPICS: Record<string, { feed: string; must?: RegExp }> = {
  politics: {
    feed: SEARCH('congress OR senate OR election OR "white house" OR governor when:1d'),
    must: /congress|senate|house|president|white house|election|campaign|governor|court|law|bill|vote|polic|democrat|republican|gop|mayor|legislat/i,
  },
  news: { feed: 'https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en' }, // curated top stories
  space: {
    feed: SECTION('SCIENCE'),
    must: /space|nasa|rocket|launch|astronaut|orbit|moon|mars|spacex|satellite|telescope|asteroid|comet|galaxy|planet|cosmic/i,
  },
  movies: {
    feed: SECTION('ENTERTAINMENT'),
    must: /movie|film|box office|trailer|cinema|sequel|director|premiere|hollywood|streaming/i,
  },
  sports: { feed: SECTION('SPORTS') }, // curated sports desk
}

// listing/junk headlines that add nothing to a board
const JUNK = /live score|box ?score|game story, scores|scores\/highlights|tv channel|streaming options for|how to submit|schedule:\s*$|betting|odds|parlay|tickets/i

function titleTokens(t: string, ignore?: Set<string>): Set<string> {
  return new Set(
    t.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      .filter(w => w.length > 2 && !ignore?.has(w)))
}
function sameStory(a: string, b: string): boolean {
  const ta = titleTokens(a), tb = titleTokens(b)
  if (!ta.size || !tb.size) return false
  let hit = 0
  for (const w of ta) if (tb.has(w)) hit++
  return hit / Math.min(ta.size, tb.size) >= 0.5
}

interface NewsItem { title: string; link: string; source: string }

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .trim()
}

function parseGoogleNews(xml: string): NewsItem[] {
  const out: NewsItem[] = []
  const dayAgo = Date.now() - 24 * 3600 * 1000
  for (const chunk of xml.split(/<item[\s>]/).slice(1)) {
    const body = chunk.split('</item>')[0]
    let title = /<title[^>]*>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/title>/.exec(body)?.[1]
    const link = /<link[^>]*>\s*(?:<!\[CDATA\[)?\s*(https?:[^<\]\s]+)/.exec(body)?.[1]
    const pub = /<pubDate>([^<]+)<\/pubDate>/.exec(body)?.[1]
    const source = /<source[^>]*>([^<]+)<\/source>/.exec(body)?.[1]
    if (!title || !link) continue
    if (pub && !isNaN(Date.parse(pub)) && Date.parse(pub) < dayAgo) continue
    title = decodeEntities(title)
    if (/obituary/i.test(title)) continue
    const src = source ? decodeEntities(source) : 'news'
    if (title.toLowerCase().endsWith(` - ${src.toLowerCase()}`)) title = title.slice(0, -(src.length + 3))
    out.push({ title: title.slice(0, 300), link: decodeEntities(link), source: src })
  }
  return out
}

async function gnews(feedUrl: string): Promise<NewsItem[]> {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 6000)
    const res = await fetch(feedUrl,
      { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PoliticsGoBot/1.0; +https://politicsgo.app)' }, cache: 'no-store', signal: ctrl.signal }
    )
    clearTimeout(timer)
    if (!res.ok) return []
    return parseGoogleNews(await res.text()).slice(0, 16)
  } catch {
    return []
  }
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const phase = req.nextUrl.searchParams.get('phase') === '2' ? 2 : 1
  const admin = createSupabaseAdminClient()

  const [{ data: boards }, { data: botRows }] = await Promise.all([
    admin.from('boards').select('id, slug').in('slug', Object.keys(TOPICS)),
    admin.from('profiles')
      .select('id')
      .like('clerk_user_id', 'bot%')
      .order('id')
      .limit(2),
  ])
  if (!boards?.length) return NextResponse.json({ error: 'No topic boards' }, { status: 500 })
  const bot = botRows?.[phase - 1]?.id
  if (!bot) return NextResponse.json({ error: 'No reporter bots' }, { status: 500 })

  const pools = new Map<string, NewsItem[]>()
  for (const b of boards) {
    const t = TOPICS[b.slug]
    const items = (await gnews(t.feed))
      // the sub-relevance gate + junk-listing filter
      .filter(i => !JUNK.test(i.title) && (!t.must || t.must.test(i.title)))
    if (items.length) pools.set(b.id, items)
  }

  const existing = new Map<string, { links: Set<string>; titles: string[] }>()
  const { data: rows } = await admin.from('hall_posts')
    .select('board_id, link_url, link_title, content')
    .in('board_id', boards.map(b => b.id))
    .gte('created_at', new Date(Date.now() - 3 * 86400 * 1000).toISOString())
  for (const r of rows ?? []) {
    const e = existing.get(r.board_id) ?? { links: new Set<string>(), titles: [] }
    if (r.link_url) e.links.add(r.link_url)
    const t = r.link_title ?? r.content
    if (t) e.titles.push(t)
    existing.set(r.board_id, e)
  }

  const inserts: any[] = []
  for (const b of boards) {
    const e = existing.get(b.id) ?? { links: new Set<string>(), titles: [] }
    const pick = (pools.get(b.id) ?? []).find(item =>
      !e.links.has(item.link) && !e.titles.some(prev => sameStory(prev, item.title)))
    if (!pick) continue
    e.links.add(pick.link)
    e.titles.push(pick.title)
    inserts.push({
      board_id: b.id,
      profile_id: bot,
      party: null,
      content: pick.title,
      link_url: pick.link,
      link_title: pick.title,
      link_domain: pick.source,
      score: Math.floor(Math.random() * 6),
      created_at: new Date().toISOString(),
    })
  }

  // pull each article's preview image so posts show a photo card
  for (const r of inserts) {
    const img = await ogImage(r.link_url)
    if (img) r.link_image = img
  }

  let inserted = 0
  if (inserts.length) {
    const { error } = await admin.from('hall_posts').insert(inserts)
    if (!error) inserted = inserts.length
    else console.error('topic-news insert error:', error)
  }

  return NextResponse.json({ ok: true, phase, inserted, boards: boards.length })
}
