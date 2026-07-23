import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { openaiChat } from '@/lib/openai'

// SET 2 — REPLIES TO HALL POSTS (Michael 2026-07-22): 20 minutes after the
// hall-posts run, 20 bots each find 5 random recent hall posts and reply.
// HARD RULE (same as everywhere): a bot never replies in the same town hall
// more than once per day — which scatters the replies arbitrarily across
// towns. If a bot has already replied in every available hall today, the
// per-day limit RESETS for that bot (small states don't stall). Tunable:
// REPLY_BOTS, REPLIES_PER_BOT.

export const maxDuration = 300

const REPLY_BOTS = 20
const REPLIES_PER_BOT = 5

const shuffle = <T,>(a: T[]) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[b[i], b[j]] = [b[j], b[i]] } return b }
const startOfTodayISO = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString() }

async function replyTo(postText: string): Promise<string | null> {
  return openaiChat([
    { role: 'system', content: 'You write ONE short, casual reply to a neighbor\'s post on a local town message board. React naturally to what they said — agree, joke, add a thought, or gently push back. Under 22 words. No hashtags, no @mentions, no quotes around it, never mention being an AI.' },
    { role: 'user', content: postText },
  ], 50, 1.0)
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const admin = createSupabaseAdminClient()

  // 20 random bots this cycle, and the pool of recent hall posts to reply to
  const [{ data: bots }, { data: posts }] = await Promise.all([
    admin.from('profiles').select('id').like('clerk_user_id', 'bot%').limit(3000),
    admin.from('hall_posts')
      .select('id, gym_id, content, link_title, comment_count')
      .not('gym_id', 'is', null)
      .eq('hidden', false)
      .gte('created_at', new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString())
      .order('created_at', { ascending: false })
      .limit(3000),
  ])
  if (!bots?.length || !posts?.length) return NextResponse.json({ ok: true, replied: 0 })
  const cohort = shuffle(bots).slice(0, REPLY_BOTS)

  // which halls has each cohort bot already replied in TODAY? (the hard rule)
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
  const allHallIds = new Set(posts.map(p => p.gym_id))

  // build (bot, post) tasks honoring one-per-hall-per-day, with reset
  const tasks: { botId: string; post: any }[] = []
  for (const bot of cohort) {
    let done = repliedToday.get(bot.id) ?? new Set<string>()
    if (done.size >= allHallIds.size) done = new Set() // exhausted every hall → reset to zero
    const usedGyms = new Set(done)
    let n = 0
    for (const post of shuffle(posts)) {
      if (n >= REPLIES_PER_BOT) break
      if (usedGyms.has(post.gym_id)) continue // already replied in this hall today (or picked it this run)
      usedGyms.add(post.gym_id)
      tasks.push({ botId: bot.id, post })
      n++
    }
  }

  // generate + insert; tally comment_count deltas per post
  let replied = 0
  const bump = new Map<string, number>()
  let ti = 0
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (ti < tasks.length) {
      const t = tasks[ti++]
      const text = await replyTo(t.post.link_title ?? t.post.content ?? '')
      if (!text) continue
      const { error } = await admin.from('hall_comments').insert({
        post_id: t.post.id, profile_id: t.botId, content: text.slice(0, 300),
        score: Math.floor(Math.random() * 5),
      })
      if (!error) { replied++; bump.set(t.post.id, (bump.get(t.post.id) ?? 0) + 1) }
    }
  }))
  for (const [postId, delta] of bump) {
    const base = posts.find(p => p.id === postId)?.comment_count ?? 0
    await admin.from('hall_posts').update({ comment_count: base + delta }).eq('id', postId)
  }

  return NextResponse.json({ ok: true, bots: cohort.length, tasks: tasks.length, replied })
}
