import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

// =============================================================================
// POST /api/gyms/[id]/challenge
// Attack a Town Hall. Spends FP, runs combat, awards capture if winner.
// =============================================================================
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const { id: gymId } = await params

    const body = await req.json()
    const { latitude, longitude, fp_spent } = body

    // --- Validate inputs ---
    if (!latitude || !longitude) {
      return NextResponse.json({ error: 'Location required' }, { status: 400 })
    }

    const fpCost = 100 // Base cost to challenge a gym
    if (profile.fp_balance < fpCost) {
      return NextResponse.json(
        { error: 'INSUFFICIENT_FP', message: 'You need at least 100 FP to challenge a Town Hall' },
        { status: 400 }
      )
    }

    // --- Validate player is inside attack range ---
    // Attack range is a flat 10 miles for every hall (independent of the
    // hall's visual radius_miles circle); may be tightened later.
    const ATTACK_RANGE_MILES = 10
    const { data: nearbyGyms } = await admin.rpc('gyms_near', {
      p_lat: latitude, p_lng: longitude, p_miles: ATTACK_RANGE_MILES,
    })

    const gym = nearbyGyms?.find((g: any) => g.id === gymId)
    const battleRadius = ATTACK_RANGE_MILES
    const distMiles = gym?.dist_meters ? gym.dist_meters / 1609.34 : Infinity

    if (!gym || distMiles > battleRadius) {
      return NextResponse.json(
        { error: 'OUT_OF_RANGE', message: `You must be within ${battleRadius} miles of this Town Hall to challenge it` },
        { status: 400 }
      )
    }

    // --- Can't attack your own gym or your own party's hall ---
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

    // --- Check for active bunker protocol ---
    const { data: bunker } = await admin
      .from('defense_items')
      .select('*')
      .eq('gym_id', gymId)
      .eq('item_type', 'bunker_protocol')
      .eq('consumed', false)
      .gt('expires_at', new Date().toISOString())
      .single()

    if (bunker) {
      return NextResponse.json(
        { error: 'BUNKER_ACTIVE', message: 'This Town Hall is protected by Bunker Protocol. Try again later.' },
        { status: 400 }
      )
    }

    // --- Siege combat: each attack chips away at the hall's defense points ---
    // The hall only falls when its defense reaches 0. Defenders counter by
    // donating FP (1 FP = 1 defense point), so contested halls become a
    // tug-of-war instead of an instant coin flip.
    const defensePoints = gym.defense_points || 0
    let damage = 0
    let remaining = defensePoints
    let captured = false
    let absorbed = false

    if (!gym.holder_id) {
      // Unclaimed halls have no garrison — first challenger claims them
      captured = true
    } else {
      // Decoy absorbs one full attack
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
        damage = Math.floor(200 + Math.random() * 200) // 200-400 per attack

        // Iron firewall blunts the attack by 20%
        const { data: firewall } = await admin
          .from('defense_items')
          .select('id')
          .eq('gym_id', gymId)
          .eq('item_type', 'iron_firewall')
          .eq('consumed', false)
          .gt('expires_at', new Date().toISOString())
          .maybeSingle()

        if (firewall) damage = Math.floor(damage * 0.8)

        remaining = Math.max(0, defensePoints - damage)
        captured = remaining <= 0

        if (!captured) {
          await admin
            .from('gyms')
            .update({ defense_points: remaining })
            .eq('id', gymId)
        }
      }
    }

    // --- Spend attacker FP ---
    await admin.rpc('spend_fp', {
      p_profile_id: profile.id,
      p_amount: fpCost,
      p_type: 'gym_attack',
      p_reference_type: 'gym_challenge',
      p_description: `Challenged Town Hall: ${gym.city_name}`
    })

    // --- Record the challenge (attacker_score = damage dealt, defender_score = defense remaining) ---
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

    // --- Capture the gym if attacker won ---
    if (captured) {
      await admin.rpc('capture_gym', {
        p_gym_id: gymId,
        p_profile_id: profile.id,
        p_party: profile.party,
        p_latitude: latitude,
        p_longitude: longitude,
      })

      // Starting garrison: every clique of the capturing party tied to this
      // hall contributes +500 starting defense
      const { data: allyCliques } = await admin
        .from('cliques')
        .select('id')
        .eq('gym_id', gymId)
        .eq('party', profile.party)
      const startDefense = (allyCliques?.length ?? 0) * 500
      if (startDefense > 0) {
        await admin.from('gyms').update({ defense_points: startDefense }).eq('id', gymId)
      }

      // Queue notification to previous holder
      if (gym.holder_id) {
        const { data: prevHolder } = await admin
          .from('profiles')
          .select('id, username')
          .eq('id', gym.holder_id)
          .single()

        if (prevHolder) {
          await admin.from('notification_queue').insert({
            profile_id: gym.holder_id,
            title: '🏛️ Town Hall Lost!',
            body: `${profile.username} captured ${gym.city_name} Town Hall!`,
            data: { gym_id: gymId, type: 'gym_captured' }
          })
        }
      }

      // Award bonus FP for capture
      const captureBonus = 50
      await admin.rpc('grant_fp', {
        p_profile_id: profile.id,
        p_amount: captureBonus,
        p_type: 'gym_defense',
        p_reference_type: 'gym_challenge',
        p_description: `Captured ${gym.city_name} Town Hall`
      })
    } else {
      // Notify allies via rally beacon
      const { data: beacon } = await admin
        .from('defense_items')
        .select('*')
        .eq('gym_id', gymId)
        .eq('item_type', 'rally_beacon')
        .eq('consumed', false)
        .single()

      if (beacon && gym.holder_id) {
        await admin.from('notification_queue').insert({
          profile_id: gym.holder_id,
          title: '⚠️ Town Hall Under Attack!',
          body: `${profile.username} attacked your ${gym.city_name} Town Hall but was repelled!`,
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
