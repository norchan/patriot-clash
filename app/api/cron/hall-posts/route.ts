import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { openaiChat } from '@/lib/openai'

// SET 1 — HALL POSTS (Michael 2026-07-22): 3 bots in each state post to town
// halls in the state. HARD RULE: each post is relevant to the specific town
// hall it's posted in (about that city). One gpt-4o-mini call per hall
// returns 3 posts (one per state bot). Normal bot posts (48h expiry).
// Cadence after two rounds of cost tuning: cron fires every 6h and a
// ROTATION covers half the halls per cycle → every hall gets 3 fresh posts
// twice a day, ~4.7k OpenAI calls/day (~$1/day). Sharded (?shard=N&of=M) to
// fit the 300s cron window. Tunable: POSTS_PER_HALL.

export const maxDuration = 300

const POSTS_PER_HALL = 3
const CONCURRENCY = 10 // kept modest + openaiChat retries 429s → few skips
const TIME_BUDGET_MS = 275_000

const SYSTEM = `You write short, believable community-board posts from residents of a specific US town.
Return EXACTLY 3 posts as a JSON array of 3 strings — nothing else.
HARD RULES:
 - every post is about THIS town specifically, and must be BELIEVABLE for the stated time of year (no out-of-season references)
 - use varied angles: something happening around town, a shout-out or gripe about a LOCAL FIGURE BY ROLE ONLY (the mayor, the coach, the barista, a council member — NEVER a real person's name), or something the town is known for (a landmark, park, river, main street, diner)
 - do NOT claim a specific recent day (no "last Friday", "yesterday's game"); keep it timeless or season-general
 - casual and human, varied tone, under 180 characters each. No hashtags, no @mentions. Never state specific news as fact or name real living people.`

function seasonHint(): string {
  const d = new Date()
  const month = d.toLocaleString('en-US', { month: 'long' })
  const m = d.getMonth()
  const season = m <= 1 || m === 11 ? 'winter' : m <= 4 ? 'spring' : m <= 7 ? 'summer' : 'fall'
  const ok: Record<string, string> = {
    winter: 'snow, holidays, hockey/basketball, ice, cozy cafes, bundling up',
    spring: 'rain, blooming, baseball opening, cleanups, mud, allergies',
    summer: 'heat, farmers markets, baseball, county fairs, pools/lakes, cookouts, road work',
    fall: 'cooler weather, football, harvest, leaves, back-to-school, Halloween',
  }
  return `It is currently ${month} (${season}). Everything must fit ${season}: OK to mention ${ok[season]}. Do NOT mention out-of-season things (e.g. no football or fall festivals in summer, no snow in July, no pools in winter).`
}

async function generate(city: string, state: string, hint: string): Promise<string[] | null> {
  const txt = await openaiChat([
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `Town: ${city}, ${state}. ${hint}` },
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
  // ROTATION (Michael 2026-07-23, "the clean lever"): each 6h cycle covers
  // HALF the halls, alternating by cycle — every hall still gets fresh posts
  // twice a day, at half the OpenAI spend (~$1/day). Parity flips with the
  // 6-hour window, so cycles 00:00/12:00 take one half, 06:00/18:00 the other.
  const rot = Math.floor(Date.now() / (6 * 3600 * 1000)) % 2
  const mine = gyms.filter((_, i) => i % 2 === rot).filter((_, j) => j % of === shard)

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

  const hint = seasonHint()
  let inserted = 0, halls = 0, skipped = 0
  let idx = 0
  async function worker() {
    while (idx < mine.length) {
      if (Date.now() - started > TIME_BUDGET_MS) return
      const g = mine[idx++]
      const posts = await generate(g.city_name, g.state, hint)
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
