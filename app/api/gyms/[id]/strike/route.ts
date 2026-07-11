import { NextRequest, NextResponse } from 'next/server'
import { requireProfile } from '@/lib/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-server'
import { SIEGE_ATTACKS, type SiegeAttackId } from '@/config/siege-attacks'

// POST /api/gyms/[id]/strike { attack, latitude, longitude } — fire a party
// special attack at an enemy hall. Spends FP directly (no inventory) and
// rolls damage server-side. Same range rules as an assault; like boosts,
// strikes can NEVER capture — defense floors at 1 and the kill shot must be
// a real assault.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const profile = await requireProfile()
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
    const gym = nearbyGyms?.find((g: any) => g.id === gymId)
    const distMiles = gym?.dist_meters ? gym.dist_meters / 1609.34 : Infinity
    if (!gym || distMiles > ATTACK_RANGE_MILES) {
      return NextResponse.json(
        { error: 'OUT_OF_RANGE', message: `You must be within ${ATTACK_RANGE_MILES} miles of this Town Hall` },
        { status: 400 }
      )
    }
    if (gym.holder_party && gym.holder_party === profile.party) {
      return NextResponse.json({ error: "You can't strike your own party's hall" }, { status: 400 })
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

    // Roll damage and hit the hall — floor at 1 defense (no capture via strikes)
    const rolled = Math.round(def.minDamage + Math.random() * (def.maxDamage - def.minDamage))
    const remaining = Math.max(1, (gym.defense_points ?? 0) - rolled)
    const dealt = (gym.defense_points ?? 0) - remaining
    await admin.from('gyms').update({ defense_points: remaining }).eq('id', gymId)

    return NextResponse.json({
      attack: def.id,
      damage: dealt,
      defense_remaining: remaining,
      fp_spent: def.fp,
    })

  } catch (err: any) {
    if (err instanceof Response) return err
    console.error('POST /api/gyms/[id]/strike error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
