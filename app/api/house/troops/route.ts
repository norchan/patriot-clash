import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { rateLimited, rateLimitResponse } from '@/lib/ratelimit'
import { armyCap, RUSH_MIN_FP } from '@/config/house'
import { troopById, troopsForParty, armyPower, armyBonus } from '@/config/troops'

// TROOPS (Michael 2026-08-04; queue + timers 2026-08-06). GET = barracks,
// army, and the TRAINING QUEUE; POST {type,count} = enqueue (FP paid now,
// units land when their timers finish); POST {rush:true} = pay to finish the
// whole queue instantly. Same lazy-settlement pattern as house upgrades:
// troops_settle runs before every read/mutation, no cron. Costs and durations
// come from config, never the client.

async function barracksLevel(admin: any, profileId: string): Promise<number> {
  const { data } = await admin.from('house_buildings')
    .select('level').eq('profile_id', profileId).eq('type', 'barracks').maybeSingle()
  return data?.level ?? 0
}

/** The rush quote — the SQL function recomputes this authoritatively; the
 *  quote can only drift by the seconds between GET and tap. */
function rushQuote(queue: Array<{ count: number; secs_each: number; cost_each: number; started_at: string | null }>): number {
  let cost = 0
  for (const r of queue) {
    if (r.started_at) {
      const frac = 1 - Math.min(1, Math.max(0, (Date.now() - +new Date(r.started_at)) / 1000 / r.secs_each))
      cost += r.cost_each * (r.count - 1 + frac)
    } else cost += r.cost_each * r.count
  }
  return cost > 0 ? Math.max(RUSH_MIN_FP, Math.ceil(cost * 0.4)) : 0
}

async function fullState(admin: any, profileId: string) {
  await admin.rpc('troops_settle', { p_profile_id: profileId })
  const [lvl, { data: rows }, { data: qrows }] = await Promise.all([
    barracksLevel(admin, profileId),
    admin.from('house_troops').select('troop_type, count').eq('profile_id', profileId),
    admin.from('house_troop_queue')
      .select('id, troop_type, count, secs_each, cost_each, started_at')
      .eq('profile_id', profileId).order('id'),
  ])
  const counts: Record<string, number> = {}
  for (const r of rows ?? []) counts[r.troop_type] = r.count
  const queue = qrows ?? []
  // when each queue row fully completes (sequential from the head)
  let cursor = queue.length && queue[0].started_at ? +new Date(queue[0].started_at) : Date.now()
  const queueOut = queue.map((r: any) => {
    const nextUnitAt = cursor + r.secs_each * 1000
    cursor += r.count * r.secs_each * 1000
    return { type: r.troop_type, count: r.count, secs_each: r.secs_each, next_unit_at: new Date(nextUnitAt).toISOString(), done_at: new Date(cursor).toISOString() }
  })
  const power = armyPower(counts)
  const queuedTotal = queue.reduce((s: number, r: any) => s + r.count, 0)
  return {
    barracks_level: lvl,
    capacity: lvl > 0 ? armyCap(lvl) : 0,
    counts,
    total: Object.values(counts).reduce((s, n) => s + n, 0),
    power,
    bonus: armyBonus(power),
    queue: queueOut,
    queued_total: queuedTotal,
    queue_done_at: queueOut.length ? queueOut[queueOut.length - 1].done_at : null,
    rush_cost: rushQuote(queue),
  }
}

export async function GET() {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    return NextResponse.json(await fullState(admin, profile.id))
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

    // ── pay to finish the whole queue now ──
    if (body?.rush === true) {
      const { data, error } = await admin.rpc('rush_troop_queue', { p_profile_id: profile.id })
      if (error) {
        const m = error.message
        if (m.includes('QUEUE_EMPTY')) return NextResponse.json({ error: 'Nothing is training' }, { status: 400 })
        if (m.includes('INSUFFICIENT_FP')) return NextResponse.json({ error: 'INSUFFICIENT_FP', message: 'Not enough FP to rush' }, { status: 400 })
        console.error('rush_troop_queue failed:', error)
        return NextResponse.json({ error: 'Could not rush' }, { status: 500 })
      }
      return NextResponse.json({ ok: true, spent: data })
    }

    // ── enqueue training ──
    const def = typeof body?.type === 'string' ? troopById(body.type) : undefined
    const count = Number(body?.count)
    if (!def) return NextResponse.json({ error: 'Unknown troop type' }, { status: 400 })
    if (!Number.isInteger(count) || count < 1 || count > 50) {
      return NextResponse.json({ error: 'count must be 1-50' }, { status: 400 })
    }
    if (def.party !== profile.party) {
      return NextResponse.json({ error: 'Those troops fight for the other side' }, { status: 400 })
    }
    const lvl = await barracksLevel(admin, profile.id)
    if (lvl <= 0) return NextResponse.json({ error: 'Build a Barracks first' }, { status: 400 })
    if (lvl < def.unlockLevel) {
      return NextResponse.json({ error: `${def.name} unlocks at Barracks Lv ${def.unlockLevel}` }, { status: 400 })
    }

    const { error } = await admin.rpc('queue_troops', {
      p_profile_id: profile.id,
      p_troop_type: def.id,
      p_count: count,
      p_cost_each: def.cost,
      p_secs_each: def.trainSecs,
      p_army_cap: armyCap(lvl),
    })
    if (error) {
      const m = error.message
      if (m.includes('ARMY_CAP')) return NextResponse.json({ error: 'ARMY_CAP', message: `Army + queue is full (${armyCap(lvl)} at Barracks Lv ${lvl})` }, { status: 400 })
      if (m.includes('INSUFFICIENT_FP')) return NextResponse.json({ error: 'INSUFFICIENT_FP', message: `Need ${def.cost * count} FP` }, { status: 400 })
      console.error('queue_troops failed:', error)
      return NextResponse.json({ error: 'Could not queue' }, { status: 500 })
    }
    return NextResponse.json({ ok: true, type: def.id, queued: count, spent: def.cost * count, secs_each: def.trainSecs })
  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('POST /api/house/troops error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
