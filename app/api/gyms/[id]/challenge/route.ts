import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { rateLimited, rateLimitResponse } from '@/lib/ratelimit'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { applyHallDamageAndMaybeCapture } from '@/lib/gym-combat'
import {
  CAPTURE_BASE_DEFENSE,
  CAPTURE_DEFENSE_PER_CLIQUE,
  CHALLENGE_FP_COST,
  rollChallengeDamage,
} from '@/config/siege-balance'

// =============================================================================
// POST /api/gyms/[id]/challenge
// Attack a Town Hall. Spends FP, rolls modest damage, captures only if DEF
// reaches 0 (no stuck-at-1 — lethal hits finish the hall).
// =============================================================================
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const profile = await requireProfile()
    if (rateLimited(`challenge:${profile.id}`, 12, 60_000)) return rateLimitResponse()
    const admin = createSupabaseAdminClient()
    const { id: gymId } = await params

    const body = await req.json()
    const { latitude, longitude } = body

    if (!latitude || !longitude) {
      return NextResponse.json({ error: 'Location required' }, { status: 400 })
    }

    const fpCost = CHALLENGE_FP_COST
    if (profile.fp_balance < fpCost) {
      return NextResponse.json(
        { error: 'INSUFFICIENT_FP', message: `You need at least ${fpCost} FP to challenge a Town Hall` },
        { status: 400 }
      )
    }

    const ATTACK_RANGE_MILES = 10
    const { data: nearbyGyms } = await admin.rpc('gyms_near', {
      p_lat: latitude, p_lng: longitude, p_miles: ATTACK_RANGE_MILES,
    })

    const near = nearbyGyms?.find((g: any) => g.id === gymId)
    const distMiles = near?.dist_meters ? near.dist_meters / 1609.34 : Infinity

    if (!near || distMiles > ATTACK_RANGE_MILES) {
      return NextResponse.json(
        { error: 'OUT_OF_RANGE', message: `You must be within ${ATTACK_RANGE_MILES} miles of this Town Hall to challenge it` },
        { status: 400 }
      )
    }

    // Fresh row — defense_points on RPC can lag or omit fields
    const { data: gym, error: gymErr } = await admin
      .from('gyms')
      .select('id, city_name, holder_id, holder_party, defense_points')
      .eq('id', gymId)
      .single()
    if (gymErr || !gym) {
      return NextResponse.json({ error: 'Town Hall not found' }, { status: 404 })
    }

    if (gym.holder_id === profile.id) {
      return NextResponse.json(
        { error: 'OWN_GYM', message: 'You already hold this Town Hall' },
        { status: 400 }
      )
    }
    if (gym.holder_party && gym.holder_party === profile.party) {
      return NextResponse.json(
        { error: 'SAME_PARTY', message: 'Your party holds this Town Hall — donate FP to defend it instead!' },
        { status: 400 }
      )
    }

    const { data: bunker } = await admin
      .from('defense_items')
      .select('*')
      .eq('gym_id', gymId)
      .eq('item_type', 'bunker_protocol')
      .eq('consumed', false)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle()

    if (bunker) {
      return NextResponse.json(
        { error: 'BUNKER_ACTIVE', message: 'This Town Hall is protected by Bunker Protocol. Try again later.' },
        { status: 400 }
      )
    }

    let damage = 0
    let remaining = gym.defense_points || 0
    let captured = false
    let absorbed = false

    if (!gym.holder_id) {
      // Unclaimed — first challenger takes it free (still pays march FP)
      captured = true
      await admin.rpc('capture_gym', {
        p_gym_id: gymId,
        p_profile_id: profile.id,
        p_party: profile.party,
        p_latitude: latitude,
        p_longitude: longitude,
      })
      const { data: allyCliques } = await admin
        .from('cliques')
        .select('id')
        .eq('gym_id', gymId)
        .eq('party', profile.party)
      const startDefense =
        CAPTURE_BASE_DEFENSE + (allyCliques?.length ?? 0) * CAPTURE_DEFENSE_PER_CLIQUE
      await admin.from('gyms').update({ defense_points: startDefense }).eq('id', gymId)
      remaining = 0
    } else {
      const { data: decoy } = await admin
        .from('defense_items')
        .select('id')
        .eq('gym_id', gymId)
        .eq('item_type', 'decoy_gym')
        .eq('consumed', false)
        .maybeSingle()

      if (decoy) {
        absorbed = true
        await admin.from('defense_items').update({ consumed: true }).eq('id', decoy.id)
      } else {
        damage = rollChallengeDamage()

        const { data: firewall } = await admin
          .from('defense_items')
          .select('id')
          .eq('gym_id', gymId)
          .eq('item_type', 'iron_firewall')
          .eq('consumed', false)
          .gt('expires_at', new Date().toISOString())
          .maybeSingle()

        if (firewall) damage = Math.floor(damage * 0.8)

        const result = await applyHallDamageAndMaybeCapture(admin, {
          gymId,
          cityName: gym.city_name ?? 'Town Hall',
          holderId: gym.holder_id,
          defensePoints: gym.defense_points ?? 0,
          damage,
          attacker: {
            id: profile.id,
            username: profile.username,
            party: profile.party as 'democrat' | 'republican',
          },
          latitude,
          longitude,
        })
        damage = result.damage
        remaining = result.remaining
        captured = result.captured
      }
    }

    await admin.rpc('spend_fp', {
      p_profile_id: profile.id,
      p_amount: fpCost,
      p_type: 'gym_attack',
      p_reference_type: 'gym_challenge',
      p_description: `Challenged Town Hall: ${gym.city_name}`
    })

    await admin
      .from('gym_challenges')
      .insert({
        gym_id: gymId,
        challenger_id: profile.id,
        defender_id: gym.holder_id,
        challenger_party: profile.party,
        fp_spent: fpCost,
        attacker_score: damage,
        defender_score: remaining,
        result: captured ? 'victory' : 'defeat',
        captured,
        latitude,
        longitude,
      })

    if (captured) {
      const captureBonus = 50
      await admin.rpc('grant_fp', {
        p_profile_id: profile.id,
        p_amount: captureBonus,
        p_type: 'gym_defense',
        p_reference_type: 'gym_challenge',
        p_description: `Captured ${gym.city_name} Town Hall`
      })
    } else if (!absorbed) {
      const { data: beacon } = await admin
        .from('defense_items')
        .select('*')
        .eq('gym_id', gymId)
        .eq('item_type', 'rally_beacon')
        .eq('consumed', false)
        .maybeSingle()

      if (beacon && gym.holder_id) {
        await admin.from('notification_queue').insert({
          profile_id: gym.holder_id,
          title: '⚠️ Town Hall Under Attack!',
          body: `${profile.username} attacked your ${gym.city_name} Town Hall (${remaining.toLocaleString()} DEF left)!`,
          data: { gym_id: gymId, type: 'gym_attacked' }
        })
      }
    }

    return NextResponse.json({
      success: true,
      captured,
      damage,
      defense_remaining: captured ? 0 : remaining,
      capture_bonus: captured ? 50 : 0,
      message: captured
        ? `🎉 You captured ${gym.city_name} Town Hall!`
        : absorbed
        ? `🎭 Your attack was absorbed by a decoy!`
        : `💥 Dealt ${damage.toLocaleString()} damage! ${remaining.toLocaleString()} defense remaining`,
    })

  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('POST /api/gyms/[id]/challenge error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
