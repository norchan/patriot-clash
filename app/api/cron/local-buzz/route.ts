import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { openaiChat, cleanPostText } from '@/lib/openai'

// Local-buzz bot: small towns get almost nothing from news RSS, so a bot
// writes ONE genuinely LOCAL community post per hall — an upcoming event
// (concert, festival, farmers market, parade, local sports) or a hometown-
// interest note — worded as a resident's post, specific to that town. Runs a
// rotating batch each hour so every hall is covered over a day; never repeats
// a post already in that hall.
//
// Query params:
//   ?state=MN   seed every hall in a state now (used for St. Peter / Mankato)
//   ?gym=<id>   one hall
//   ?limit=120  halls per run (default 140 for the hourly rotating batch)

export const maxDuration = 60

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]) }
  }))
  return out
}

const KINDS = [
  'an upcoming live music show or concert', 'a town festival or fair', 'a farmers market or craft market',
  'a parade or community celebration', 'a high school or college sports game', 'a fundraiser or charity event',
  'a new local business or restaurant opening', 'a hometown human-interest note', 'a park, trail, or lake outing',
  'a school or library event',
]
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
  const gymId = url.searchParams.get('gym')
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') ?? '140', 10)))

  const { data: bots } = await admin.from('profiles').select('id').like('clerk_user_id', 'bot%')
  if (!bots?.length) return NextResponse.json({ error: 'no bots' }, { status: 500 })

  // Load candidate halls
  const halls: { id: string; city_name: string; state: string }[] = []
  for (let p = 0; p < 10; p++) {
    let q = admin.from('gyms').select('id, city_name, state').order('id').range(p * 1000, p * 1000 + 999)
    if (gymId) q = admin.from('gyms').select('id, city_name, state').eq('id', gymId)
    else if (state) q = admin.from('gyms').select('id, city_name, state').eq('state', state).order('id').range(p * 1000, p * 1000 + 999)
    const { data } = await q
    if (!data?.length) break
    halls.push(...data)
    if (gymId || data.length < 1000) break
  }
  if (!halls.length) return NextResponse.json({ ok: true, note: 'no halls' })

  // Rotating batch when not targeting
  let batch = halls
  if (!gymId && !state) {
    const nBatches = Math.max(1, Math.ceil(halls.length / limit))
    const idx = Math.floor(Date.now() / (3600 * 1000)) % nBatches
    batch = halls.slice(idx * limit, idx * limit + limit)
  } else {
    batch = halls.slice(0, limit)
  }

  // Recent content per hall for dedupe (last 4 days)
  const { data: recent } = await admin.from('hall_posts')
    .select('gym_id, content')
    .in('gym_id', batch.map(h => h.id))
    .gte('created_at', new Date(Date.now() - 4 * 24 * 3600 * 1000).toISOString())
  const seen: Record<string, Set<string>> = {}
  for (const r of recent ?? []) if (r.content) (seen[r.gym_id] ??= new Set()).add(r.content.trim().toLowerCase())

  let posted = 0
  const rows: any[] = []
  await mapLimit(batch, 5, async (h) => {
    const kind = pick(KINDS)
    const text = cleanPostText(await openaiChat([
      { role: 'system', content: `You write short LOCAL community social posts for a town's message board. Write it as an enthusiastic resident, 1-2 sentences, under 180 characters, specific to the named town. No hashtags, no links, no @mentions, no quotes.` },
      { role: 'user', content: `Town: ${h.city_name}, ${h.state}. Topic: ${kind}. Write one local post a resident of ${h.city_name} would share.` },
    ], 80) ?? '')
    if (!text) return
    if (seen[h.id]?.has(text.trim().toLowerCase())) return
    rows.push({
      gym_id: h.id,
      profile_id: bots[Math.floor(Math.random() * bots.length)].id,
      content: text.slice(0, 400),
      score: 2 + Math.floor(Math.random() * 9),
      created_at: new Date().toISOString(),
    })
    posted++
  })

  for (let i = 0; i < rows.length; i += 500) {
    await admin.from('hall_posts').insert(rows.slice(i, i + 500))
  }

  return NextResponse.json({ ok: true, halls: batch.length, posted })
}
