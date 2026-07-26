import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { ITEM_MAP, type ItemType } from '@/config/items'
import { applyHallDamageAndMaybeCapture } from '@/lib/gym-combat'

// POST /api/gyms/[id]/boost { item, latitude, longitude }
// Detonate inventory boost. Can finish a hall (DEF → 0 = capture).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const profile = await requireProfile()
    const admin = createSupabaseAdminClient()
    const { id: gymId } = await params
    const { item, latitude, longitude } = await req.json()

    const def = ITEM_MAP[item as ItemType]
    if (!def) return NextResponse.json({ error: 'Unknown item' }, { status: 400 })
    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      return NextResponse.json({ error: 'Location required' }, { status: 400 })
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
      return NextResponse.json({ error: "You can't bomb your own party's hall" }, { status: 400 })
    }
    if (!gym.holder_id) {
      return NextResponse.json({ error: 'Hall is unclaimed — use a full assault to take it' }, { status: 400 })
    }

    const { data: quantityLeft, error: useErr } = await admin.rpc('use_item', {
      p_profile_id: profile.id, p_item: def.id,
    })
    if (useErr) {
      console.error('use_item failed:', useErr)
      return NextResponse.json({ error: 'Could not use item' }, { status: 500 })
    }
    if (quantityLeft === null || quantityLeft === undefined) {
      return NextResponse.json({ error: `No ${def.name} in your bag — buy one first` }, { status: 400 })
    }

    const result = await applyHallDamageAndMaybeCapture(admin, {
      gymId,
      cityName: gym.city_name ?? 'Town Hall',
      holderId: gym.holder_id,
      defensePoints: gym.defense_points ?? 0,
      damage: def.damage,
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
        p_description: `Captured ${gym.city_name} Town Hall (boost)`,
      })
    }

    return NextResponse.json({
      item: def.id,
      damage: result.damage,
      defense_remaining: result.remaining,
      captured: result.captured,
      quantity_left: quantityLeft,
      capture_bonus: result.captured ? 50 : 0,
    })

  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('POST /api/gyms/[id]/boost error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
