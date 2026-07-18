import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { rateLimited, rateLimitResponse } from '@/lib/ratelimit'
import { createSupabaseAdminClient } from '@/lib/supabase-server'

const DEFENSE_ITEMS: Record<string, { cost: number; expires_hours: number | null }> = {
  iron_firewall:   { cost: 200,  expires_hours: 24 },
  sandbag_wall:    { cost: 350,  expires_hours: null },
  decoy_gym:       { cost: 500,  expires_hours: null },
  rally_beacon:    { cost: 150,  expires_hours: null },
  bunker_protocol: { cost: 1000, expires_hours: 6 },
}

// =============================================================================
// POST /api/gyms/[id]/defend
// Purchase a defense upgrade for a Town Hall the player controls.
// =============================================================================
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const profile = await requireProfile()
    if (rateLimited(`defend:${profile.id}`, 30, 60_000)) return rateLimitResponse()
    const admin = createSupabaseAdminClient()
    const { id: gymId } = await params

    const { item_type } = await req.json()

    const item = DEFENSE_ITEMS[item_type]
    if (!item) {
      return NextResponse.json({ error: 'Invalid defense item' }, { status: 400 })
    }

    // Verify the player holds this gym
    const { data: gym } = await admin
      .from('gyms')
      .select('id, city_name, holder_id, defense_points')
      .eq('id', gymId)
      .single()

    if (!gym) {
      return NextResponse.json({ error: 'Gym not found' }, { status: 404 })
    }

    if (gym.holder_id !== profile.id) {
      return NextResponse.json({ error: 'You do not control this Town Hall' }, { status: 403 })
    }

    if (profile.fp_balance < item.cost) {
      return NextResponse.json({ error: 'INSUFFICIENT_FP' }, { status: 400 })
    }

    // Spend FP
    await admin.rpc('spend_fp', {
      p_profile_id: profile.id,
      p_amount: item.cost,
      p_type: 'defense_purchase',
      p_reference_type: 'gym_defense',
      p_description: `Bought ${item_type} for ${gym.city_name} Town Hall`,
    })

    // Sandbag wall: immediate defense points boost, no expiry record needed
    if (item_type === 'sandbag_wall') {
      await admin
        .from('gyms')
        .update({ defense_points: (gym.defense_points || 0) + 500 })
        .eq('id', gymId)

      return NextResponse.json({
        success: true,
        message: `🪨 +500 defense points added to ${gym.city_name}!`,
      })
    }

    const expires_at = item.expires_hours
      ? new Date(Date.now() + item.expires_hours * 3600 * 1000).toISOString()
      : null

    await admin.from('defense_items').insert({
      gym_id: gymId,
      item_type,
      purchased_by: profile.id,
      consumed: false,
      expires_at,
    })

    const messages: Record<string, string> = {
      iron_firewall:   `🛡️ Iron Firewall active for 24 hours on ${gym.city_name}!`,
      decoy_gym:       `🎭 Decoy Gym planted — next attack will be absorbed!`,
      rally_beacon:    `📡 Rally Beacon armed — you'll be alerted on attack!`,
      bunker_protocol: `🏰 Bunker Protocol active — ${gym.city_name} is immune for 6 hours!`,
    }

    return NextResponse.json({
      success: true,
      message: messages[item_type] ?? 'Defense activated!',
    })

  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('POST /api/gyms/[id]/defend error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
