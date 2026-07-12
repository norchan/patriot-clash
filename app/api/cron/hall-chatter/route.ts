import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { openaiChat, cleanPostText } from '@/lib/openai'

// Hall-chatter bot: makes the Town Square feel alive by having bots leave
// RELEVANT, OpenAI-written comments on recent posts and replies to random
// existing comments — plus a few upvotes. Prioritises the freshest, least-
// commented posts so what a browsing player sees always has a conversation.
//
// Query params:
//   ?state=MN   only posts in halls in that state (used to seed a region now)
//   ?gym=<id>   only that hall
//   ?limit=40   posts to work this run (default 45)

export const maxDuration = 60

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]) }
  }))
  return out
}
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)]

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: 'OPENAI_API_KEY not set on server' }, { status: 500 })
  }

  const admin = createSupabaseAdminClient()
  const url = new URL(req.url)
  const state = url.searchParams.get('state')
  const gym = url.searchParams.get('gym')
  const limit = Math.min(80, Math.max(5, parseInt(url.searchParams.get('limit') ?? '45', 10)))

  // bots by party
  const { data: bots } = await admin.from('profiles').select('id, party').like('clerk_user_id', 'bot%')
  const byParty: Record<string, string[]> = { democrat: [], republican: [] }
  for (const b of bots ?? []) if (byParty[b.party]) byParty[b.party].push(b.id)
  if (!byParty.democrat.length || !byParty.republican.length) {
    return NextResponse.json({ error: 'no bots' }, { status: 500 })
  }

  // Which halls to consider
  let gymIds: string[] | null = null
  if (gym) gymIds = [gym]
  else if (state) {
    const ids: string[] = []
    for (let p = 0; p < 10; p++) {
      const { data } = await admin.from('gyms').select('id').eq('state', state).order('id').range(p * 1000, p * 1000 + 999)
      if (!data?.length) break
      ids.push(...data.map(g => g.id))
      if (data.length < 1000) break
    }
    gymIds = ids
  }

  // Recent, least-commented posts first
  let q = admin.from('hall_posts')
    .select('id, gym_id, content, link_title, comment_count, score')
    .eq('hidden', false)
    .gte('created_at', new Date(Date.now() - 36 * 3600 * 1000).toISOString())
    .order('comment_count', { ascending: true })
    .order('created_at', { ascending: false })
    .limit(limit)
  if (gymIds) q = q.in('gym_id', gymIds)
  const { data: posts } = await q
  if (!posts?.length) return NextResponse.json({ ok: true, note: 'no recent posts', commented: 0 })

  // existing comments for reply targets
  const { data: existing } = await admin.from('hall_comments')
    .select('id, post_id, content').in('post_id', posts.map(p => p.id)).limit(600)
  const commentsByPost: Record<string, { id: string; content: string }[]> = {}
  for (const c of existing ?? []) (commentsByPost[c.post_id] ??= []).push({ id: c.id, content: c.content })

  let commented = 0, replied = 0
  await mapLimit(posts, 5, async (post) => {
    const topic = (post.content || post.link_title || '').slice(0, 240)
    if (!topic) return

    // 1) a relevant top-level comment
    const party = Math.random() < 0.5 ? 'democrat' : 'republican'
    const lean = party === 'democrat' ? 'a progressive Democratic voter' : 'a conservative Republican voter'
    const comment = cleanPostText(await openaiChat([
      { role: 'system', content: `You are ${lean} chatting in a political town-square app. React to the post below with ONE short comment (max 22 words), punchy and opinionated, in your own voice. It must clearly relate to the post. No hashtags, no @mentions, no quotes.` },
      { role: 'user', content: topic },
    ], 60) ?? '')
    if (comment) {
      await admin.from('hall_comments').insert({ post_id: post.id, profile_id: pick(byParty[party]), content: comment.slice(0, 300), score: Math.floor(Math.random() * 6) })
      commented++
      // 2) reply to a random existing comment (if any)
      const pool = commentsByPost[post.id]
      if (pool?.length) {
        const target = pick(pool)
        const rparty = Math.random() < 0.5 ? 'democrat' : 'republican'
        const rlean = rparty === 'democrat' ? 'a progressive Democrat' : 'a conservative Republican'
        const reply = cleanPostText(await openaiChat([
          { role: 'system', content: `You are ${rlean} in a political town-square. Reply to this comment in ONE short line (max 18 words) — agree or push back, keep it conversational. No hashtags, no @mentions, no quotes.` },
          { role: 'user', content: `Post: ${topic}\nComment: ${target.content.slice(0, 200)}` },
        ], 50) ?? '')
        if (reply) {
          await admin.from('hall_comments').insert({ post_id: post.id, parent_id: target.id, profile_id: pick(byParty[rparty]), content: reply.slice(0, 300), score: Math.floor(Math.random() * 4) })
          replied++
        }
      }
    }

    // 3) a few upvotes so nothing sits at zero
    const bump = (post.comment_count ?? 0) + (comment ? 1 : 0) + (commentsByPost[post.id]?.length ? 1 : 0)
    await admin.from('hall_posts').update({
      comment_count: bump,
      score: (post.score ?? 0) + 2 + Math.floor(Math.random() * 7),
    }).eq('id', post.id)
  })

  return NextResponse.json({ ok: true, posts: posts.length, commented, replied })
}
