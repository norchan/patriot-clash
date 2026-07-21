import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

// SPORTS-REPORTER BOTS — the one bot behavior that survived the 2026-07-20
// bot-content shutdown (Michael's explicit order, 2026-07-21). Two designated
// bots per state hunt fresh articles for every team psub in their state and
// post them, every 6 hours: two articles per team board per run. States
// without a team (and Canadian teams without a state) are skipped.

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

  // dedupe against links already on each board
  const allLinks = [...new Set([...pools.values()].flat().map(i => i.link))]
  const seen = new Set<string>()
  for (let i = 0; i < allLinks.length; i += 150) {
    const { data: rows } = await admin.from('hall_posts')
      .select('board_id, link_url')
      .in('link_url', allLinks.slice(i, i + 150))
      .not('board_id', 'is', null)
    rows?.forEach((r: any) => seen.add(`${r.board_id}|${r.link_url}`))
  }

  // two fresh articles per team — one from each reporter
  const rows: any[] = []
  for (const t of teams) {
    const bots = reporters[t.state as string] ?? []
    if (!bots.length) continue
    const picks: NewsItem[] = []
    for (const item of pools.get(t.id) ?? []) {
      if (picks.length >= Math.min(2, bots.length)) break
      if (seen.has(`${t.id}|${item.link}`)) continue
      if (picks.some(p => p.link === item.link)) continue
      picks.push(item)
    }
    picks.forEach((item, i) => {
      seen.add(`${t.id}|${item.link}`)
      rows.push({
        board_id: t.id,
        profile_id: bots[i % bots.length],
        party: null, // sports boards stay non-partisan
        content: item.title,
        link_url: item.link,
        link_title: item.title,
        link_domain: item.source,
        score: Math.floor(Math.random() * 6),
        created_at: new Date(Date.now() - Math.random() * 40 * 60 * 1000).toISOString(),
      })
    })
  }

  let inserted = 0
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.from('hall_posts').insert(rows.slice(i, i + 500))
    if (!error) inserted += Math.min(500, rows.length - i)
    else console.error('team-news insert error:', error)
  }

  return NextResponse.json({
    ok: true,
    inserted,
    teams: teams.length,
    teams_with_news: pools.size,
    states_with_reporters: Object.keys(reporters).length,
  })
}
