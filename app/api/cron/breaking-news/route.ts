import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { resolveArticle } from '@/lib/og-image'
import { sameStory } from '@/lib/content-unique'

// BREAKING-NEWS ENGINE (Michael): something goes out hunting for the hot
// story of the hour and pins it to the top of p/all with artificial upvotes.
// TWO LANES since 2026-07-24 (the LeBron lesson — a mega sports story sat
// buried at score 4 while 108 posts covered it):
//  - NEWS lane: Google Top Stories → p/news at score 900-1100 (top of p/all)
//  - SPORTS lane: Google Sports desk → p/sports at score 620-750 — TOP of
//    p/sports and rides high on p/all without outranking hard news
// Rules per lane:
//  - ONE live breaking story at a time, 🚨 BREAKING prefix.
//  - No story reigns longer than 3 HOURS: every run demotes expired crowns
//    back to a normal score, then crowns a new story (sameStory + link
//    dedupe vs 3 days of that lane's crowns).
//  - House rules apply: real https og:image or the candidate is skipped.
//  - No OpenAI spend — RSS + og resolve only.

export const maxDuration = 120

const BREAKING_PREFIX = '🚨 BREAKING: '
const REIGN_MS = 3 * 3600 * 1000

interface Lane {
  key: string
  feed: string
  boardSlug: string
  /** crown score */
  crown: () => number
  /** freshness window for candidates (breaking means NOW; sports runs longer) */
  freshMs: number
}
const LANES: Lane[] = [
  {
    key: 'news',
    feed: 'https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en',
    boardSlug: 'news',
    crown: () => 900 + Math.floor(Math.random() * 200),
    freshMs: 6 * 3600 * 1000,
  },
  {
    key: 'sports',
    feed: 'https://news.google.com/rss/headlines/section/topic/SPORTS?hl=en-US&gl=US&ceid=US:en',
    boardSlug: 'sports',
    crown: () => 620 + Math.floor(Math.random() * 130),
    freshMs: 12 * 3600 * 1000,
  },
]

interface NewsItem { title: string; link: string; source: string }

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .trim()
}

function parseGoogleNews(xml: string, freshMs: number): NewsItem[] {
  const out: NewsItem[] = []
  const cutoff = Date.now() - freshMs
  for (const chunk of xml.split(/<item[\s>]/).slice(1)) {
    const body = chunk.split('</item>')[0]
    let title = /<title[^>]*>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/title>/.exec(body)?.[1]
    const link = /<link[^>]*>\s*(?:<!\[CDATA\[)?\s*(https?:[^<\]\s]+)/.exec(body)?.[1]
    const pub = /<pubDate>([^<]+)<\/pubDate>/.exec(body)?.[1]
    const source = /<source[^>]*>([^<]+)<\/source>/.exec(body)?.[1]
    if (!title || !link) continue
    // breaking means NOW — stale headlines don't qualify
    if (pub && !isNaN(Date.parse(pub)) && Date.parse(pub) < cutoff) continue
    title = decodeEntities(title)
    if (/^live[: ]|live updates|live blog/i.test(title)) continue // rolling live pages aren't a story
    const src = source ? decodeEntities(source) : 'news'
    if (title.toLowerCase().endsWith(` - ${src.toLowerCase()}`)) title = title.slice(0, -(src.length + 3))
    out.push({ title: title.slice(0, 280), link: decodeEntities(link), source: src })
  }
  return out
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const admin = createSupabaseAdminClient()

  const [{ data: boards }, { data: bots }, { data: reigning }] = await Promise.all([
    admin.from('boards').select('id, slug').in('slug', LANES.map(l => l.boardSlug)),
    admin.from('profiles').select('id').like('clerk_user_id', 'bot%').limit(400),
    // every crown of the last 3 days, all lanes (dedupe + reign bookkeeping)
    admin.from('hall_posts')
      .select('id, board_id, content, link_url, link_title, created_at, score')
      .like('content', `${BREAKING_PREFIX}%`)
      .gte('created_at', new Date(Date.now() - 3 * 86400 * 1000).toISOString())
      .order('created_at', { ascending: false })
      .limit(120),
  ])
  if (!bots?.length) return NextResponse.json({ error: 'no bots' }, { status: 500 })
  const boardId = new Map((boards ?? []).map(b => [b.slug, b.id]))

  const result: Record<string, any> = {}
  for (const lane of LANES) {
    const laneBoardId = boardId.get(lane.boardSlug)
    if (!laneBoardId) { result[lane.key] = 'board missing'; continue }
    const laneCrowns = (reigning ?? []).filter(p => p.board_id === laneBoardId)

    // ── 1. End expired reigns: crowns older than 3h fall back into the
    // normal feed (their real conversation keeps them alive or not) ────────
    let demoted = 0
    const live: typeof laneCrowns = []
    for (const p of laneCrowns) {
      if (Date.now() - +new Date(p.created_at) > REIGN_MS) {
        if ((p.score ?? 0) > 100) {
          const { error } = await admin.from('hall_posts')
            .update({ score: 25 + Math.floor(Math.random() * 35) })
            .eq('id', p.id)
          if (!error) demoted++
        }
      } else {
        live.push(p)
      }
    }
    if (live.length) {
      result[lane.key] = { demoted, posted: 0, reigning: (live[0].link_title ?? live[0].content ?? '').slice(0, 80) }
      continue // this lane's throne is occupied
    }

    // ── 2. Hunt the lane's hot story ─────────────────────────────────────
    let pool: NewsItem[] = []
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 8000)
      const res = await fetch(lane.feed,
        { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PoliticsGoBot/1.0; +https://politicsgo.app)' }, cache: 'no-store', signal: ctrl.signal })
      clearTimeout(timer)
      if (res.ok) pool = parseGoogleNews(await res.text(), lane.freshMs).slice(0, 10)
    } catch { /* feed hiccup — try again next hour */ }
    if (!pool.length) { result[lane.key] = { demoted, posted: 0, note: 'no fresh stories' }; continue }

    // a story only reigns once per lane
    const pastTitles = laneCrowns.map(p => (p.link_title ?? p.content ?? '').replace(BREAKING_PREFIX, ''))
    const pastLinks = new Set(laneCrowns.map(p => p.link_url).filter(Boolean))

    let posted = 0, skippedDupe = 0, skippedNoImage = 0
    for (const item of pool) {
      if (pastLinks.has(item.link) || pastTitles.some(t => sameStory(t, item.title))) { skippedDupe++; continue }
      const a = await resolveArticle(item.link)
      if (!a.image || !/^https:\/\//.test(a.image)) { skippedNoImage++; continue } // no image, no post — house rule
      const bot = bots[Math.floor(Math.random() * bots.length)]
      const { error } = await admin.from('hall_posts').insert({
        board_id: laneBoardId,
        profile_id: bot.id,
        party: null,
        content: BREAKING_PREFIX + item.title,
        link_url: a.url,
        link_title: item.title,
        link_domain: a.domain ?? item.source,
        link_image: a.image,
        score: lane.crown(),
        created_at: new Date().toISOString(),
      })
      if (!error) posted = 1
      break // crown ONE story per lane per run, win or lose
    }
    result[lane.key] = { demoted, posted, skipped_dupe: skippedDupe, skipped_no_image: skippedNoImage }
  }

  return NextResponse.json({ ok: true, ...result })
}
