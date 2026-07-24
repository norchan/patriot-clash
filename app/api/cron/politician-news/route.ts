import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { resolveArticle } from '@/lib/og-image'
import { sameStory } from '@/lib/content-unique'

// POLITICIAN TRACKERS (Michael): dedicated, clearly-labeled tracker accounts
// ("WalzWatch") that repost what each politician said/posted today into
// p/politics — headline + link + photo, 2-3 a day, like a wire service for
// one person. NOT impersonation: the accounts never speak AS the politician
// (app-store / AdSense poison); they REPORT the politician, with links.
// Source: Google News coverage of each politician (free, catches their
// statements, speeches, and social posts within hours — X/Truth/Facebook
// have no free APIs, news coverage is the reliable path).

export const maxDuration = 300

// Balanced roster; add a politician = add a row (profile auto-created).
const POLITICIANS = [
  { key: 'walz', name: 'Tim Walz', username: 'WalzWatch', party: 'democrat' },
  { key: 'trump', name: 'Donald Trump', username: 'TrumpTracker', party: 'republican' },
  { key: 'vance', name: 'JD Vance', username: 'VanceWatch', party: 'republican' },
  { key: 'newsom', name: 'Gavin Newsom', username: 'NewsomTracker', party: 'democrat' },
  { key: 'aoc', name: 'Alexandria Ocasio-Cortez', username: 'AOCWatch', party: 'democrat' },
  { key: 'johnson', name: 'Mike Johnson', username: 'SpeakerWatch', party: 'republican' },
] as const

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

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const admin = createSupabaseAdminClient()

  const { data: politicsBoard } = await admin.from('boards').select('id').eq('slug', 'politics').maybeSingle()
  if (!politicsBoard) return NextResponse.json({ error: 'p/politics board missing' }, { status: 500 })

  // ── ensure the tracker accounts exist (idempotent) ───────────────────────
  const trackers = new Map<string, string>() // key → profile id
  for (const pol of POLITICIANS) {
    const clerkId = `bot_tracker_${pol.key}`
    const { data: existing } = await admin.from('profiles').select('id').eq('clerk_user_id', clerkId).maybeSingle()
    if (existing) { trackers.set(pol.key, existing.id); continue }
    const { data: created, error } = await admin.from('profiles').insert({
      clerk_user_id: clerkId,
      username: pol.username,
      party: pol.party,
      onboarded: true,
      avatar_url: `/api/avatar/flag?party=${pol.party}`,
      about_me: `Unofficial tracker — reposting what ${pol.name} says in public, with links. Not affiliated with ${pol.name}.`,
      notification_prefs: { push: false, dm: false },
    }).select('id').single()
    if (error) console.error('tracker create failed:', pol.key, error)
    if (created) trackers.set(pol.key, created.id)
  }

  // ── what's already on p/politics (links + titles, 3 days) ────────────────
  const since = new Date(Date.now() - 3 * 86400 * 1000).toISOString()
  const links = new Set<string>()
  const titles: string[] = []
  for (let off = 0; ; off += 1000) {
    const { data: rows } = await admin.from('hall_posts')
      .select('link_url, link_title, content')
      .eq('board_id', politicsBoard.id)
      .gte('created_at', since)
      .range(off, off + 999)
    for (const r of rows ?? []) {
      if (r.link_url) links.add(r.link_url)
      const t = r.link_title ?? r.content
      if (t) titles.push(t)
    }
    if (!rows || rows.length < 1000) break
  }

  // ── one fresh "what they said" post per politician per run ───────────────
  const results: Record<string, string> = {}
  let posted = 0, skippedDupe = 0, skippedNoImage = 0
  for (const pol of POLITICIANS) {
    const profileId = trackers.get(pol.key)
    if (!profileId) { results[pol.key] = 'no profile'; continue }
    const lastName = pol.name.split(' ').pop()!
    const items = (await gnews(`"${pol.name}" when:1d`))
      .filter(i => i.title.includes(lastName))
      // what they SAID first, coverage about them second
      .sort((a, b) => (QUOTEY.test(b.title) ? 1 : 0) - (QUOTEY.test(a.title) ? 1 : 0))
    let done = false
    for (const item of items) {
      if (links.has(item.link) || titles.some(t => sameStory(t, item.title))) { skippedDupe++; continue }
      const a = await resolveArticle(item.link)
      if (!a.image || !/^https:\/\//.test(a.image)) { skippedNoImage++; continue } // house rule
      const { error } = await admin.from('hall_posts').insert({
        board_id: politicsBoard.id,
        profile_id: profileId,
        party: pol.party,
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
        links.add(item.link); links.add(a.url); titles.push(item.title)
        results[pol.key] = item.title.slice(0, 80)
        done = true
      }
      break // one per politician per run
    }
    if (!done && !results[pol.key]) results[pol.key] = 'nothing fresh'
  }

  return NextResponse.json({ ok: true, posted, skipped_dupe: skippedDupe, skipped_no_image: skippedNoImage, results })
}
