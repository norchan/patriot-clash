import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { openaiChat } from '@/lib/openai'

// SET 1 — HALL POSTS (Michael 2026-07-22): 3 bots in each state post to EVERY
// town hall in the state, every 3 hours. HARD RULE: each post is relevant to
// the specific town hall it's posted in (about that city). One gpt-4o-mini
// call per hall returns 3 posts (one per state bot). These are normal bot
// posts (expire in 48h) so halls stay fresh — the permanent seed is separate.
// Sharded (?shard=N&of=M) so the ~2,351 halls fit inside the 300s cron window
// across parallel jobs. Tunable: POSTS_PER_HALL.

export const maxDuration = 300

const POSTS_PER_HALL = 3
const CONCURRENCY = 10 // kept modest + openaiChat retries 429s → few skips
const TIME_BUDGET_MS = 275_000

const SYSTEM = `You write short, believable community-board posts from residents of a specific US town.
Return EXACTLY 3 posts as a JSON array of 3 strings — nothing else.
HARD RULE: every post is about THIS town specifically. Use these angles across the 3:
 - something happening in town (a local event, road work, the farmers market, a festival, a high-school game, a new shop)
 - a shout-out or gripe about a LOCAL FIGURE BY ROLE ONLY (the mayor, the coach, the barista, a city council member) — NEVER invent a real person's name
 - something the town is known for (a landmark, park, river, team, diner, main street)
Casual and human, varied tone, under 180 characters each. No hashtags, no @mentions. Do NOT state specific news as fact or name real living people.`

async function generate(city: string, state: string): Promise<string[] | null> {
  const txt = await openaiChat([
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `Town: ${city}, ${state}` },
  ], 240, 1.0)
  if (!txt) return null
  try {
    const arr = JSON.parse(txt.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim())
    if (Array.isArray(arr) && arr.length >= POSTS_PER_HALL) {
      return arr.slice(0, POSTS_PER_HALL).map((s: any) => String(s).slice(0, 240))
    }
  } catch { /* bad JSON — skip this hall this cycle */ }
  return null
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const shard = Math.max(0, parseInt(req.nextUrl.searchParams.get('shard') ?? '0', 10))
  const of = Math.max(1, parseInt(req.nextUrl.searchParams.get('of') ?? '1', 10))
  const admin = createSupabaseAdminClient()
  const started = Date.now()

  // all halls (this shard's slice), and the bots homed in each state
  const gyms: any[] = []
  for (let off = 0; ; off += 1000) {
    const { data } = await admin.from('gyms').select('id, city_name, state').order('id').range(off, off + 999)
    gyms.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  const mine = gyms.filter((_, i) => i % of === shard)

  const { data: botRows } = await admin
    .from('profiles')
    .select('id, party, gyms!profiles_home_gym_id_fkey(state)')
    .like('clerk_user_id', 'bot%')
    .order('id')
    .limit(3000)
  const byState = new Map<string, { id: string; party: string | null }[]>()
  const pool: { id: string; party: string | null }[] = []
  for (const b of botRows ?? []) {
    pool.push({ id: b.id, party: (b as any).party })
    const st = (b as any).gyms?.state
    if (st) (byState.get(st) ?? byState.set(st, []).get(st)!).push({ id: b.id, party: (b as any).party })
  }
  const pick3 = (state: string) => {
    const list = byState.get(state) ?? []
    const three = list.slice(0, 3)
    while (three.length < 3 && pool.length) three.push(pool[(three.length + state.length) % pool.length])
    return three
  }

  let inserted = 0, halls = 0, skipped = 0
  let idx = 0
  async function worker() {
    while (idx < mine.length) {
      if (Date.now() - started > TIME_BUDGET_MS) return
      const g = mine[idx++]
      const posts = await generate(g.city_name, g.state)
      if (!posts) { skipped++; continue }
      const bots = pick3(g.state)
      if (bots.length < POSTS_PER_HALL) { skipped++; continue }
      const rows = posts.map((content, i) => ({
        gym_id: g.id,
        profile_id: bots[i].id,
        party: bots[i].party ?? null,
        content,
        local: true,
        score: Math.floor(Math.random() * 6),
        created_at: new Date().toISOString(),
      }))
      const { error } = await admin.from('hall_posts').insert(rows)
      if (!error) { inserted += rows.length; halls++ }
      else skipped++
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))

  return NextResponse.json({
    ok: true, shard, of, halls_in_shard: mine.length, halls_posted: halls,
    posts_inserted: inserted, skipped, secs: Math.round((Date.now() - started) / 1000),
  })
}
