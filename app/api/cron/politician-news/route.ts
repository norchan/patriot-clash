import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { resolveArticle } from '@/lib/og-image'
import { sameStory } from '@/lib/content-unique'
import { POLITICIANS } from '@/config/politicians'

// POLITICIAN TRACKERS (Michael): dedicated, clearly-labeled tracker accounts
// ("WalzWatch", "MaceWatch") that repost what each politician said/posted
// today — headline + link + photo, up to 3 a day each, like a wire service
// for one person. Roster: one politician per state + the national figures
// (config/politicians.ts). NOT impersonation: the accounts never speak AS
// the politician (app-store / AdSense poison); they REPORT, with links.
//
// ROTATION (Michael): posts alternate run-by-run between p/politics and the
// politician's own STATE psub (national figures fall back to p/news).
// Every post is party-tagged, so it ALWAYS also appears in p/democrats or
// p/republicans — those are virtual windows over party-tagged posts.
//
// Source: Google News coverage (free, catches statements/speeches/social
// posts within hours — X/Truth/Facebook have no free APIs).

export const maxDuration = 300

// headlines about what they SAID (not just about them) rank first
const QUOTEY = /\b(says?|said|announc\w*|posts?|posted|slams?|calls?|warns?|touts?|propos\w*|responds?|statement|urges?|unveil\w*|defends?|blasts?|vows?|demands?|tells?|claims?|pledges?|signs?)\b/i

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
    if (/opinion|editorial|op-ed/i.test(title)) continue // reposts, not takes
    const src = source ? decodeEntities(source) : 'news'
    if (title.toLowerCase().endsWith(` - ${src.toLowerCase()}`)) title = title.slice(0, -(src.length + 3))
    out.push({ title: title.slice(0, 300), link: decodeEntities(link), source: src })
  }
  return out
}

async function gnews(query: string): Promise<NewsItem[]> {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 8000)
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

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let idx = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++
      results[i] = await fn(items[i], i)
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

  const [{ data: politicsBoard }, { data: newsBoard }, { data: stateBoardRows }] = await Promise.all([
    admin.from('boards').select('id').eq('slug', 'politics').maybeSingle(),
    admin.from('boards').select('id').eq('slug', 'news').maybeSingle(),
    admin.from('boards').select('id, state').eq('category', 'state'),
  ])
  if (!politicsBoard) return NextResponse.json({ error: 'p/politics board missing' }, { status: 500 })
  const stateBoards = new Map((stateBoardRows ?? []).filter(b => b.state).map(b => [b.state as string, b.id]))

  // ── ensure every tracker account exists (idempotent, batched) ────────────
  const clerkIds = POLITICIANS.map(p => `bot_tracker_${p.key}`)
  const { data: existing } = await admin.from('profiles')
    .select('id, clerk_user_id').in('clerk_user_id', clerkIds)
  const trackers = new Map<string, string>() // key → profile id
  for (const row of existing ?? []) trackers.set(row.clerk_user_id.replace('bot_tracker_', ''), row.id)
  const missing = POLITICIANS.filter(p => !trackers.has(p.key))
  if (missing.length) {
    const { data: created, error } = await admin.from('profiles').insert(missing.map(pol => ({
      clerk_user_id: `bot_tracker_${pol.key}`,
      username: pol.username,
      party: pol.party,
      onboarded: true,
      avatar_url: `/api/avatar/flag?party=${pol.party}`,
      about_me: `Unofficial tracker — reposting what ${pol.name} says in public, with links. Not affiliated with ${pol.name}.`,
      notification_prefs: { push: false, dm: false },
    }))).select('id, clerk_user_id')
    if (error) console.error('tracker create failed:', error)
    for (const row of created ?? []) trackers.set(row.clerk_user_id.replace('bot_tracker_', ''), row.id)
  }

  // ── dedupe window: p/politics + everything the trackers posted anywhere
  // (state-psub rotation posts live on other boards), last 3 days ──────────
  const since = new Date(Date.now() - 3 * 86400 * 1000).toISOString()
  const links = new Set<string>()
  const titles: string[] = []
  const trackerIds = [...trackers.values()]
  const seed = async (build: (q: any) => any) => {
    for (let off = 0; ; off += 1000) {
      const { data: rows } = await build(
        admin.from('hall_posts').select('link_url, link_title, content').gte('created_at', since))
        .range(off, off + 999)
      for (const r of rows ?? []) {
        if (r.link_url) links.add(r.link_url)
        const t = r.link_title ?? r.content
        if (t) titles.push(t)
      }
      if (!rows || rows.length < 1000) break
    }
  }
  await seed((q: any) => q.eq('board_id', politicsBoard.id))
  if (trackerIds.length) await seed((q: any) => q.in('profile_id', trackerIds))

  // ── one fresh "what they said" post per politician per run, boards
  // rotating politics ↔ their state psub run-by-run ────────────────────────
  const runIdx = Math.floor(Date.now() / (8 * 3600 * 1000))
  const results: Record<string, string> = {}
  let posted = 0, skippedDupe = 0, skippedNoImage = 0
  await mapLimit(POLITICIANS, 8, async (pol, i) => {
    const profileId = trackers.get(pol.key)
    if (!profileId) return
    const toStatePsub = (runIdx + i) % 2 === 1
    const boardId = toStatePsub
      ? (pol.state ? stateBoards.get(pol.state) : null) ?? newsBoard?.id ?? politicsBoard.id
      : politicsBoard.id
    const items = (await gnews(`"${pol.name}" when:1d`))
      .filter(it => it.title.includes(pol.lastName))
      // what they SAID first, coverage about them second
      .sort((a, b) => (QUOTEY.test(b.title) ? 1 : 0) - (QUOTEY.test(a.title) ? 1 : 0))
    for (const item of items) {
      if (links.has(item.link) || titles.some(t => sameStory(t, item.title))) { skippedDupe++; continue }
      links.add(item.link) // claim before the slow resolve — no double-posting a shared story
      const a = await resolveArticle(item.link)
      if (!a.image || !/^https:\/\//.test(a.image)) { skippedNoImage++; continue } // house rule
      const { error } = await admin.from('hall_posts').insert({
        board_id: boardId,
        profile_id: profileId,
        party: pol.party, // always party-tagged → always visible in the party psub
        content: `🎙️ ${item.title}`,
        link_url: a.url,
        link_title: item.title,
        link_domain: a.domain ?? item.source,
        link_image: a.image,
        score: 3 + Math.floor(Math.random() * 12),
        created_at: new Date().toISOString(),
      })
      if (!error) {
        posted++
        links.add(a.url); titles.push(item.title)
        results[pol.key] = `${toStatePsub ? '→state' : '→politics'} ${item.title.slice(0, 60)}`
      }
      break // one per politician per run
    }
  })

  return NextResponse.json({
    ok: true,
    posted,
    politicians: POLITICIANS.length,
    skipped_dupe: skippedDupe,
    skipped_no_image: skippedNoImage,
    results,
  })
}
