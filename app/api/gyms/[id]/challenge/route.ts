import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

// =============================================================================
// POST /api/gyms/[id]/challenge
// Attack a Town Hall. Spends FP, runs combat, awards capture if winner.
// =============================================================================
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const gymId = params.id

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

    // --- Validate player is within 100 miles of gym ---
    const { data: nearbyGyms } = await admin
      .rpc('gyms_near', { p_lat: latitude, p_lng: longitude, p_miles: 100 })

    const gym = nearbyGyms?.find((g: any) => g.id === gymId)
    if (!gym) {
      return NextResponse.json(
        { error: 'OUT_OF_RANGE', message: 'You must be within 100 miles of a Town Hall to challenge it' },
        { status: 400 }
      )
    }

    // --- Can't attack your own gym ---
    if (gym.holder_id === profile.id) {
      return NextResponse.json(
        { error: 'OWN_GYM', message: 'You already hold this Town Hall' },
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

    // --- Run combat calculation ---
    const attackerScore = Math.floor(Math.random() * 50) + profile.fp_balance * 0.1 + 50
    const defensePoints = gym.defense_points || 0
    const defenderScore = Math.floor(Math.random() * 50) + defensePoints * 0.05 + 20

    // Check for iron firewall bonus
    const { data: firewall } = await admin
      .from('defense_items')
      .select('*')
      .eq('gym_id', gymId)
      .eq('item_type', 'iron_firewall')
      .eq('consumed', false)
      .gt('expires_at', new Date().toISOString())
      .single()

    const finalDefenderScore = firewall
      ? defenderScore * 1.2  // +20% defense bonus
      : defenderScore

    const captured = attackerScore > finalDefenderScore

    // --- Check for decoy gym (absorbs one attack) ---
    if (!captured) {
      const { data: decoy } = await admin
        .from('defense_items')
        .select('*')
        .eq('gym_id', gymId)
        .eq('item_type', 'decoy_gym')
        .eq('consumed', false)
        .single()

      if (decoy) {
        // Consume the decoy
        await admin
          .from('defense_items')
          .update({ consumed: true })
          .eq('id', decoy.id)
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

    // --- Record the challenge ---
    const { data: challenge } = await admin
      .from('gym_challenges')
      .insert({
        gym_id: gymId,
        challenger_id: profile.id,
        defender_id: gym.holder_id,
        challenger_party: profile.party,
        fp_spent: fpCost,
        attacker_score: Math.round(attackerScore),
        defender_score: Math.round(finalDefenderScore),
        result: captured ? 'victory' : 'defeat',
        captured,
        latitude,
        longitude,
      })
      .select()
      .single()

    // --- Capture the gym if attacker won ---
    if (captured) {
      await admin.rpc('capture_gym', {
        p_gym_id: gymId,
        p_profile_id: profile.id,
        p_party: profile.party,
        p_latitude: latitude,
        p_longitude: longitude,
      })

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
      attacker_score: Math.round(attackerScore),
      defender_score: Math.round(finalDefenderScore),
      capture_bonus: captured ? 50 : 0,
      message: captured
        ? `🎉 You captured ${gym.city_name} Town Hall!`
        : `❌ You were repelled from ${gym.city_name} Town Hall`,
    })

  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('POST /api/gyms/[id]/challenge error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
