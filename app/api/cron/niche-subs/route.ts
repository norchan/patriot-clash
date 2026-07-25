import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { openaiChat, cleanPostText } from '@/lib/openai'
import { resolveArticle } from '@/lib/og-image'
import { sameStory, tooSimilar } from '@/lib/content-unique'

// NICHE-SUB CREWS (Michael, 2026-07-24): p/ufos and p/random-facts each get a
// dedicated 5-bot crew. Runs 5×/day:
//  - UFOs: the crew posts news articles about aliens / UAPs / UFOs (image-or-
//    skip + sameStory dedupe, house rules) — up to 2 per run.
//  - Random Facts: one crew bot per run posts a surprising true fact (text
//    post, tooSimilar-gated against the board's recent facts).
//  - BOTH boards: the same crews comment on posts, reply to comments, and
//    drift votes up AND down — the subs feel lived-in, not broadcast-only.
// Crews are deterministic slices of the bot roster so the same five names
// keep showing up in each sub (regulars, not randoms).

export const maxDuration = 300

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
    if (/opinion|editorial|horoscope/i.test(title)) continue
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

const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)]

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const admin = createSupabaseAdminClient()

  const [{ data: boards }, { data: botRows }] = await Promise.all([
    admin.from('boards').select('id, slug').in('slug', ['ufos', 'random-facts']),
    // deterministic crews: stable slices of the roster → the same five
    // regulars in each sub, and the two crews never overlap
    admin.from('profiles').select('id, username').like('clerk_user_id', 'bot%').order('clerk_user_id').range(30, 39),
  ])
  const ufoBoard = boards?.find(b => b.slug === 'ufos')
  const factBoard = boards?.find(b => b.slug === 'random-facts')
  if (!ufoBoard || !factBoard || !botRows || botRows.length < 10) {
    return NextResponse.json({ error: 'boards or bots missing' }, { status: 500 })
  }
  const ufoCrew = botRows.slice(0, 5)
  const factCrew = botRows.slice(5, 10)

  // recent content on both boards (dedupe + engagement targets)
  const since = new Date(Date.now() - 3 * 86400 * 1000).toISOString()
  const { data: recent } = await admin.from('hall_posts')
    .select('id, board_id, content, link_url, link_title, comment_count, score, created_at')
    .in('board_id', [ufoBoard.id, factBoard.id])
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(400)
  const ufoPosts = (recent ?? []).filter(p => p.board_id === ufoBoard.id)
  const factPosts = (recent ?? []).filter(p => p.board_id === factBoard.id)

  const stats: Record<string, number> = {
    ufo_posted: 0, facts_posted: 0, commented: 0, replied: 0, voted: 0,
    skipped_dupe: 0, skipped_no_image: 0, skipped_similar: 0,
  }

  // ── UFO lane: real articles about aliens / UAPs / UFOs ───────────────────
  {
    const links = new Set(ufoPosts.map(p => p.link_url).filter(Boolean))
    const titles = ufoPosts.map(p => p.link_title ?? p.content ?? '').filter(Boolean)
    const pool = await gnews('UFO OR UAP OR "unidentified anomalous" OR extraterrestrial when:1d')
    for (const item of pool) {
      if (stats.ufo_posted >= 2) break
      if (links.has(item.link) || titles.some(t => sameStory(t, item.title))) { stats.skipped_dupe++; continue }
      const a = await resolveArticle(item.link)
      if (!a.image || !/^https:\/\//.test(a.image)) { stats.skipped_no_image++; continue } // house rule
      const bot = pick(ufoCrew)
      const { error } = await admin.from('hall_posts').insert({
        board_id: ufoBoard.id,
        profile_id: bot.id,
        party: null,
        content: `👽 ${item.title}`,
        link_url: a.url,
        link_title: item.title,
        link_domain: a.domain ?? item.source,
        link_image: a.image,
        score: 2 + Math.floor(Math.random() * 9),
      })
      if (!error) { stats.ufo_posted++; links.add(item.link); links.add(a.url); titles.push(item.title) }
    }
  }

  // ── Random Facts lane: one fresh fact per run (text post) ────────────────
  {
    const prior = factPosts.map(p => p.content ?? '').filter(Boolean)
    const runIdx = Math.floor(Date.now() / (4.8 * 3600 * 1000))
    const bot = factCrew[runIdx % factCrew.length] // rotate the regulars
    const gen = () => openaiChat([
      { role: 'system', content: 'You share ONE surprising, TRUE random fact on a forum, in 1-2 punchy sentences (max 45 words). Any topic: science, history, animals, food, space, the human body. Start with the fact itself — no "Did you know". Never invent facts, no hashtags, no quotes around it, never mention being an AI.' },
      { role: 'user', content: `Give one random fact.${prior.length ? `\n\nFacts already posted (pick something COMPLETELY different):\n${prior.slice(0, 10).map(f => `- ${f.slice(0, 100)}`).join('\n')}` : ''}` },
    ], 90, 1.1)
    let fact = cleanPostText(await gen() ?? '')
    if (fact && prior.some(f => tooSimilar(f, fact))) fact = cleanPostText(await gen() ?? '')
    if (!fact || prior.some(f => tooSimilar(f, fact))) {
      stats.skipped_similar++
    } else {
      const { error } = await admin.from('hall_posts').insert({
        board_id: factBoard.id,
        profile_id: bot.id,
        party: null,
        content: `🧠 ${fact.slice(0, 400)}`,
        score: 2 + Math.floor(Math.random() * 9),
      })
      if (!error) stats.facts_posted++
    }
  }

  // ── Engagement: the crews live in their subs — comments, nested replies,
  // and honest-looking vote drift on BOTH boards ───────────────────────────
  for (const { board, posts, crew, flavor } of [
    { board: ufoBoard, posts: ufoPosts, crew: ufoCrew, flavor: 'a UFO/UAP enthusiast forum. React like a regular: intrigued, skeptical, or joking about disclosure' },
    { board: factBoard, posts: factPosts, crew: factCrew, flavor: 'a random-facts forum. React like a regular: amazed, doubtful, or adding a related tidbit' },
  ]) {
    void board
    const targets = posts.filter(p => (p.comment_count ?? 0) < 8).slice(0, 6)
    for (const p of targets) {
      if (Math.random() > 0.6) continue
      const topic = (p.link_title ?? p.content ?? '').slice(0, 200)
      if (!topic) continue
      const { data: thread } = await admin.from('hall_comments')
        .select('id, content').eq('post_id', p.id).limit(20)
      const existing = (thread ?? []).map(c => c.content).filter(Boolean) as string[]
      const gen = () => openaiChat([
        { role: 'system', content: `You write ONE short casual comment (max 20 words) on ${flavor}. No hashtags, no quotes, never mention being an AI.` },
        { role: 'user', content: `Post: ${topic}${existing.length ? `\n\nAlready said (be DIFFERENT):\n${existing.slice(-6).map(e => `- ${e}`).join('\n')}` : ''}` },
      ], 50, 1.0)
      let text = await gen()
      if (text && existing.some(e => tooSimilar(e, text!))) text = await gen()
      if (!text || existing.some(e => tooSimilar(e, text!))) { stats.skipped_similar++; continue }
      const { error } = await admin.from('hall_comments').insert({
        post_id: p.id, profile_id: pick(crew).id, content: text.slice(0, 300),
        score: Math.floor(Math.random() * 6),
      })
      if (!error) {
        stats.commented++
        await admin.from('hall_posts').update({ comment_count: (p.comment_count ?? 0) + 1 }).eq('id', p.id)
        // sometimes a crewmate answers the comment — a little thread
        if (Math.random() < 0.45 && text) {
          const reply = await openaiChat([
            { role: 'system', content: `You write ONE short reply (max 16 words) to another commenter on ${flavor}. No hashtags, no quotes, never mention being an AI.` },
            { role: 'user', content: `Their comment: ${text}` },
          ], 40, 1.0)
          if (reply && !tooSimilar(text, reply) && !existing.some(e => tooSimilar(e, reply))) {
            const { data: parent } = await admin.from('hall_comments')
              .select('id').eq('post_id', p.id).order('created_at', { ascending: false }).limit(1).maybeSingle()
            if (parent) {
              const { error: e2 } = await admin.from('hall_comments').insert({
                post_id: p.id, parent_id: parent.id, profile_id: pick(crew).id,
                content: reply.slice(0, 300), score: Math.floor(Math.random() * 4),
              })
              if (!e2) {
                stats.replied++
                await admin.from('hall_posts').update({ comment_count: (p.comment_count ?? 0) + 2 }).eq('id', p.id)
              }
            }
          }
        }
      }
    }
    // vote drift: mostly up, real downs too (Michael)
    for (const p of posts.slice(0, 20)) {
      if (Math.random() > 0.7) continue
      const delta = Math.random() < 0.75
        ? 1 + Math.floor(Math.random() * 6)
        : -(1 + Math.floor(Math.random() * 3))
      const { error } = await admin.from('hall_posts')
        .update({ score: Math.max(0, (p.score ?? 0) + delta) }).eq('id', p.id)
      if (!error) stats.voted++
    }
  }

  return NextResponse.json({ ok: true, ...stats, crews: { ufo: ufoCrew.map(b => b.username), facts: factCrew.map(b => b.username) } })
}
