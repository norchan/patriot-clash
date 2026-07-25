import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { openaiChat } from '@/lib/openai'
import { resolveArticle } from '@/lib/og-image'
import { sameStory, tooSimilar } from '@/lib/content-unique'

// OPENSECRETS CREW (Michael, 2026-07-25): three bots take turns walking
// opensecrets.org's news page and posting fresh article links to p/opensecrets.
// The cron runs HOURLY but only the bot whose turn it is acts (hour % 3), so
// the three are spaced in a timed sequence — each effectively works every
// 3 hours and they never double up. House rules: never a duplicate (link +
// sameStory vs 7 days), og image or skip. The on-duty bot also drops a
// comment or two and sometimes a nested reply on arbitrary posts in the sub.

export const maxDuration = 300

const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' }

// opensecrets.org Cloudflare-403s ALL datacenter fetches (index, articles,
// even their RSS) — verified 2026-07-25. Discovery therefore rides Google
// News RSS (site:opensecrets.org/news), and resolveArticle's batchexecute
// decode recovers the real article URL without ever fetching their site.
async function fetchNewsLinks(): Promise<{ url: string; title: string }[]> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 10000)
    const feed = `https://news.google.com/rss/search?q=${encodeURIComponent('site:opensecrets.org/news when:30d')}&hl=en-US&gl=US&ceid=US:en`
    const r = await fetch(feed, { headers: UA, cache: 'no-store', signal: ctrl.signal })
    clearTimeout(t)
    if (!r.ok) return []
    const xml = await r.text()
    const out: { url: string; title: string }[] = []
    const seen = new Set<string>()
    for (const chunk of xml.split(/<item[\s>]/).slice(1)) {
      const body = chunk.split('</item>')[0]
      let title = /<title[^>]*>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/title>/.exec(body)?.[1]?.trim()
      const link = /<link[^>]*>\s*(?:<!\[CDATA\[)?\s*(https?:[^<\]\s]+)/.exec(body)?.[1]
      if (!title || !link || seen.has(link)) continue
      title = title.replace(/&amp;/g, '&').replace(/&#0?39;/g, "'").replace(/&quot;/g, '"')
        .replace(/\s+-\s+OpenSecrets\s*$/i, '').trim()
      // search/archive/profile index pages sneak into the site: query
      if (/you searched for|^archives\b|donor lookup|organization search|profile: summary/i.test(title)) continue
      if (title.length < 15) continue
      seen.add(link)
      out.push({ url: link, title: title.slice(0, 280) })
      if (out.length >= 15) break
    }
    return out
  } catch {
    return []
  }
}

// Because their og:images are unreachable from datacenters, posts fall back
// to a rotating branded card pool (generated locally, avatars bucket).
const CARD_POOL = [1, 2, 3, 4].map(n =>
  `https://kwwvvkrooefaoqaggdrl.supabase.co/storage/v1/object/public/avatars/boards/opensecrets/card${n}.png`)
const hash32 = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h) }

