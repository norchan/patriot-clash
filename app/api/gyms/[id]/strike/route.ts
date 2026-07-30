import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { rateLimited, rateLimitResponse } from '@/lib/ratelimit'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { SIEGE_ATTACKS, rollFlak, type SiegeAttackId } from '@/config/siege-attacks'
import { applyHallDamageAndMaybeCapture } from '@/lib/gym-combat'

// POST /api/gyms/[id]/strike { attack, latitude, longitude }
// Party special — spends FP, rolls damage. Can reduce DEF to 0 and CAPTURE
// (Michael 2026-07-26: no more floor-at-1 limbo).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const profile = await requireProfile()
    if (rateLimited(`strike:${profile.id}`, 30, 60_000)) return rateLimitResponse()
    const admin = createSupabaseAdminClient()
    const { id: gymId } = await params
    const { attack, latitude, longitude } = await req.json()

    const def = SIEGE_ATTACKS[attack as SiegeAttackId]
    if (!def) return NextResponse.json({ error: 'Unknown attack' }, { status: 400 })
    if (def.party !== profile.party) {
      return NextResponse.json({ error: 'That attack belongs to the other party' }, { status: 400 })
    }
    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      return NextResponse.json({ error: 'Location required' }, { status: 400 })
    }
    if (profile.fp_balance < def.fp) {
      return NextResponse.json({ error: 'INSUFFICIENT_FP', message: `Need ${def.fp} FP for ${def.name}` }, { status: 400 })
    }

    const ATTACK_RANGE_MILES = 10
    const { data: nearbyGyms } = await admin.rpc('gyms_near', {
      p_lat: latitude, p_lng: longitude, p_miles: ATTACK_RANGE_MILES,
    })
    const near = nearbyGyms?.find((g: any) => g.id === gymId)
    const distMiles = near?.dist_meters ? near.dist_meters / 1609.34 : Infinity
    if (!near || distMiles > ATTACK_RANGE_MILES) {
      return NextResponse.json(
        { error: 'OUT_OF_RANGE', message: `You must be within ${ATTACK_RANGE_MILES} miles of this Town Hall` },
        { status: 400 }
      )
    }

    const { data: gym, error: gymErr } = await admin
      .from('gyms')
      .select('id, city_name, holder_id, holder_party, defense_points')
      .eq('id', gymId)
      .single()
    if (gymErr || !gym) {
      return NextResponse.json({ error: 'Town Hall not found' }, { status: 404 })
    }
    if (gym.holder_party && gym.holder_party === profile.party) {
      return NextResponse.json({ error: "You can't strike your own party's hall" }, { status: 400 })
    }
    if (!gym.holder_id) {
      return NextResponse.json({ error: 'Hall is unclaimed — use a full assault to take it' }, { status: 400 })
    }

    const { error: spendErr } = await admin.rpc('spend_fp', {
      p_profile_id: profile.id,
      p_amount: def.fp,
      p_type: 'gym_attack',
      p_reference_type: 'gym',
      p_description: `${def.name} strike on ${gym.city_name ?? 'Town Hall'}`,
    })
    if (spendErr) {
      console.error('spend_fp failed:', spendErr)
      return NextResponse.json({ error: 'Could not spend FP' }, { status: 500 })
    }

    const rolled = Math.round(def.minDamage + Math.random() * (def.maxDamage - def.minDamage))
    // The hall shoots back. Rolled server-side against the hall's CURRENT
    // defense — the client is told what happened so it can play the matching
    // choreography, but it never gets to decide how much got through.
    const flak = rollFlak(def, gym.defense_points ?? 0)
    const landed = Math.max(1, Math.round(rolled * flak.damageMult))
    const result = await applyHallDamageAndMaybeCapture(admin, {
      gymId,
      cityName: gym.city_name ?? 'Town Hall',
      holderId: gym.holder_id,
      defensePoints: gym.defense_points ?? 0,
      damage: landed,
      attacker: {
        id: profile.id,
        username: profile.username,
        party: profile.party as 'democrat' | 'republican',
      },
      latitude,
      longitude,
    })

    if (result.captured) {
      await admin.rpc('grant_fp', {
        p_profile_id: profile.id,
        p_amount: 50,
        p_type: 'gym_defense',
        p_reference_type: 'gym',
        p_description: `Captured ${gym.city_name} Town Hall (strike)`,
      })
    }

    return NextResponse.json({
      attack: def.id,
      damage: result.damage,
      defense_remaining: result.remaining,
      captured: result.captured,
      fp_spent: def.fp,
      capture_bonus: result.captured ? 50 : 0,
      // hall's return fire — drives the intercept animation on the client
      salvo: flak.salvo,
      intercepted: flak.intercepted,
      blocked: Math.max(0, rolled - landed),
    })

  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('POST /api/gyms/[id]/strike error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
