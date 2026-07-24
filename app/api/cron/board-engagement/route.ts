import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { openaiChat } from '@/lib/openai'
import { videoEmbed, videoAvailable } from '@/lib/video-embed'
import { tooSimilar } from '@/lib/content-unique'

// BOARD ENGAGEMENT BOTS (Michael, 2026-07-22): the boards should feel alive —
// replies on SOME (not all) posts, and real up/down vote movement. Every run:
//  - ~35% of the last 6 hours' board posts get 1-2 short bot replies
//    (OpenAI, casual commenter voice, grounded in the headline)
//  - every recent post gets vote drift (mostly up, sometimes down)
//  - recent comments get small vote drift too
// This is an approved exception to the bot-content shutdown, like the news
// reporters — engagement on link posts, not fake chatter threads.

export const maxDuration = 300

const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)]

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const admin = createSupabaseAdminClient()

  // ── video sweep: delete posts whose video got blocked/removed after posting
  // (NFL-style copyright takedowns render a dead "Video unavailable" frame) ──
  let videosRemoved = 0
  const { data: videoPosts } = await admin.from('hall_posts')
    .select('id, link_url')
    .not('board_id', 'is', null)
    .or('link_url.ilike.%youtube.com%,link_url.ilike.%youtu.be%,link_url.ilike.%tiktok.com%')
    .gte('created_at', new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString())
    .limit(200)
  for (const p of videoPosts ?? []) {
    if (!videoEmbed(p.link_url)) continue
    if (await videoAvailable(p.link_url)) continue
    const { error } = await admin.from('hall_posts').delete().eq('id', p.id)
    if (!error) videosRemoved++
  }

  const [{ data: posts }, { data: bots }] = await Promise.all([
    admin.from('hall_posts')
      .select('id, board_id, content, link_title, comment_count, score')
      .not('board_id', 'is', null)
      .eq('hidden', false)
      .gte('created_at', new Date(Date.now() - 6 * 3600 * 1000).toISOString()),
    admin.from('profiles').select('id, username').like('clerk_user_id', 'bot%').limit(400),
  ])
  if (!posts?.length || !bots?.length) return NextResponse.json({ ok: true, replied: 0, voted: 0, videosRemoved })

  // ── replies (Michael: more of them) — ~65% of posts with room for more
  // comments, not just empty ones, and 1-3 replies apiece.
  // UNIQUENESS (boards polish Phase D): the model sees what's already on the
  // post and must not repeat it; a tooSimilar gate rejects near-dupes anyway
  // (one regenerate, then skip — prefer silence over copy-paste sludge). ──
  const candidates = posts.filter(p => (p.comment_count ?? 0) < 3 && Math.random() < 0.65).slice(0, 150)
  const priorByPost = new Map<string, string[]>()
  if (candidates.length) {
    const ids = candidates.map(c => c.id)
    for (let i = 0; i < ids.length; i += 100) {
      const { data: prior } = await admin.from('hall_comments')
        .select('post_id, content')
        .in('post_id', ids.slice(i, i + 100))
        .limit(1000)
      for (const c of prior ?? []) {
        if (c.content) (priorByPost.get(c.post_id) ?? priorByPost.set(c.post_id, []).get(c.post_id)!).push(c.content)
      }
    }
  }
  let replied = 0, skippedSimilar = 0
  for (const p of candidates) {
    const headline = p.link_title ?? p.content ?? ''
    if (!headline) continue
    const nReplies = 1 + (Math.random() < 0.5 ? 1 : 0) + (Math.random() < 0.2 ? 1 : 0)
    const prior = priorByPost.get(p.id) ?? []
    let insertedHere = 0
    for (let i = 0; i < nReplies; i++) {
      const gen = () => openaiChat([
        { role: 'system', content: 'You write ONE short casual comment (max 22 words) reacting to a news headline on a forum. Sound like a regular person: opinionated but civil, no hashtags, no emojis in most replies, no quotes around the reply, never mention being an AI. Vary tone: sometimes funny, sometimes skeptical, sometimes genuinely interested.' },
        { role: 'user', content: `Headline: ${headline}${prior.length ? `\n\nComments already on this post (say something DIFFERENT — do not repeat or paraphrase any of these):\n${prior.slice(-8).map(a => `- ${a}`).join('\n')}` : ''}` },
      ], 60, 1.0)
      let text = await gen()
      if (text && prior.some(e => tooSimilar(e, text!))) text = await gen() // one retry
      if (!text || prior.some(e => tooSimilar(e, text!))) { skippedSimilar++; continue }
      const bot = pick(bots)
      const { error } = await admin.from('hall_comments').insert({
        post_id: p.id,
        profile_id: bot.id,
        content: text.slice(0, 300),
        score: Math.floor(Math.random() * 7),
      })
      if (!error) {
        replied++
        insertedHere++
        prior.push(text)
        priorByPost.set(p.id, prior)
        await admin.from('hall_posts')
          .update({ comment_count: (p.comment_count ?? 0) + insertedHere })
          .eq('id', p.id)
      }
    }
  }

  // ── vote drift on every recent post — bigger swings (Michael: more up AND
  // down votes). Mostly rising, but real downvotes too ─────────────────────
  let voted = 0
  for (const p of posts) {
    const delta = Math.random() < 0.76
      ? 1 + Math.floor(Math.random() * 10) // upvotes 1-10
      : -(1 + Math.floor(Math.random() * 4)) // downvotes 1-4
    const { error } = await admin.from('hall_posts')
      .update({ score: Math.max(0, (p.score ?? 0) + delta) })
      .eq('id', p.id)
    if (!error) voted++
  }

  // comments drift too — most of them move each run now
  const { data: comments } = await admin.from('hall_comments')
    .select('id, score')
    .gte('created_at', new Date(Date.now() - 12 * 3600 * 1000).toISOString())
    .limit(600)
  for (const c of comments ?? []) {
    if (Math.random() < 0.3) continue
    await admin.from('hall_comments')
      .update({ score: Math.max(0, (c.score ?? 0) + (Math.random() < 0.8 ? 1 + Math.floor(Math.random() * 4) : -(1 + Math.floor(Math.random() * 2)))) })
      .eq('id', c.id)
  }

  return NextResponse.json({ ok: true, replied, skipped_similar: skippedSimilar, voted, posts: posts.length, videosRemoved })
}
