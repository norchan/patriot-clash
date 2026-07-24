import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { resolveArticle } from '@/lib/og-image'

// SPORTS-REPORTER BOTS — the one bot behavior that survived the 2026-07-20
// bot-content shutdown (Michael's explicit order, 2026-07-21). Two designated
// bots per state hunt fresh articles for every team psub in their state,
// every 6 hours, in TWO PASSES five minutes apart (?phase=1 then ?phase=2):
// the first reporter posts, then the second checks what's already on the
// board — by link AND by headline similarity, since Google News carries the
// same story from many outlets — and only posts a genuinely different story.
// No doubles (Michael, 2026-07-21). Teams with no fresh second story are
// skipped. States without a team (and Canadian teams) are skipped.

export const maxDuration = 120

// Same-story detection: token overlap between normalized headlines.
// "Vikings release TE Josh Oliver" vs "Vikings expected to release
// injury-riddled TE Josh Oliver - ESPN" → duplicate. The subject words
// (team name) are stripped first — they're shared by every headline — and
// paraphrase-tolerant 50% overlap flags the match.
function titleTokens(t: string, ignore?: Set<string>): Set<string> {
  return new Set(
    t.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      .filter(w => w.length > 2 && !ignore?.has(w)))
}
function sameStory(a: string, b: string, ignore?: Set<string>): boolean {
  const ta = titleTokens(a, ignore), tb = titleTokens(b, ignore)
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
    // listing junk (score pages, how-to-watch, betting) isn't team NEWS
    if (/live score|box ?score|game story, scores|scores\/highlights|tv channel|streaming options for|stream the game|how to watch|betting|odds|parlay|tickets/i.test(title)) continue
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
    return parseGoogleNews(await res.text()).slice(0, 10)
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
  // phase 1 = the first reporter; phase 2 (five minutes later) = the second,
  // who must not repeat any story already on the board
  const phase = req.nextUrl.searchParams.get('phase') === '2' ? 2 : 1
  const admin = createSupabaseAdminClient()

  // every US team board, and each state's two designated reporter bots
  // (deterministic: the two lowest-id bots homed in that state)
  const [{ data: teams }, { data: botRows }] = await Promise.all([
    admin.from('boards')
      .select('id, slug, name, state')
      .eq('category', 'sports')
      .not('state', 'is', null),
    admin.from('profiles')
      .select('id, gyms!profiles_home_gym_id_fkey(state)')
      .like('clerk_user_id', 'bot%')
      .not('home_gym_id', 'is', null)
      .order('id'),
  ])
  if (!teams?.length) return NextResponse.json({ error: 'No team boards' }, { status: 500 })

  const reporters: Record<string, string[]> = {}
  for (const b of botRows ?? []) {
    const st = (b as any).gyms?.state
    if (!st) continue
    ;(reporters[st] ??= []).length < 2 && reporters[st].push(b.id)
  }

  // one Google News query per team
  const pools = new Map<string, NewsItem[]>()
  await mapLimit(teams, 10, async t => {
    const items = await gnews(`"${t.name}" when:1d`)
    if (items.length) pools.set(t.id, items)
  })

  // what's already on each board (links + headlines, last 3 days) — the
  // second reporter must not repeat a story ANY outlet already covered here
  const existing = new Map<string, { links: Set<string>; titles: string[] }>()
  const teamIds = teams.map(t => t.id)
  const since = new Date(Date.now() - 3 * 86400 * 1000).toISOString()
  for (let i = 0; i < teamIds.length; i += 100) {
    // paginate: PostgREST silently caps each read at 1,000 rows — a truncated
    // read means invisible posts, and invisible posts mean DOUBLES (the
    // 2026-07-21 blast-run duplicates)
    for (let off = 0; ; off += 1000) {
      const { data: rows } = await admin.from('hall_posts')
        .select('board_id, link_url, link_title, content')
        .in('board_id', teamIds.slice(i, i + 100))
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

  // one article per team per phase — phase 1 posts as reporter #1, phase 2
  // as reporter #2, and NEVER a story the board already has
  const rows: any[] = []
  for (const t of teams) {
    const bots = reporters[t.state as string] ?? []
    const bot = phase === 1 ? bots[0] : bots[1]
    if (!bot) continue
    const e = existing.get(t.id) ?? { links: new Set<string>(), titles: [] }
    const subject = titleTokens(t.name)
    const pick = (pools.get(t.id) ?? []).find(item =>
      !e.links.has(item.link) && !e.titles.some(prev => sameStory(prev, item.title, subject)))
    if (!pick) continue // nothing genuinely new — skip, no doubles
    e.links.add(pick.link)
    e.titles.push(pick.title)
    rows.push({
      board_id: t.id,
      profile_id: bot,
      party: null, // sports boards stay non-partisan
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

  // HARD RULE (Michael, boards polish): no image, no bot link post — a
  // title/domain-only card reads like a broken Twitter card. Skip instead.
  const withImage = rows.filter((r: any) => typeof r.link_image === 'string' && /^https:\/\//.test(r.link_image))
  const skippedNoImage = rows.length - withImage.length

  let inserted = 0
  for (let i = 0; i < withImage.length; i += 500) {
    const { error } = await admin.from('hall_posts').insert(withImage.slice(i, i + 500))
    if (!error) inserted += Math.min(500, withImage.length - i)
    else console.error('team-news insert error:', error)
  }

  return NextResponse.json({
    ok: true,
    phase,
    inserted,
    skipped_no_image: skippedNoImage,
    teams: teams.length,
    teams_with_news: pools.size,
    states_with_reporters: Object.keys(reporters).length,
  })
}
