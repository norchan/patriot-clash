import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { rateLimited, rateLimitResponse } from '@/lib/ratelimit'
import {
  PAD_UNLOCK_ORDER, FREE_PADS, FIXED_PADS, buildingDef, buildingCost,
  nextPadCost, TOWER_RATE_BY_LEVEL, TOWER_INTERVAL_SECS, TOWER_BANK_INTERVALS,
  TOWER_MAX_LEVEL, towerBanked,
  PICKUP_INTERVAL_SECS, PICKUP_BANK_CAP, PICKUP_MIN_FP, PICKUP_MAX_FP, pickupsBanked,
} from '@/config/house'

// CAMPAIGN HQ base — Phase 1 (Michael 2026-07-31).
// GET  → the whole yard state. POST → build / upgrade / unlock_pad / claim_tower.
//
// Costs are computed HERE from config and passed to atomic SQL functions —
// the client sends intentions (a pad, a type), never a price. Every mutation
// is one transaction: a failed insert/level/unlock rolls its spend back.

export async function GET() {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const { data: buildings } = await admin
      .from('house_buildings')
      .select('pad, type, level, claimed_at')
      .eq('profile_id', profile.id)

    const tower = (buildings ?? []).find(b => b.type === 'media_tower')
    const elapsed = tower ? (Date.now() - +new Date(tower.claimed_at)) / 1000 : 0
    const sweptElapsed = (Date.now() - +new Date((profile as any).yard_swept_at ?? Date.now())) / 1000
    const shieldUntil = (profile as any).house_shield_until
    return NextResponse.json({
      pads_unlocked: (profile as any).house_pads ?? FREE_PADS,
      next_pad_cost: nextPadCost((profile as any).house_pads ?? FREE_PADS),
      trophies: (profile as any).house_trophies ?? 0,
      shield_until: shieldUntil && new Date(shieldUntil) > new Date() ? shieldUntil : null,
      pickups: pickupsBanked(sweptElapsed),
      buildings: buildings ?? [],
      tower: tower ? {
        level: tower.level,
        banked: towerBanked(elapsed, tower.level),
        next_in_secs: Math.max(0, TOWER_INTERVAL_SECS - (elapsed % TOWER_INTERVAL_SECS)),
        rate: TOWER_RATE_BY_LEVEL[tower.level - 1] ?? 0,
        interval_hours: TOWER_INTERVAL_SECS / 3600,
      } : null,
    })
  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('GET /api/house error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const profile = await requireProfile()
    if (rateLimited(`house:${profile.id}`, 20, 60_000)) return rateLimitResponse()
    const admin = createSupabaseAdminClient()
    const body = await req.json()
    const action = body?.action

    const unlocked: number = (profile as any).house_pads ?? FREE_PADS
    // the set of pad indexes this player may build on today
    const openPads = new Set<number>(PAD_UNLOCK_ORDER.slice(0, unlocked))

    if (action === 'build') {
      const pad = Number(body.pad)
      const def = buildingDef(String(body.type ?? ''))
      if (!def) return NextResponse.json({ error: 'Unknown building' }, { status: 400 })
      if (!Number.isInteger(pad) || (FIXED_PADS as readonly number[]).includes(pad) || !openPads.has(pad)) {
        return NextResponse.json({ error: 'That pad is not open' }, { status: 400 })
      }
      const cost = buildingCost(def.type, 1)!
      const { error } = await admin.rpc('house_build', {
        p_profile_id: profile.id, p_pad: pad, p_type: def.type, p_cost: cost,
      })
      if (error) {
        if (error.message.includes('INSUFFICIENT_FP')) {
          return NextResponse.json({ error: 'INSUFFICIENT_FP', message: `Need ${cost} FP for the ${def.name}` }, { status: 400 })
        }
        if (error.message.includes('duplicate') || error.message.includes('house_one_tower')) {
          return NextResponse.json({ error: def.unique ? 'You already have one of those' : 'That pad is taken' }, { status: 409 })
        }
        console.error('house_build failed:', error)
        return NextResponse.json({ error: 'Could not build' }, { status: 500 })
      }
      return NextResponse.json({ ok: true, spent: cost })
    }

    if (action === 'upgrade') {
      const pad = Number(body.pad)
      const { data: b } = await admin.from('house_buildings')
        .select('type, level').eq('profile_id', profile.id).eq('pad', pad).maybeSingle()
      if (!b) return NextResponse.json({ error: 'Nothing built there' }, { status: 404 })
      const def = buildingDef(b.type)
      const maxLevel = def?.type === 'media_tower' ? TOWER_MAX_LEVEL : (def?.costs.length ?? 3)
      if (b.level >= maxLevel) return NextResponse.json({ error: 'Already max level' }, { status: 400 })
      const cost = buildingCost(b.type, b.level + 1)
      if (cost == null) return NextResponse.json({ error: 'Already max level' }, { status: 400 })
      const { error } = await admin.rpc('house_upgrade', {
        p_profile_id: profile.id, p_pad: pad, p_expected_level: b.level, p_cost: cost,
      })
      if (error) {
        if (error.message.includes('INSUFFICIENT_FP')) {
          return NextResponse.json({ error: 'INSUFFICIENT_FP', message: `Need ${cost} FP to upgrade` }, { status: 400 })
        }
        if (error.message.includes('UPGRADE_CONFLICT')) {
          return NextResponse.json({ error: 'Try again' }, { status: 409 })
        }
        console.error('house_upgrade failed:', error)
        return NextResponse.json({ error: 'Could not upgrade' }, { status: 500 })
      }
      return NextResponse.json({ ok: true, spent: cost, level: b.level + 1 })
    }

    if (action === 'unlock_pad') {
      const cost = nextPadCost(unlocked)
      if (cost == null) return NextResponse.json({ error: 'The whole yard is yours already' }, { status: 400 })
      const { error } = await admin.rpc('house_unlock_pad', {
        p_profile_id: profile.id, p_expected_count: unlocked, p_cost: cost,
      })
      if (error) {
        if (error.message.includes('INSUFFICIENT_FP')) {
          return NextResponse.json({ error: 'INSUFFICIENT_FP', message: `Need ${cost} FP to clear that pad` }, { status: 400 })
        }
        if (error.message.includes('UNLOCK_CONFLICT')) {
          return NextResponse.json({ error: 'Try again' }, { status: 409 })
        }
        console.error('house_unlock_pad failed:', error)
        return NextResponse.json({ error: 'Could not unlock' }, { status: 500 })
      }
      return NextResponse.json({ ok: true, spent: cost, pads_unlocked: unlocked + 1 })
    }

    if (action === 'pickup') {
      // one sparkle per call — the endorphin is in the individual tap, so the
      // client claims them one at a time and each pop is a real server grant
      const { data, error } = await admin.rpc('yard_pickup', {
        p_profile_id: profile.id,
        p_interval_secs: PICKUP_INTERVAL_SECS,
        p_bank_cap: PICKUP_BANK_CAP,
        p_min_fp: PICKUP_MIN_FP,
        p_max_fp: PICKUP_MAX_FP,
      })
      if (error) {
        console.error('yard_pickup failed:', error)
        return NextResponse.json({ error: 'Could not pick that up' }, { status: 500 })
      }
      return NextResponse.json({ ok: true, claimed: data ?? 0 })
    }

    if (action === 'claim_tower') {
      const { data, error } = await admin.rpc('claim_media_tower', {
        p_profile_id: profile.id,
        p_rates: TOWER_RATE_BY_LEVEL as unknown as number[],
        p_interval_secs: TOWER_INTERVAL_SECS,
        p_bank_intervals: TOWER_BANK_INTERVALS,
      })
      if (error) {
        console.error('claim_media_tower failed:', error)
        return NextResponse.json({ error: 'Could not claim' }, { status: 500 })
      }
      return NextResponse.json({ ok: true, claimed: data ?? 0 })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('POST /api/house error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
