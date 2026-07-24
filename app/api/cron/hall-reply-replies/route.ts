import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { openaiChat } from '@/lib/openai'
import { tooSimilar } from '@/lib/content-unique'

// SET 3 — REPLIES TO REPLIES (Michael 2026-07-22): 20 minutes after the reply
// run, 20 bots each find 5 random recent replies (comments) and reply to them
// (nested, parent_id = the comment). SAME HARD RULE: a bot never replies in
// the same town hall more than once per day (counting all of today's reply
// activity), and the per-day limit RESETS for a bot once it has covered every
// available hall — so states with few halls don't stall before 24h are up.
// Tunable: REPLY_BOTS, REPLIES_PER_BOT.

export const maxDuration = 300

const REPLY_BOTS = 20
const REPLIES_PER_BOT = 5

const shuffle = <T,>(a: T[]) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[b[i], b[j]] = [b[j], b[i]] } return b }
const startOfTodayISO = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString() }

async function replyToComment(commentText: string, avoid: string[]): Promise<string | null> {
  return openaiChat([
    { role: 'system', content: 'You write ONE short, casual reply to another neighbor\'s comment in a town message-board thread. React to THEIR comment naturally — agree, joke, riff, or gently disagree. Under 20 words. No hashtags, no @mentions, no quotes, never mention being an AI.' },
    { role: 'user', content: `${commentText}${avoid.length ? `\n\nReplies already in this thread (write something DIFFERENT — do not repeat or paraphrase any):\n${avoid.map(a => `- ${a}`).join('\n')}` : ''}` },
  ], 50, 1.0)
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const admin = createSupabaseAdminClient()

  // 20 random bots, and recent comments that live on a town-hall post
  const [{ data: bots }, { data: comments }] = await Promise.all([
    admin.from('profiles').select('id').like('clerk_user_id', 'bot%').limit(3000),
    admin.from('hall_comments')
      .select('id, post_id, content, hall_posts!hall_comments_post_id_fkey!inner(gym_id)')
      .not('hall_posts.gym_id', 'is', null)
      .gte('created_at', new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString())
      .order('created_at', { ascending: false })
      .limit(3000),
  ])
  if (!bots?.length || !comments?.length) return NextResponse.json({ ok: true, replied: 0 })
  const cand = comments.map((c: any) => ({ id: c.id, post_id: c.post_id, content: c.content, gym_id: c.hall_posts?.gym_id })).filter(c => c.gym_id)
  if (!cand.length) return NextResponse.json({ ok: true, replied: 0 })
  const cohort = shuffle(bots).slice(0, REPLY_BOTS)

  // halls each cohort bot already replied in TODAY (spans posts AND replies)
  const { data: todays } = await admin
    .from('hall_comments')
    .select('profile_id, hall_posts!hall_comments_post_id_fkey!inner(gym_id)')
    .in('profile_id', cohort.map(b => b.id))
    .gte('created_at', startOfTodayISO())
  const repliedToday = new Map<string, Set<string>>()
  for (const c of todays ?? []) {
    const gid = (c as any).hall_posts?.gym_id
    if (!gid) continue
    ;(repliedToday.get((c as any).profile_id) ?? repliedToday.set((c as any).profile_id, new Set()).get((c as any).profile_id)!).add(gid)
  }
  const allHallIds = new Set(cand.map(c => c.gym_id))

  const tasks: { botId: string; comment: typeof cand[number] }[] = []
  for (const bot of cohort) {
    let done = repliedToday.get(bot.id) ?? new Set<string>()
    if (done.size >= allHallIds.size) done = new Set() // covered every hall → reset to zero
    const usedGyms = new Set(done)
    let n = 0
    for (const c of shuffle(cand)) {
      if (n >= REPLIES_PER_BOT) break
      if (usedGyms.has(c.gym_id)) continue
      usedGyms.add(c.gym_id)
      tasks.push({ botId: bot.id, comment: c })
      n++
    }
  }

  // UNIQUENESS (boards polish Phase D): a nested reply must not echo the
  // parent comment or its existing sibling replies — the model sees them,
  // and a tooSimilar gate rejects near-dupes (one regenerate, then skip)
  const sibsByParent = new Map<string, string[]>()
  {
    const parentIds = [...new Set(tasks.map(t => t.comment.id))]
    for (let i = 0; i < parentIds.length; i += 100) {
      const { data: sibs } = await admin.from('hall_comments')
        .select('parent_id, content')
        .in('parent_id', parentIds.slice(i, i + 100))
        .limit(1000)
      for (const s of sibs ?? []) {
        if (s.content && s.parent_id) (sibsByParent.get(s.parent_id) ?? sibsByParent.set(s.parent_id, []).get(s.parent_id)!).push(s.content)
      }
    }
  }

  let replied = 0, skippedSimilar = 0
  const bump = new Map<string, number>()
  let ti = 0
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (ti < tasks.length) {
      const t = tasks[ti++]
      const sibs = sibsByParent.get(t.comment.id) ?? []
      // the parent itself counts — a reply that parrots what it answers is sludge
      const clash = (txt: string) => tooSimilar(t.comment.content ?? '', txt) || sibs.some(s => tooSimilar(s, txt))
      let text = await replyToComment(t.comment.content ?? '', sibs.slice(-8))
      if (text && clash(text)) text = await replyToComment(t.comment.content ?? '', sibs.slice(-8)) // one retry
      if (!text || clash(text)) { skippedSimilar++; continue }
      const { error } = await admin.from('hall_comments').insert({
        post_id: t.comment.post_id, parent_id: t.comment.id, profile_id: t.botId,
        content: text.slice(0, 300), score: Math.floor(Math.random() * 5),
      })
      if (!error) {
        replied++
        bump.set(t.comment.post_id, (bump.get(t.comment.post_id) ?? 0) + 1)
        sibs.push(text)
        sibsByParent.set(t.comment.id, sibs)
      }
    }
  }))
  // nested replies still count toward the post's comment tally
  for (const [postId, delta] of bump) {
    const { data: p } = await admin.from('hall_posts').select('comment_count').eq('id', postId).single()
    await admin.from('hall_posts').update({ comment_count: (p?.comment_count ?? 0) + delta }).eq('id', postId)
  }

  return NextResponse.json({ ok: true, bots: cohort.length, tasks: tasks.length, replied, skipped_similar: skippedSimilar })
}
