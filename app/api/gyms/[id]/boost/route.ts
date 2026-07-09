import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { ITEM_MAP, type ItemType } from '@/config/items'

// POST /api/gyms/[id]/boost { item, latitude, longitude } — detonate a boost
// item on an enemy hall. Same range rules as an assault; boosts can NEVER
// capture (defense floors at 1) — the kill shot must be a real assault.
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
    const gym = nearbyGyms?.find((g: any) => g.id === gymId)
    const distMiles = gym?.dist_meters ? gym.dist_meters / 1609.34 : Infinity
    if (!gym || distMiles > ATTACK_RANGE_MILES) {
      return NextResponse.json(
        { error: 'OUT_OF_RANGE', message: `You must be within ${ATTACK_RANGE_MILES} miles of this Town Hall` },
        { status: 400 }
      )
    }
    if (gym.holder_party && gym.holder_party === profile.party) {
      return NextResponse.json({ error: "You can't bomb your own party's hall" }, { status: 400 })
    }

    // Spend the item atomically (SQL decrement, can't go negative)
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

    // Damage the hall — floor at 1 defense (no capture via items)
    const remaining = Math.max(1, (gym.defense_points ?? 0) - def.damage)
    const dealt = (gym.defense_points ?? 0) - remaining
    await admin.from('gyms').update({ defense_points: remaining }).eq('id', gymId)

    return NextResponse.json({
      item: def.id,
      damage: dealt,
      defense_remaining: remaining,
      quantity_left: quantityLeft,
    })

  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('POST /api/gyms/[id]/boost error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
