import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { fighterLevel } from '@/lib/fighter'

// GET /api/arena?bracket=all|rookie|contender|veteran|elite
//   → { me: {level, wins}, opponents: [...], today: [...], alltime: [...] }
// One round trip powers the whole Arena page: level-bracket opponent search
// plus national daily + all-time PvP rankings.

// fighterLevel(w) = 1 + floor(sqrt(w*1.5)) capped at 30 → invert for ranges
const winsForLevel = (lvl: number) => Math.ceil(((lvl - 1) ** 2) / 1.5)
const BRACKETS: Record<string, [number, number]> = {
  rookie: [1, 4], contender: [5, 9], veteran: [10, 19], elite: [20, 30],
}

export async function GET(req: NextRequest) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const bracket = req.nextUrl.searchParams.get('bracket') ?? 'all'

    let q = admin
      .from('profiles')
      .select('id, username, party, avatar_url, total_battles_won, total_battles_lost, clerk_user_id')
      .neq('id', profile.id)
      .not('party', 'is', null)
    if (BRACKETS[bracket]) {
      const [lo, hi] = BRACKETS[bracket]
      q = q.gte('total_battles_won', winsForLevel(lo))
      if (hi < 30) q = q.lt('total_battles_won', winsForLevel(hi + 1))
    }
    // random-ish rotation: order by a moving column so the pool shifts
    const { data: pool } = await q.order('updated_at', { ascending: false }).limit(400)

    // shuffle server-side and take a card's worth
    const shuffled = [...(pool ?? [])]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    const opponents = shuffled.slice(0, 12).map(p => ({
      id: p.id,
      username: p.username,
      party: p.party,
      avatar_url: p.avatar_url,
      level: fighterLevel(p.total_battles_won ?? 0),
      wins: p.total_battles_won ?? 0,
      losses: p.total_battles_lost ?? 0,
      is_bot: (p.clerk_user_id ?? '').startsWith('bot'),
    }))

    const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0)
    const [{ data: today }, { data: alltime }] = await Promise.all([
      admin.rpc('arena_rankings', { p_since: dayStart.toISOString(), p_limit: 25 }),
      admin.rpc('arena_rankings', { p_since: null, p_limit: 25 }),
    ])

    return NextResponse.json({
      me: {
        id: profile.id,
        level: fighterLevel(profile.total_battles_won ?? 0),
        wins: profile.total_battles_won ?? 0,
        fp: profile.fp_balance,
      },
      opponents,
      today: today ?? [],
      alltime: alltime ?? [],
    })
  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('arena error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
