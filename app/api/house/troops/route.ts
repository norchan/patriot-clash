import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { rateLimited, rateLimitResponse } from '@/lib/ratelimit'
import { armyCap } from '@/config/house'
import { troopById, troopsForParty, armyPower, armyBonus } from '@/config/troops'

// TROOPS (Michael 2026-08-04). GET = your barracks + army; POST = train.
// Costs come from config, never the client; the train_troops SQL function
// re-checks the cap and balance atomically under a per-profile lock.

async function barracksLevel(admin: any, profileId: string): Promise<number> {
  const { data } = await admin.from('house_buildings')
    .select('level').eq('profile_id', profileId).eq('type', 'barracks').maybeSingle()
  return data?.level ?? 0
}

export async function GET() {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const [lvl, { data: rows }] = await Promise.all([
      barracksLevel(admin, profile.id),
      admin.from('house_troops').select('troop_type, count').eq('profile_id', profile.id),
    ])
    const counts: Record<string, number> = {}
    for (const r of rows ?? []) counts[r.troop_type] = r.count
    const power = armyPower(counts)
    return NextResponse.json({
      barracks_level: lvl,
      capacity: lvl > 0 ? armyCap(lvl) : 0,
      counts,
      total: Object.values(counts).reduce((s, n) => s + n, 0),
      power,
      bonus: armyBonus(power),
    })
  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('GET /api/house/troops error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const profile = await requireProfile()
    if (rateLimited(`troops:${profile.id}`, 20, 60_000)) return rateLimitResponse()
    const admin = createSupabaseAdminClient()

    const body = await req.json()
    const def = typeof body?.type === 'string' ? troopById(body.type) : undefined
    const count = Number(body?.count)
    if (!def) return NextResponse.json({ error: 'Unknown troop type' }, { status: 400 })
    if (!Number.isInteger(count) || count < 1 || count > 50) {
      return NextResponse.json({ error: 'count must be 1-50' }, { status: 400 })
    }
    // your party's troops only — the roster is mirrored, no balance loss
    if (def.party !== profile.party) {
      return NextResponse.json({ error: 'Those troops fight for the other side' }, { status: 400 })
    }
    const lvl = await barracksLevel(admin, profile.id)
    if (lvl <= 0) return NextResponse.json({ error: 'Build a Barracks first' }, { status: 400 })
    if (lvl < def.unlockLevel) {
      return NextResponse.json({ error: `${def.name} unlocks at Barracks Lv ${def.unlockLevel}` }, { status: 400 })
    }

    const { data, error } = await admin.rpc('train_troops', {
      p_profile_id: profile.id,
      p_troop_type: def.id,
      p_count: count,
      p_cost_each: def.cost,
      p_army_cap: armyCap(lvl),
    })
    if (error) {
      const m = error.message
      if (m.includes('ARMY_CAP')) return NextResponse.json({ error: 'ARMY_CAP', message: `Army is full (${armyCap(lvl)} at Barracks Lv ${lvl}) — raid or upgrade` }, { status: 400 })
      if (m.includes('INSUFFICIENT_FP')) return NextResponse.json({ error: 'INSUFFICIENT_FP', message: `Need ${def.cost * count} FP` }, { status: 400 })
      console.error('train_troops failed:', error)
      return NextResponse.json({ error: 'Could not train' }, { status: 500 })
    }
    return NextResponse.json({ ok: true, type: def.id, count: data, spent: def.cost * count })
  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('POST /api/house/troops error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
