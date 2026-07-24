import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { resolveArticle } from '@/lib/og-image'
import { sameStory, titleTokens } from '@/lib/content-unique'

// STATE-NEWS REPORTER BOTS (Michael, 2026-07-21) — the same two designated
// bots per state post top-site articles to their STATE's psub, every 6 hours,
// in two passes five minutes apart (?phase=1 then ?phase=2). HARD RULE: the
// state's name must appear in the headline. Both passes scan the board first
// so neither ever posts a duplicate (by link OR by same-story headline —
// detector shared via lib/content-unique).

export const maxDuration = 120

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
    // listing junk (score pages, how-to-watch, lottery numbers) isn't state NEWS
    if (/live score|box ?score|game story, scores|scores\/highlights|tv channel|streaming options for|how to watch|betting|odds|parlay|lotto|lottery numbers|powerball|mega millions/i.test(title)) continue
    const src = source ? decodeEntities(source) : 'news'
    if (title.toLowerCase().endsWith(` - ${src.toLowerCase()}`)) title = title.slice(0, -(src.length + 3))
    out.push({ title: title.slice(0, 300), link: decodeEntities(link), source: src })
  }
  return out
}

async function gnews(query: string): Promise<NewsItem[]> {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 6000)
    const res = await fetch(
      `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`,
      { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PoliticsGoBot/1.0; +https://politicsgo.app)' }, cache: 'no-store', signal: ctrl.signal }
    )
    clearTimeout(timer)
    if (!res.ok) return []
    return parseGoogleNews(await res.text()).slice(0, 12)
  } catch {
    return []
  }
}

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

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const phase = req.nextUrl.searchParams.get('phase') === '2' ? 2 : 1
  const admin = createSupabaseAdminClient()

  const [{ data: stateBoards }, { data: botRows }] = await Promise.all([
    admin.from('boards')
      .select('id, slug, name, state')
      .eq('category', 'state'),
    admin.from('profiles')
      .select('id, gyms!profiles_home_gym_id_fkey(state)')
      .like('clerk_user_id', 'bot%')
      .not('home_gym_id', 'is', null)
      .order('id'),
  ])
  if (!stateBoards?.length) return NextResponse.json({ error: 'No state boards' }, { status: 500 })

  const reporters: Record<string, string[]> = {}
  for (const b of botRows ?? []) {
    const st = (b as any).gyms?.state
    if (!st) continue
    ;(reporters[st] ??= []).length < 2 && reporters[st].push(b.id)
  }

  // one news query per state; HARD FILTER: state name must be in the headline
  const pools = new Map<string, NewsItem[]>()
  await mapLimit(stateBoards, 10, async b => {
    const items = (await gnews(`"${b.name}" when:1d`))
      .filter(i => i.title.toLowerCase().includes(b.name.toLowerCase()))
    if (items.length) pools.set(b.id, items)
  })

  // what's already on each state board (links + headlines, last 3 days)
  const existing = new Map<string, { links: Set<string>; titles: string[] }>()
  const boardIds = stateBoards.map(b => b.id)
  const since = new Date(Date.now() - 3 * 86400 * 1000).toISOString()
  for (let i = 0; i < boardIds.length; i += 100) {
    // paginate past PostgREST's silent 1,000-row read cap — truncation here
    // makes earlier posts invisible and causes doubles
    for (let off = 0; ; off += 1000) {
      const { data: rows } = await admin.from('hall_posts')
        .select('board_id, link_url, link_title, content')
        .in('board_id', boardIds.slice(i, i + 100))
        .gte('created_at', since)
        .range(off, off + 999)
      for (const r of rows ?? []) {
        const e = existing.get(r.board_id) ?? { links: new Set<string>(), titles: [] }
        if (r.link_url) e.links.add(r.link_url)
        const t = r.link_title ?? r.content
        if (t) e.titles.push(t)
        existing.set(r.board_id, e)
      }
      if (!rows || rows.length < 1000) break
    }
  }

  const rows: any[] = []
  let skippedDupe = 0 // boards whose entire fresh pool was already-covered stories
  for (const b of stateBoards) {
    const bots = reporters[b.state as string] ?? []
    const bot = phase === 1 ? bots[0] : bots[1]
    if (!bot) continue
    const e = existing.get(b.id) ?? { links: new Set<string>(), titles: [] }
    const subject = titleTokens(b.name)
    const pick = (pools.get(b.id) ?? []).find(item =>
      !e.links.has(item.link) && !e.titles.some(prev => sameStory(prev, item.title, subject)))
    if (!pick) { if (pools.get(b.id)?.length) skippedDupe++; continue } // nothing genuinely new with the state's name — skip
    e.links.add(pick.link)
    e.titles.push(pick.title)
    rows.push({
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
  await mapLimit(rows, 8, async (r: any) => {
    const a = await resolveArticle(r.link_url)
    r.link_url = a.url
    if (a.domain) r.link_domain = a.domain
    if (a.image) r.link_image = a.image
  })

  // HARD RULE (Michael, boards polish): no image, no bot link post
  const withImage = rows.filter((r: any) => typeof r.link_image === 'string' && /^https:\/\//.test(r.link_image))
  const skippedNoImage = rows.length - withImage.length

  let inserted = 0
  for (let i = 0; i < withImage.length; i += 500) {
    const { error } = await admin.from('hall_posts').insert(withImage.slice(i, i + 500))
    if (!error) inserted += Math.min(500, withImage.length - i)
    else console.error('state-news insert error:', error)
  }

  return NextResponse.json({
    ok: true,
    phase,
    inserted,
    skipped_no_image: skippedNoImage,
    skipped_dupe: skippedDupe,
    states: stateBoards.length,
    states_with_news: pools.size,
  })
}
