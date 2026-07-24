import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { openaiChat } from '@/lib/openai'
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

  // (video sweep moved to the dedicated HOURLY reels-sweep cron — the capped
  // 200-post pass here let blocked videos linger in the swipe feed)

  const [{ data: posts }, { data: bots }] = await Promise.all([
    admin.from('hall_posts')
      .select('id, board_id, content, link_title, comment_count, score')
      .not('board_id', 'is', null)
      .eq('hidden', false)
      .gte('created_at', new Date(Date.now() - 6 * 3600 * 1000).toISOString()),
    admin.from('profiles').select('id, username, party').like('clerk_user_id', 'bot%').limit(400),
  ])
  if (!posts?.length || !bots?.length) return NextResponse.json({ ok: true, replied: 0, voted: 0 })
  const demBots = bots.filter((b: any) => b.party === 'democrat')
  const repBots = bots.filter((b: any) => b.party === 'republican')

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

  // ── COMMENT GRAVITY + ARGUMENTS (Michael): the top of p/all must carry a
  // real conversation. The highest-scored posts of the last 24h (incl. the
  // breaking-news story) accumulate comments until they look ALIVE, and on
  // political posts the bots ARGUE — threaded dem-vs-rep reply chains hung
  // off the highest-upvoted comment, each turn pushing back on the last. ──
  let argued = 0
  const POLITICAL_SLUGS = new Set(['politics', 'news', 'democrats', 'republicans'])
  const { data: topPosts } = await admin.from('hall_posts')
    .select('id, content, link_title, comment_count, score, party, boards(slug)')
    .not('board_id', 'is', null)
    .eq('hidden', false)
    .gte('created_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString())
    .order('score', { ascending: false })
    .limit(5)
  for (const p of topPosts ?? []) {
    const headline = (p.link_title ?? p.content ?? '').replace(/^🚨 BREAKING: /, '')
    if (!headline || !demBots.length || !repBots.length) continue
    const target = 12 + Math.floor(Math.random() * 7) // a top post should look BUSY
    const room = Math.min(4, target - (p.comment_count ?? 0)) // per run, not all at once
    if (room <= 0) continue
    const political = !!p.party || POLITICAL_SLUGS.has((p as any).boards?.slug ?? '')

    const { data: thread } = await admin.from('hall_comments')
      .select('id, content, score, parent_id')
      .eq('post_id', p.id)
      .order('score', { ascending: false })
      .limit(40)
    const all = (thread ?? []).map(c => c.content).filter(Boolean) as string[]
    let added = 0

    // seed the room: a busy post needs top-level takes before a fight can start
    const topLevel = (thread ?? []).filter(c => !c.parent_id)
    while (topLevel.length < 2 && added < room) {
      const lean = Math.random() < 0.5 ? 'democrat' : 'republican'
      const voice = political
        ? `You are a ${lean === 'democrat' ? 'progressive Democratic voter' : 'conservative Republican voter'} on a political forum. React to the headline with ONE punchy opinionated comment (max 24 words).`
        : 'You write ONE short casual comment (max 22 words) reacting to a news headline on a forum. Sound like a regular person.'
      const text = await openaiChat([
        { role: 'system', content: `${voice} No hashtags, no @mentions, no quotes around it, never mention being an AI.` },
        { role: 'user', content: `Headline: ${headline}${all.length ? `\n\nAlready said (be DIFFERENT):\n${all.slice(-8).map(a => `- ${a}`).join('\n')}` : ''}` },
      ], 60, 1.0)
      if (!text || all.some(e => tooSimilar(e, text))) break
      const pool = lean === 'democrat' ? demBots : repBots
      const { data: newC } = await admin.from('hall_comments').insert({
        post_id: p.id, profile_id: pick(pool).id, content: text.slice(0, 300),
        score: 2 + Math.floor(Math.random() * 8),
      }).select('id, content, score, parent_id').single()
      if (!newC) break
      topLevel.push(newC as any); all.push(text); added++; argued++
    }

    // THE ARGUMENT: a reply chain under the highest-upvoted comment, sides
    // alternating, every turn answering the one before it
    const anchor = topLevel.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0]
    if (anchor && added < room) {
      let lastId = anchor.id
      let lastText = anchor.content ?? ''
      let lean: 'democrat' | 'republican' = Math.random() < 0.5 ? 'democrat' : 'republican'
      while (added < room) {
        const voice = political
          ? `You are a ${lean === 'democrat' ? 'progressive Democrat' : 'conservative Republican'} arguing politics in a forum thread. Push back on the LAST comment with your side's take — heated but civil, max 25 words.`
          : 'You write ONE short casual reply in a forum thread reacting to the last comment (max 20 words).'
        const text = await openaiChat([
          { role: 'system', content: `${voice} No hashtags, no @mentions, no quotes, no slurs, never mention being an AI.` },
          { role: 'user', content: `Post: ${headline}\nLast comment: ${lastText.slice(0, 200)}${all.length ? `\n\nAlready said in this thread (be DIFFERENT):\n${all.slice(-8).map(a => `- ${a}`).join('\n')}` : ''}` },
        ], 60, 1.0)
        if (!text || tooSimilar(lastText, text) || all.some(e => tooSimilar(e, text))) break
        const pool = lean === 'democrat' ? demBots : repBots
        const { data: newC } = await admin.from('hall_comments').insert({
          post_id: p.id, parent_id: lastId, profile_id: pick(pool).id,
          content: text.slice(0, 300), score: Math.floor(Math.random() * 5),
        }).select('id').single()
        if (!newC) break
        lastId = newC.id; lastText = text; all.push(text); added++; argued++
        lean = lean === 'democrat' ? 'republican' : 'democrat' // the other side answers
      }
    }

    if (added) {
      await admin.from('hall_posts')
        .update({ comment_count: (p.comment_count ?? 0) + added })
        .eq('id', p.id)
    }

    // rich-get-richer drift: the anchor comment pulls further ahead, so the
    // best take is VISIBLY the best take (and the next argument lands there)
    if (anchor) {
      await admin.from('hall_comments')
        .update({ score: (anchor.score ?? 0) + 3 + Math.floor(Math.random() * 7) })
        .eq('id', anchor.id)
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

  return NextResponse.json({ ok: true, replied, argued, skipped_similar: skippedSimilar, voted, posts: posts.length })
}
