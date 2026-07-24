import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { resolveArticle } from '@/lib/og-image'

// Local-news bot: bots share LOCAL stories into each hall's Town Square —
// city news first (via a Google News query for the hall's own town), state
// news as the fallback. Only articles from the last 24 hours, max two
// posts per hall per run. City queries are expensive (one HTTP fetch per
// town), so each run city-scans a rotating batch of halls while every hall
// still gets the fresh state pool. Runs 4x daily from pg_cron.
// HARD RULE (Michael, boards polish): every link post needs a real photo —
// articles that don't resolve an og:image are SKIPPED, not posted bare.

export const maxDuration = 300

const CITY_BATCH = 250 // halls that get a dedicated city query this run

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

interface NewsItem { title: string; link: string; source: string }

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .trim()
}

// Google News RSS: title ends with " - Source"; <source> carries the outlet
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
    if (pub && !isNaN(Date.parse(pub)) && Date.parse(pub) < dayAgo) continue // 24h freshness
    title = decodeEntities(title)
    if (/obituary/i.test(title)) continue
    const src = source ? decodeEntities(source) : 'news'
    // strip the trailing " - Source" Google appends to titles
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
    admin.from('profiles').select('id, party').like('clerk_user_id', 'bot%'),
    pageAll<{ id: string; city_name: string; state: string }>((from, to) =>
      admin.from('gyms').select('id, city_name, state').order('id').range(from, to)),
  ])
  if (!bots?.length || !gyms.length) {
    return NextResponse.json({ error: 'No gyms or bots found' }, { status: 500 })
  }

  // ── State pools: one query per distinct state, shared by all its halls ───
  const states = [...new Set(gyms.map(g => g.state))].filter(s => STATE_NAMES[s])
  const statePools: Record<string, NewsItem[]> = {}
  await mapLimit(states, 8, async s => { statePools[s] = await gnews(`${STATE_NAMES[s]} news when:1d`) })

  // NO national pool: local slots carry LOCAL stories only (Michael's rule —
  // national wire content was masquerading as hometown news)

  // ── City pools: rotating batch — every run city-scans the next slice ─────
  const sorted = [...gyms].sort((a, b) => a.id.localeCompare(b.id))
  const nBatches = Math.max(1, Math.ceil(sorted.length / CITY_BATCH))
  const batchIdx = Math.floor(Date.now() / (6 * 3600 * 1000)) % nBatches
  const cityBatch = sorted.slice(batchIdx * CITY_BATCH, (batchIdx + 1) * CITY_BATCH)
  const cityPools = new Map<string, NewsItem[]>()
  await mapLimit(cityBatch, 10, async g => {
    const items = await gnews(`"${g.city_name}" ${STATE_NAMES[g.state] ?? g.state} when:1d`)
    // a city query that mostly echoes state news is fine — it was scoped to the town
    if (items.length) cityPools.set(g.id, items)
  })

  // ── Dedupe: which halls already have which of today's links ─────────────
  const allLinks = [...new Set([
    ...Object.values(statePools).flat().map(i => i.link),
    ...[...cityPools.values()].flat().map(i => i.link),
  ])]
  const seen = new Set<string>()
  for (let i = 0; i < allLinks.length; i += 150) {
    const chunk = allLinks.slice(i, i + 150)
    const rows = await pageAll<{ gym_id: string; link_url: string }>((from, to) =>
      admin.from('hall_posts').select('gym_id, link_url').in('link_url', chunk).order('id').range(from, to))
    rows.forEach(r => seen.add(`${r.gym_id}|${r.link_url}`))
  }

  // ── Build posts: city stories first, state stories fill in — max 2 ──────
  const rows: any[] = []
  for (const gym of gyms) {
    const cityItems = shuffle(cityPools.get(gym.id) ?? [])
    const stateItems = shuffle(statePools[gym.state] ?? [])
    const picks: NewsItem[] = []
    for (const item of [...cityItems, ...stateItems]) {
      if (picks.length >= 2) break
      if (seen.has(`${gym.id}|${item.link}`)) continue
      if (picks.some(p => p.link === item.link)) continue
      picks.push(item)
    }
    for (const item of picks) {
      seen.add(`${gym.id}|${item.link}`)
      const bot = bots[Math.floor(Math.random() * bots.length)]
      // LOCAL posts must NAME the town/state — if the headline doesn't, the
      // post body pins it explicitly
      const stateName = STATE_NAMES[gym.state] ?? gym.state
      const namesPlace = item.title.includes(gym.city_name) || item.title.includes(stateName) || item.title.includes(gym.state)
      rows.push({
        gym_id: gym.id,
        profile_id: bot.id,
        party: (bot as any).party ?? null,
        content: namesPlace ? item.title : `${gym.city_name}, ${gym.state} — ${item.title}`,
        link_url: item.link,
        link_title: item.title,
        link_domain: item.source,
        score: Math.floor(Math.random() * 10),
        created_at: new Date(Date.now() - Math.random() * 3 * 3600 * 1000).toISOString(),
        local: true, // hometown news → shows in the Local tab
      })
    }
  }

  // ── Resolve each UNIQUE link once (state-pool stories are shared by many
  // halls), then require a real https og:image — no image, no post ─────────
  const uniqLinks = [...new Set(rows.map(r => r.link_url as string))]
  const resolved = new Map<string, { url: string; domain: string | null; image: string | null }>()
  const deadline = Date.now() + 240_000 // stay inside maxDuration
  await mapLimit(uniqLinks, 10, async l => {
    if (Date.now() > deadline) return
    resolved.set(l, await resolveArticle(l))
  })
  for (const r of rows) {
    const a = resolved.get(r.link_url)
    if (!a) continue
    r.link_url = a.url
    if (a.domain) r.link_domain = a.domain
    if (a.image && /^https:\/\//.test(a.image)) r.link_image = a.image
  }
  const withImage = rows.filter(r => r.link_image)
  const skippedNoImage = rows.length - withImage.length

  let inserted = 0
  for (let i = 0; i < withImage.length; i += 500) {
    const { error } = await admin.from('hall_posts').insert(withImage.slice(i, i + 500))
    if (!error) inserted += Math.min(500, withImage.length - i)
  }

  return NextResponse.json({
    ok: true,
    inserted,
    skipped_no_image: skippedNoImage,
    links_resolved: resolved.size,
    gyms: gyms.length,
    city_scanned: cityBatch.length,
    city_with_news: cityPools.size,
    states: states.length,
  })
}
