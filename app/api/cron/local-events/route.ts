import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

// Local-events bot: once an hour a bot shares something FUN and local into a
// hall's Town Square — a concert, festival, parade, county fair, local sports
// game, or hometown headline for that hall's own city. City queries are
// expensive (one HTTP fetch per town), so each hourly run scans a rotating
// batch of halls; over a day every hall gets covered. Never reposts a link a
// hall already has. Separate from local-news (headlines) on purpose.

export const maxDuration = 60

const CITY_BATCH = 260 // halls that get a dedicated events query this run

const STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri',
  MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio',
  OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  DC: 'Washington DC',
}

// Rotating flavors so the same town gets variety across days
const EVENT_QUERIES = [
  '(concert OR "live music" OR show OR tour)',
  '(festival OR fair OR parade OR celebration)',
  '(high school OR college) sports (game OR team OR championship)',
  '(event OR fundraiser OR market OR "grand opening" OR community)',
]

interface NewsItem { title: string; link: string; source: string }

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .trim()
}

function parseGoogleNews(xml: string): NewsItem[] {
  const out: NewsItem[] = []
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000
  for (const chunk of xml.split(/<item[\s>]/).slice(1)) {
    const body = chunk.split('</item>')[0]
    let title = /<title[^>]*>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/title>/.exec(body)?.[1]
    const link = /<link[^>]*>\s*(?:<!\[CDATA\[)?\s*(https?:[^<\]\s]+)/.exec(body)?.[1]
    const pub = /<pubDate>([^<]+)<\/pubDate>/.exec(body)?.[1]
    const source = /<source[^>]*>([^<]+)<\/source>/.exec(body)?.[1]
    if (!title || !link) continue
    if (pub && !isNaN(Date.parse(pub)) && Date.parse(pub) < weekAgo) continue
    title = decodeEntities(title)
    if (/obituary/i.test(title)) continue
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
    return parseGoogleNews(await res.text()).slice(0, 8)
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

const shuffle = <T,>(arr: T[]) => arr.map(v => [Math.random(), v] as const).sort((a, b) => a[0] - b[0]).map(([, v]) => v)

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createSupabaseAdminClient()

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
    admin.from('profiles').select('id').like('clerk_user_id', 'bot%'),
    pageAll<{ id: string; city_name: string; state: string }>((from, to) =>
      admin.from('gyms').select('id, city_name, state').order('id').range(from, to)),
  ])
  if (!bots?.length || !gyms.length) {
    return NextResponse.json({ error: 'No gyms or bots found' }, { status: 500 })
  }

  // ── Rotating hourly batch: which slice of halls gets an events scan now ──
  const hour = Math.floor(Date.now() / (3600 * 1000))
  const sorted = [...gyms].sort((a, b) => a.id.localeCompare(b.id))
  const nBatches = Math.max(1, Math.ceil(sorted.length / CITY_BATCH))
  const batchIdx = hour % nBatches
  const batch = sorted.slice(batchIdx * CITY_BATCH, (batchIdx + 1) * CITY_BATCH)
  const flavor = EVENT_QUERIES[hour % EVENT_QUERIES.length]

  const cityPools = new Map<string, NewsItem[]>()
  await mapLimit(batch, 10, async g => {
    const items = await gnews(`"${g.city_name}" ${STATE_NAMES[g.state] ?? g.state} ${flavor} when:7d`)
    if (items.length) cityPools.set(g.id, items)
  })

  // ── Dedupe against links each hall already has ──────────────────────────
  const allLinks = [...new Set([...cityPools.values()].flat().map(i => i.link))]
  const seen = new Set<string>()
  for (let i = 0; i < allLinks.length; i += 150) {
    const chunk = allLinks.slice(i, i + 150)
    const rows = await pageAll<{ gym_id: string; link_url: string }>((from, to) =>
      admin.from('hall_posts').select('gym_id, link_url').in('link_url', chunk).order('id').range(from, to))
    rows.forEach(r => seen.add(`${r.gym_id}|${r.link_url}`))
  }

  // ── One fresh event post per hall in the batch ──────────────────────────
  const rows: any[] = []
  for (const gym of batch) {
    const items = shuffle(cityPools.get(gym.id) ?? [])
    const pick = items.find(i => !seen.has(`${gym.id}|${i.link}`))
    if (!pick) continue
    seen.add(`${gym.id}|${pick.link}`)
    rows.push({
      gym_id: gym.id,
      profile_id: bots[Math.floor(Math.random() * bots.length)].id,
      content: pick.title,
      link_url: pick.link,
      link_title: pick.title,
      link_image: null,
      link_domain: pick.source,
      score: Math.floor(Math.random() * 8),
      created_at: new Date().toISOString(),
    })
  }

  let inserted = 0
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.from('hall_posts').insert(rows.slice(i, i + 500))
    if (!error) inserted += Math.min(500, rows.length - i)
  }

  return NextResponse.json({
    ok: true,
    inserted,
    batch: batch.length,
    city_with_events: cityPools.size,
    flavor,
  })
}
