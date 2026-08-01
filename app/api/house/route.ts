import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { rateLimited, rateLimitResponse } from '@/lib/ratelimit'
import {
  GRID, FIXED_PADS, buildingDef, buildingCost, hqUpgradeCost, HQ_MAX_LEVEL,
  safeCapacity, SAFE_MAX_LEVEL, upgradeSecs, rushCost,
  TOWER_RATE_BY_LEVEL, TOWER_INTERVAL_SECS, TOWER_BANK_INTERVALS,
  TOWER_MAX_LEVEL, towerBanked,
  PICKUP_INTERVAL_SECS, PICKUP_BANK_CAP, PICKUP_MIN_FP, PICKUP_MAX_FP, pickupsBanked,
} from '@/config/house'

// CAMPAIGN HQ base — Phase 1 (Michael 2026-07-31).
// GET  → the whole yard state. POST → build / upgrade / pickup / claim_tower.
//
// Costs are computed HERE from config and passed to atomic SQL functions —
// the client sends intentions (a pad, a type), never a price. Every mutation
// is one transaction: a failed insert/level/unlock rolls its spend back.

export async function GET() {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    // lazy settlement: due upgrades land the moment the owner looks at the
    // base - no cron needed, offline time still counts
    await admin.rpc('house_settle', { p_profile_id: profile.id })
    // requireProfile's snapshot predates the settle - re-read what it changes
    const { data: fresh } = await admin.from('profiles')
      .select('hq_level, hq_upgrading_to, hq_upgrade_done_at, house_trophies, house_shield_until, yard_swept_at, safe_fp')
      .eq('id', profile.id).single()
    const { data: buildings } = await admin
      .from('house_buildings')
      .select('pad, type, level, claimed_at, upgrading_to, upgrade_done_at')
      .eq('profile_id', profile.id)

    const tower = (buildings ?? []).find(b => b.type === 'media_tower')
    const safeB = (buildings ?? []).find(b => b.type === 'safe')
    const elapsed = tower ? (Date.now() - +new Date(tower.claimed_at)) / 1000 : 0
    const sweptElapsed = (Date.now() - +new Date(fresh?.yard_swept_at ?? Date.now())) / 1000
    const shieldUntil = fresh?.house_shield_until
    // live rush quote per pending upgrade. The same math re-runs at pay time,
    // so a stale quote can only drift by seconds - never undercharge by much.
    const quote = (to: number, doneAt: string, isHq: boolean, baseCost: number) => {
      const total = upgradeSecs(to, isHq)
      const remaining = Math.max(0, (+new Date(doneAt) - Date.now()) / 1000)
      return { to, done_at: doneAt, rush_cost: rushCost(baseCost, remaining, total) }
    }
    return NextResponse.json({
      hq_level: fresh?.hq_level ?? 1,
      hq_upgrade: (fresh?.hq_upgrading_to && fresh?.hq_upgrade_done_at)
        ? quote(fresh.hq_upgrading_to, fresh.hq_upgrade_done_at, true, hqUpgradeCost(fresh.hq_upgrading_to - 1) ?? 0)
        : null,
      trophies: fresh?.house_trophies ?? 0,
      shield_until: shieldUntil && new Date(shieldUntil) > new Date() ? shieldUntil : null,
      pickups: pickupsBanked(sweptElapsed),
      safe: safeB ? {
        level: safeB.level,
        stored: fresh?.safe_fp ?? 0,
        capacity: safeCapacity(safeB.level),
      } : null,
      buildings: (buildings ?? []).map(b => ({
        pad: b.pad, type: b.type, level: b.level, claimed_at: b.claimed_at,
        upgrade: (b.upgrading_to && b.upgrade_done_at)
          ? quote(b.upgrading_to, b.upgrade_done_at, false, buildingCost(b.type, b.upgrading_to) ?? 0)
          : null,
      })),
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
    // settle due upgrades before any action so upgrading again works the
    // moment a timer has expired
    await admin.rpc('house_settle', { p_profile_id: profile.id })

    if (action === 'build') {
      const pad = Number(body.pad)
      const def = buildingDef(String(body.type ?? ''))
      if (!def) return NextResponse.json({ error: 'Unknown building' }, { status: 400 })
      // open 6×6 grid: any cell that isn't the house or the print shop
      if (!Number.isInteger(pad) || pad < 0 || pad >= GRID * GRID || (FIXED_PADS as readonly number[]).includes(pad)) {
        return NextResponse.json({ error: 'That spot is not buildable' }, { status: 400 })
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
        p_max_level: maxLevel, p_duration_secs: upgradeSecs(b.level + 1, false),
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
      return NextResponse.json({ ok: true, spent: cost, upgrading_to: b.level + 1, secs: upgradeSecs(b.level + 1, false) })
    }

    if (action === 'upgrade_hq') {
      const { data: freshHq } = await admin.from('profiles')
        .select('hq_level, hq_upgrading_to').eq('id', profile.id).single()
      if (freshHq?.hq_upgrading_to) return NextResponse.json({ error: 'Your house is already upgrading' }, { status: 409 })
      const cur = Number(freshHq?.hq_level ?? 1)
      const cost = hqUpgradeCost(cur)
      if (cost == null) return NextResponse.json({ error: 'Your house is already maxed out' }, { status: 400 })
      const { error } = await admin.rpc('house_upgrade_hq', {
        p_profile_id: profile.id, p_expected_level: cur, p_cost: cost,
        p_duration_secs: upgradeSecs(cur + 1, true),
      })
      if (error) {
        if (error.message.includes('INSUFFICIENT_FP')) {
          return NextResponse.json({ error: 'INSUFFICIENT_FP', message: `Need ${cost} FP to upgrade your house` }, { status: 400 })
        }
        if (error.message.includes('HQ_UPGRADE_CONFLICT')) {
          return NextResponse.json({ error: 'Try again' }, { status: 409 })
        }
        console.error('house_upgrade_hq failed:', error)
        return NextResponse.json({ error: 'Could not upgrade' }, { status: 500 })
      }
      return NextResponse.json({ ok: true, spent: cost, upgrading_to: Math.min(HQ_MAX_LEVEL, cur + 1), secs: upgradeSecs(cur + 1, true) })
    }

    if (action === 'safe_deposit' || action === 'safe_withdraw') {
      const amount = Math.floor(Number(body.amount))
      if (!Number.isFinite(amount) || amount <= 0) {
        return NextResponse.json({ error: 'A positive amount is required' }, { status: 400 })
      }
      const { data: safeB } = await admin.from('house_buildings')
        .select('level').eq('profile_id', profile.id).eq('type', 'safe').maybeSingle()
      if (!safeB) return NextResponse.json({ error: 'Build a safe first' }, { status: 400 })

      if (action === 'safe_deposit') {
        const { data, error } = await admin.rpc('safe_deposit', {
          p_profile_id: profile.id, p_amount: amount, p_capacity: safeCapacity(safeB.level),
        })
        if (error) {
          if (error.message.includes('SAFE_FULL')) return NextResponse.json({ error: 'SAFE_FULL', message: `Your safe holds ${safeCapacity(safeB.level).toLocaleString()} FP max — upgrade it to lock more` }, { status: 400 })
          if (error.message.includes('INSUFFICIENT_FP')) return NextResponse.json({ error: 'INSUFFICIENT_FP', message: "You don't have that much FP on hand" }, { status: 400 })
          console.error('safe_deposit failed:', error)
          return NextResponse.json({ error: 'Could not deposit' }, { status: 500 })
        }
        return NextResponse.json({ ok: true, stored: data })
      }

      const { data, error } = await admin.rpc('safe_withdraw', {
        p_profile_id: profile.id, p_amount: amount,
      })
      if (error) {
        if (error.message.includes('SAFE_INSUFFICIENT')) return NextResponse.json({ error: 'SAFE_INSUFFICIENT', message: "There isn't that much in the safe" }, { status: 400 })
        console.error('safe_withdraw failed:', error)
        return NextResponse.json({ error: 'Could not withdraw' }, { status: 500 })
      }
      return NextResponse.json({ ok: true, stored: data })
    }

    if (action === 'rush') {
      // pad number rushes that building; hq:true rushes the house
      const isHq = body.hq === true
      let cost = 0
      if (isHq) {
        const { data: f } = await admin.from('profiles')
          .select('hq_upgrading_to, hq_upgrade_done_at').eq('id', profile.id).single()
        if (!f?.hq_upgrading_to || !f.hq_upgrade_done_at) return NextResponse.json({ error: 'Nothing to rush' }, { status: 400 })
        const total = upgradeSecs(f.hq_upgrading_to, true)
        const remaining = Math.max(0, (+new Date(f.hq_upgrade_done_at) - Date.now()) / 1000)
        cost = rushCost(hqUpgradeCost(f.hq_upgrading_to - 1) ?? 0, remaining, total)
      } else {
        const pad = Number(body.pad)
        const { data: b } = await admin.from('house_buildings')
          .select('type, upgrading_to, upgrade_done_at').eq('profile_id', profile.id).eq('pad', pad).maybeSingle()
        if (!b?.upgrading_to || !b.upgrade_done_at) return NextResponse.json({ error: 'Nothing to rush' }, { status: 400 })
        const total = upgradeSecs(b.upgrading_to, false)
        const remaining = Math.max(0, (+new Date(b.upgrade_done_at) - Date.now()) / 1000)
        cost = rushCost(buildingCost(b.type, b.upgrading_to) ?? 0, remaining, total)
      }
      const { error } = await admin.rpc('house_rush', {
        p_profile_id: profile.id, p_pad: isHq ? null : Number(body.pad), p_cost: cost,
      })
      if (error) {
        if (error.message.includes('INSUFFICIENT_FP')) return NextResponse.json({ error: 'INSUFFICIENT_FP', message: `Need ${cost} FP to finish instantly` }, { status: 400 })
        if (error.message.includes('RUSH_NOTHING')) return NextResponse.json({ error: 'Nothing to rush' }, { status: 400 })
        console.error('house_rush failed:', error)
        return NextResponse.json({ error: 'Could not rush' }, { status: 500 })
      }
      return NextResponse.json({ ok: true, spent: cost })
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