const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)]

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const admin = createSupabaseAdminClient()

  const [{ data: board }, { data: crew }] = await Promise.all([
    admin.from('boards').select('id').eq('slug', 'opensecrets').maybeSingle(),
    // three regulars — a stable roster slice, distinct from the other crews
    admin.from('profiles').select('id, username').like('clerk_user_id', 'bot%').order('clerk_user_id').range(40, 42),
  ])
  if (!board || !crew || crew.length < 3) return NextResponse.json({ error: 'board or crew missing' }, { status: 500 })

  // the timed sequence: hour % 3 picks whose shift it is
  const shift = new Date().getUTCHours() % 3
  const bot = crew[shift]

  // everything already on the sub (7 days — OpenSecrets pieces stay current)
  const { data: recent } = await admin.from('hall_posts')
    .select('id, content, link_url, link_title, comment_count, score')
    .eq('board_id', board.id)
    .gte('created_at', new Date(Date.now() - 7 * 86400 * 1000).toISOString())
    .order('created_at', { ascending: false })
    .limit(200)
  const links = new Set((recent ?? []).map(p => p.link_url).filter(Boolean))
  const titles = (recent ?? []).map(p => p.link_title ?? p.content ?? '').filter(Boolean)

  const stats = { shift, bot: bot.username, posted: 0, commented: 0, replied: 0, skipped_dupe: 0, skipped_junk: 0 }

  // ── post one fresh article (never a double) ──────────────────────────────
  for (const item of await fetchNewsLinks()) {
    if (stats.posted >= 1) break
    if (titles.some(t => sameStory(t, item.title))) { stats.skipped_dupe++; continue }
    const a = await resolveArticle(item.url)
    // only real article pages — kills profile/search/index pages the
    // site: query sneaks in
    if (!/opensecrets\.org\/news\/\d{4}\/\d{2}\//.test(a.url)) { stats.skipped_junk++; continue }
    if (links.has(a.url)) { stats.skipped_dupe++; continue }
    const image = a.image && /^https:\/\//.test(a.image)
      ? a.image
      : CARD_POOL[hash32(a.url) % CARD_POOL.length]
    const { error } = await admin.from('hall_posts').insert({
      board_id: board.id,
      profile_id: bot.id,
      party: null, // money-in-politics reporting stays non-partisan
      content: `💰 ${item.title}`,
      link_url: a.url,
      link_title: item.title,
      link_domain: a.domain ?? 'opensecrets.org',
      link_image: image,
      score: 2 + Math.floor(Math.random() * 9),
    })
    if (!error) { stats.posted++; links.add(a.url); titles.push(item.title) }
  }

  // ── the on-duty bot hangs around: comments on arbitrary posts + sometimes
  // a nested reply, all uniqueness-gated ───────────────────────────────────
  const targets = (recent ?? []).filter(p => (p.comment_count ?? 0) < 6).sort(() => Math.random() - 0.5).slice(0, 2)
  for (const p of targets) {
    const topic = (p.link_title ?? p.content ?? '').slice(0, 200)
    if (!topic) continue
    const { data: thread } = await admin.from('hall_comments')
      .select('id, content').eq('post_id', p.id).limit(20)
    const existing = (thread ?? []).map(c => c.content).filter(Boolean) as string[]
    const gen = () => openaiChat([
      { role: 'system', content: 'You write ONE short casual comment (max 20 words) on a money-in-politics forum reacting to campaign finance news. Opinionated but civil, no hashtags, no quotes, never mention being an AI.' },
      { role: 'user', content: `Post: ${topic}${existing.length ? `\n\nAlready said (be DIFFERENT):\n${existing.slice(-6).map(e => `- ${e}`).join('\n')}` : ''}` },
    ], 50, 1.0)
    let text = await gen()
    if (text && existing.some(e => tooSimilar(e, text!))) text = await gen()
    if (!text || existing.some(e => tooSimilar(e, text!))) continue
    const { error } = await admin.from('hall_comments').insert({
      post_id: p.id, profile_id: bot.id, content: text.slice(0, 300),
      score: Math.floor(Math.random() * 5),
    })
    if (!error) {
      stats.commented++
      await admin.from('hall_posts').update({ comment_count: (p.comment_count ?? 0) + 1 }).eq('id', p.id)
      // sometimes reply to an existing comment (nested)
      if (Math.random() < 0.4 && thread?.length) {
        const parent = pick(thread)
        const reply = await openaiChat([
          { role: 'system', content: 'You write ONE short reply (max 16 words) to another commenter about campaign finance news. No hashtags, no quotes, never mention being an AI.' },
          { role: 'user', content: `Their comment: ${parent.content}` },
        ], 40, 1.0)
        if (reply && !tooSimilar(parent.content ?? '', reply) && !existing.some(e => tooSimilar(e, reply))) {
          const { error: e2 } = await admin.from('hall_comments').insert({
            post_id: p.id, parent_id: parent.id, profile_id: bot.id,
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

  return NextResponse.json({ ok: true, ...stats })
}
