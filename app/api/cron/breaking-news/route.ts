import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { resolveArticle } from '@/lib/og-image'
import { sameStory } from '@/lib/content-unique'

// BREAKING-NEWS ENGINE (Michael): something goes out hunting for the hot
// story of the hour and pins it to the top of p/all with artificial upvotes.
// Rules:
//  - ONE live breaking story at a time, posted to p/news with a 🚨 BREAKING
//    prefix and a score high enough to top p/all's Top sort.
//  - No story reigns longer than 3 HOURS: every run first demotes expired
//    breaking posts back to a normal score, then crowns a new story (if a
//    genuinely different one exists — sameStory + link dedupe vs 3 days).
//  - Source: Google News' curated Top Stories feed — editorially "breaking"
//    by definition, no OpenAI spend.
//  - House rules apply: real https og:image or the candidate is skipped.

export const maxDuration = 120

const BREAKING_PREFIX = '🚨 BREAKING: '
const REIGN_MS = 3 * 3600 * 1000

interface NewsItem { title: string; link: string; source: string }

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .trim()
}

function parseGoogleNews(xml: string): NewsItem[] {
  const out: NewsItem[] = []
  const sixHoursAgo = Date.now() - 6 * 3600 * 1000
  for (const chunk of xml.split(/<item[\s>]/).slice(1)) {
    const body = chunk.split('</item>')[0]
    let title = /<title[^>]*>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/title>/.exec(body)?.[1]
    const link = /<link[^>]*>\s*(?:<!\[CDATA\[)?\s*(https?:[^<\]\s]+)/.exec(body)?.[1]
    const pub = /<pubDate>([^<]+)<\/pubDate>/.exec(body)?.[1]
    const source = /<source[^>]*>([^<]+)<\/source>/.exec(body)?.[1]
    if (!title || !link) continue
    // breaking means NOW — stale top stories don't qualify
    if (pub && !isNaN(Date.parse(pub)) && Date.parse(pub) < sixHoursAgo) continue
    title = decodeEntities(title)
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

  // ── 1. End expired reigns: breaking posts older than 3h fall back into the
  // normal feed (their real conversation keeps them alive or not) ───────────
  const { data: reigning } = await admin.from('hall_posts')
    .select('id, content, link_url, link_title, created_at, score')
    .like('content', `${BREAKING_PREFIX}%`)
    .gte('created_at', new Date(Date.now() - 3 * 86400 * 1000).toISOString())
    .order('created_at', { ascending: false })
    .limit(60)
  let demoted = 0
  const live: typeof reigning = []
  for (const p of reigning ?? []) {
    if (Date.now() - +new Date(p.created_at) > REIGN_MS) {
      if ((p.score ?? 0) > 100) {
        const { error } = await admin.from('hall_posts')
          .update({ score: 25 + Math.floor(Math.random() * 35) })
          .eq('id', p.id)
        if (!error) demoted++
      }
    } else {
      live!.push(p)
    }
  }

  // one story reigns at a time — if the throne is occupied, we're done
  if (live!.length) {
    return NextResponse.json({ ok: true, demoted, posted: 0, reigning: live![0].link_title ?? live![0].content })
  }

  // ── 2. Hunt the new hot story: Google News curated Top Stories ────────────
  let pool: NewsItem[] = []
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 8000)
    const res = await fetch('https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en',
      { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PoliticsGoBot/1.0; +https://politicsgo.app)' }, cache: 'no-store', signal: ctrl.signal })
    clearTimeout(timer)
    if (res.ok) pool = parseGoogleNews(await res.text()).slice(0, 10)
  } catch { /* feed hiccup — try again next hour */ }
  if (!pool.length) return NextResponse.json({ ok: true, demoted, posted: 0, note: 'no fresh top stories' })

  // dedupe vs every breaking post of the last 3 days (a story only reigns once)
  const pastTitles = (reigning ?? []).map(p => (p.link_title ?? p.content ?? '').replace(BREAKING_PREFIX, ''))
  const pastLinks = new Set((reigning ?? []).map(p => p.link_url).filter(Boolean))

  const { data: newsBoard } = await admin.from('boards').select('id').eq('slug', 'news').maybeSingle()
  if (!newsBoard) return NextResponse.json({ error: 'p/news board missing' }, { status: 500 })
  const { data: bots } = await admin.from('profiles').select('id').like('clerk_user_id', 'bot%').limit(400)
  if (!bots?.length) return NextResponse.json({ error: 'no bots' }, { status: 500 })

  let posted = 0, skippedDupe = 0, skippedNoImage = 0
  for (const item of pool) {
    if (pastLinks.has(item.link) || pastTitles.some(t => sameStory(t, item.title))) { skippedDupe++; continue }
    const a = await resolveArticle(item.link)
    if (!a.image || !/^https:\/\//.test(a.image)) { skippedNoImage++; continue } // no image, no post — house rule
    const bot = bots[Math.floor(Math.random() * bots.length)]
    const { error } = await admin.from('hall_posts').insert({
      board_id: newsBoard.id,
      profile_id: bot.id,
      party: null,
      content: BREAKING_PREFIX + item.title,
      link_url: a.url,
      link_title: item.title,
      link_domain: a.domain ?? item.source,
      link_image: a.image,
      score: 900 + Math.floor(Math.random() * 200), // tops p/all until dethroned
      created_at: new Date().toISOString(),
    })
    if (!error) { posted = 1 }
    break // crown ONE story per run, win or lose
  }

  return NextResponse.json({ ok: true, demoted, posted, skipped_dupe: skippedDupe, skipped_no_image: skippedNoImage })
}
